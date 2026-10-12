#!/bin/sh
# 故障注入测试：证明"运维脚本在故障下会失败"，而不是证明"它在正常情况下能跑"。
#
# 存在理由：本项目最严重的一类缺陷是**静默失败** —— 脚本退出 0、日志写 OK，
# 但结论是错的：
#   · 数据库宕机时自检报「审计日志为空 → OK」
#   · 容器 unhealthy 时自检报 OK（fail=1 丢在管道子 shell 里）
#   · pg_dump 失败时产出一个"成功"的坏备份（管道退出码取的是 gzip）
#   · nginx 配置校验失败时回滚从没生效过（备份文件从未创建）
# 这类缺陷不会让任何冒烟测试变红，只能靠**注入故障后断言它确实失败**来证明修好了。
#
# 全部在本机跑，不碰服务器：用临时目录 + 假的 docker/curl 覆盖到 PATH 前面，
# 让**仓库里那一份**脚本在被注入故障的环境里执行，再断言退出码与输出。
#
# 用法：sh deploy/fault-injection.sh         # 全部场景
#       sh deploy/fault-injection.sh 3       # 只跑场景 3
#       sh deploy/fault-injection.sh --list  # 列场景
set -u

REPO_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ONLY="${1:-}"

if [ "$ONLY" = "--list" ]; then
  cat <<'LIST'
1  数据库不可达 → 完整性自检必须非 0（原先报 "审计日志为空 OK"）
2  应用容器 unhealthy → 自检必须非 0（原先 fail=1 丢在管道子 shell）
3  pg_dump 失败 → 备份必须非 0 且不留文件（原先管道掩盖退出码）
4  pg_dump 返回 0 但产物 0 字节 → 必须被体积校验拦住
5  数据库返回非数字 → 必须判为异常而不是"通过"（数值比较静默落到 else）
6  一切正常 → 自检必须返回 0 并写 OK（防止修过头）
7  备份校验和不匹配 → 自检必须非 0
8  nginx 配置校验失败 → deploy-nginx.sh 必须回滚且恢复原文件
LIST
  exit 0
fi

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }
expect_rc() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1（期望退出码 $2，实际 $3）"; fi }
expect_contains() { if grep -q -- "$2" "$1" 2>/dev/null; then ok "$3"; else bad "$3（输出里没有 '$2'）"; fi; }
expect_missing()  { if grep -q -- "$2" "$1" 2>/dev/null; then bad "$3（输出里出现了 '$2'）"; else ok "$3"; fi; }

mkdir -p "$SANDBOX/bin" "$SANDBOX/app/deploy/lib" "$SANDBOX/log" "$SANDBOX/run"

# 用**仓库里那一份**脚本（复制的原因只是要放进沙箱目录树，内容不动）
cp "$REPO_DIR/deploy/integrity-check.sh" "$SANDBOX/app/deploy/"
cp "$REPO_DIR/deploy/backup.sh"          "$SANDBOX/app/deploy/"
cp "$REPO_DIR/deploy/deploy-nginx.sh"    "$SANDBOX/app/deploy/"
cp "$REPO_DIR/deploy/nginx-hangkathon.com.conf" "$SANDBOX/app/deploy/"
cp "$REPO_DIR/deploy/nginx-proxy-common.inc"    "$SANDBOX/app/deploy/"
cp "$REPO_DIR/deploy/lib/common.sh"      "$SANDBOX/app/deploy/lib/"
# alert.sh 也放进来：告警链路要真的被调到（沙箱里它只往日志写）
cat > "$SANDBOX/app/deploy/alert.sh" <<'FAKE'
#!/bin/sh
echo "ALERT-SENT: $1 | $2" >> "$SANDBOX_ALERT_LOG"
exit 0
FAKE

printf 'POSTGRES_USER=hangkathon\nPOSTGRES_DB=hangkathon\n' > "$SANDBOX/app/.env"

# ── 假 docker ─────────────────────────────────────────────────────────────
# 行为由 FAKE_DOCKER_MODE / FAKE_DB_MODE 控制。子命令按位置参数分派，
# 不做"默认返回 healthy"那种兜底 —— 兜底会让测试永远通过。
cat > "$SANDBOX/bin/docker" <<'FAKE'
#!/bin/sh
mode="${FAKE_DOCKER_MODE:-running}"
db="${FAKE_DB_MODE:-ok}"

case "$1" in
  inspect)
    case "$mode" in
      absent)    exit 1 ;;
      unhealthy) echo "unhealthy"; exit 0 ;;
      *)         echo "healthy";   exit 0 ;;
    esac ;;

  exec)
    # docker exec <container> <cmd> [args...]
    shift 2
    cmd="$1"; shift
    case "$cmd" in
      psql)
        case "$db" in
          unreachable) echo "psql: error: connection to server at \"postgres\" port 5432 failed" >&2; exit 2 ;;
          garbage)     echo "healthy"; exit 0 ;;   # 模拟"命令返回了非数字"这种意外
          notable)     echo "f"; exit 0 ;;
          *)
            # 按 SQL 内容区分：断链统计返回 1（只有创世行），count(*) 返回 FAKE_DB_COUNT
            case "$*" in
              *prev_hash*|*orphan*) echo "${FAKE_ORPHANS:-1}" ;;
              *)                    echo "${FAKE_DB_COUNT:-13}" ;;
            esac
            exit 0 ;;
        esac ;;
      pg_dump)
        case "$mode" in
          dumpfail)  echo "pg_dump: error: connection to database \"hangkathon\" failed" >&2; exit 1 ;;
          dumpshort) exit 0 ;;      # 模拟"返回 0 但什么都没写"
          *)         exit 0 ;;
        esac ;;
      stat)
        case "$mode" in
          dumpshort) echo 0 ;;
          *)         echo "${FAKE_INNER_SIZE:-4096}" ;;
        esac ;;
      rm) exit 0 ;;
      *) exit 0 ;;
    esac ;;

  cp)
    # docker cp <container>:<path> <dst>
    dst="$3"
    case "$mode" in
      dumpshort) : > "$dst" ;;
      *)         head -c "${FAKE_DUMP_BYTES:-4096}" /dev/zero > "$dst" ;;
    esac
    exit 0 ;;

  images)  echo "${FAKE_DANGLING:-0}"; exit 0 ;;
  system)  echo "Images 58 0 1.2GB 800MB"; exit 0 ;;
  *)       exit 0 ;;
esac
FAKE

# 假 curl：只记日志，保证测试不外联（死人开关/告警都不真发）
cat > "$SANDBOX/bin/curl" <<'FAKE'
#!/bin/sh
echo "curl $*" >> "$SANDBOX_CURL_LOG"
exit 0
FAKE

# 假 df：磁盘水位必须由测试控制。用宿主机真实的 df 会让结果随开发机磁盘变化的抖动，
# 而且 Git Bash 的 df 输出格式与 Linux 不同（列数不一样，awk 取到的不是百分比）。
cat > "$SANDBOX/bin/df" <<'FAKE'
#!/bin/sh
printf 'Filesystem      Size  Used Avail Use%% Mounted on\n'
printf '/dev/vda3        40G   %sG   12G  %s%% /\n' "${FAKE_DISK_USED:-10}" "${FAKE_DISK_PCT:-30}"
FAKE

chmod +x "$SANDBOX/bin/docker" "$SANDBOX/bin/curl" "$SANDBOX/bin/df"

# 沙箱执行器。用法：
#   run_sandbox <casedir> <docker_mode> <db_mode> -- <命令...>
# casedir 下自动建 log/backups/run，输出重定向到 <casedir>/out.log，返回被测脚本的退出码。
#
# 为什么不用 `env -i`：在 Git Bash（MSYS2）下 env -i 会把 Windows 必需的环境变量一起丢掉，
# 结果是子进程**静默不执行**（退出码 0、零输出）—— 测试于是"全都通过"。
# 那正是本项目最怕的那类假绿。这里改成显式 unset 受影响变量 + 在自己进程里设置干净值，
# 在 Git Bash 与 Linux 上行为一致。
run_sandbox() {
  _case_dir="$1"; shift
  _dmode="$1"; shift
  _dbmode="$1"; shift
  [ "$1" = "--" ] && shift

  mkdir -p "$_case_dir/log" "$_case_dir/backups" "$_case_dir/run"
  (
    # 只留沙箱 bin 在最前，保证假 docker/curl/df 抢先
    PATH="$SANDBOX/bin:/usr/bin:/bin"
    export PATH
    # 把可能从宿主机泄漏进来的变量清掉，否则测试结果取决于开发机环境
    unset PORT APP_DIR HK_LOG BACKUP_DIR STATUS_FILE SAFETY_DIR \
          DISK_ALERT_PCT DANGLING_ALERT_COUNT APP_CONTAINER BACKUP_MAX_AGE HK_DB_CONTAINER \
          POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD HEALTHCHECK_PING_URL 2>/dev/null || true

    APP_DIR="$SANDBOX/app"; export APP_DIR
    HK_LOG="$_case_dir/log/hk.log"; export HK_LOG
    BACKUP_DIR="$_case_dir/backups"; export BACKUP_DIR
    STATUS_FILE="$_case_dir/run/status"; export STATUS_FILE
    SAFETY_DIR="$_case_dir/backups"; export SAFETY_DIR
    FAKE_DOCKER_MODE="$_dmode"; export FAKE_DOCKER_MODE
    FAKE_DB_MODE="$_dbmode"; export FAKE_DB_MODE
    FAKE_INNER_SIZE="${FAKE_INNER_SIZE:-4096}"; export FAKE_INNER_SIZE
    FAKE_DUMP_BYTES="${FAKE_DUMP_BYTES:-4096}"; export FAKE_DUMP_BYTES
    FAKE_DANGLING="${FAKE_DANGLING:-0}"; export FAKE_DANGLING
    FAKE_DB_COUNT="${FAKE_DB_COUNT:-13}"; export FAKE_DB_COUNT
    FAKE_ORPHANS="${FAKE_ORPHANS:-1}"; export FAKE_ORPHANS
    FAKE_DISK_PCT="${FAKE_DISK_PCT:-30}"; export FAKE_DISK_PCT
    SANDBOX_CURL_LOG="$_case_dir/log/curl.log"; export SANDBOX_CURL_LOG
    SANDBOX_ALERT_LOG="$_case_dir/log/alert.log"; export SANDBOX_ALERT_LOG

    "$@"
  ) >"$_case_dir/out.log" 2>&1
}

# 在某个 case 目录里放一份"好的"备份（内容 + 正确校验和）
seed_backup() {
  _dir="$1"
  mkdir -p "$_dir/backups"
  printf 'payload-payload-payload' > "$_dir/backups/hangkathon-20261012-000000.dump.gz"
  (cd "$_dir/backups" && sha256sum "hangkathon-20261012-000000.dump.gz" > "hangkathon-20261012-000000.dump.gz.sha256")
}

case_start() {
  # $1 编号 $2 标题；设置 SKIP=1 表示本次跳过
  SKIP=0
  [ -z "$ONLY" ] || [ "$ONLY" = "$1" ] || SKIP=1
  [ "$SKIP" = "1" ] && return 0
  echo
  echo "── 场景 $1：$2 ──"
}

# ── 场景 1 ────────────────────────────────────────────────────────────────
case_start 1 "数据库不可达 → 完整性自检必须非 0（原先报 「审计日志为空 OK」）"
if [ "$SKIP" = "0" ]; then
  C="$SANDBOX/c1"; seed_backup "$C"
  run_sandbox "$C" running unreachable -- /bin/sh "$SANDBOX/app/deploy/integrity-check.sh"
  expect_rc "自检返回非 0" 1 "$?"
  expect_contains "$C/run/status" "ALERT" "状态文件写 ALERT"
  expect_contains "$C/out.log" "审计日志不可读" "明确指出审计日志不可读"
fi

# ── 场景 2 ────────────────────────────────────────────────────────────────
case_start 2 "应用容器 unhealthy → 自检必须非 0（回归：管道子 shell 吞 fail=1）"
if [ "$SKIP" = "0" ]; then
  # 放一份正常备份，排除"没备份"这条独立失败项的干扰
  C="$SANDBOX/c2"; seed_backup "$C"
  run_sandbox "$C" unhealthy ok -- /bin/sh "$SANDBOX/app/deploy/integrity-check.sh"
  expect_rc "自检返回非 0" 1 "$?"
  expect_contains "$C/out.log" "应用容器状态 unhealthy" "记录了容器状态"
  expect_contains "$C/run/status" "ALERT" "状态文件写 ALERT"
fi

# ── 场景 3 ────────────────────────────────────────────────────────────────
case_start 3 "pg_dump 失败 → 备份必须非 0 且不留文件（回归：管道掩盖退出码）"
if [ "$SKIP" = "0" ]; then
  C="$SANDBOX/c3"
  run_sandbox "$C" dumpfail ok -- /bin/sh "$SANDBOX/app/deploy/backup.sh"
  expect_rc "备份返回非 0" 1 "$?"
  expect_contains "$C/out.log" "全库 pg_dump 失败" "日志指出 pg_dump 失败"
  if ls "$C/backups"/hangkathon-*.dump.gz >/dev/null 2>&1; then
    bad "失败时不应留下 .dump.gz 文件"
  else
    ok "失败时未留下任何备份文件"
  fi
fi

# ── 场景 4 ────────────────────────────────────────────────────────────────
case_start 4 "pg_dump 返回 0 但产物 0 字节 → 必须被体积校验拦住"
if [ "$SKIP" = "0" ]; then
  C="$SANDBOX/c4"
  FAKE_INNER_SIZE=0 FAKE_DUMP_BYTES=0 run_sandbox "$C" dumpshort ok -- /bin/sh "$SANDBOX/app/deploy/backup.sh"
  expect_rc "备份返回非 0" 1 "$?"
  expect_contains "$C/out.log" "产物异常" "日志指出产物体积异常"
fi

# ── 场景 5 ────────────────────────────────────────────────────────────────
# 这是本轮最值得留档的一条：`[ "$x" -gt 1 ]` 在 $x 非整数时返回 **2**，
# if 把它当"不成立"，于是 elif 的 else 分支被执行 —— **垃圾值被当成通过**。
# 真实触发场景：psql 输出被别的输出污染、docker inspect 返回了非期望字符串。
case_start 5 "数据库返回非数字 → 必须判为异常（回归：数值比较静默落到 else）"
if [ "$SKIP" = "0" ]; then
  C="$SANDBOX/c5"; seed_backup "$C"
  run_sandbox "$C" running garbage -- /bin/sh "$SANDBOX/app/deploy/integrity-check.sh"
  expect_rc "自检返回非 0" 1 "$?"
  expect_contains "$C/out.log" "审计日志不可读" "把非数字判成不可读而非通过"
  expect_missing "$C/out.log" "自检通过" "没有把非数字当成通过"
fi

# ── 场景 6 ────────────────────────────────────────────────────────────────
case_start 6 "一切正常 → 自检必须返回 0 并写 OK（防止修过头）"
if [ "$SKIP" = "0" ]; then
  C="$SANDBOX/c6"; seed_backup "$C"
  run_sandbox "$C" running ok -- /bin/sh "$SANDBOX/app/deploy/integrity-check.sh"
  expect_rc "自检返回 0" 0 "$?"
  expect_contains "$C/run/status" "OK" "状态文件写 OK"
fi

# ── 场景 7 ────────────────────────────────────────────────────────────────
case_start 7 "备份内容被改动 → 自检必须非 0"
if [ "$SKIP" = "0" ]; then
  C="$SANDBOX/c7"; seed_backup "$C"
  printf 'tampered-content' > "$C/backups/hangkathon-20261012-000000.dump.gz"
  run_sandbox "$C" running ok -- /bin/sh "$SANDBOX/app/deploy/integrity-check.sh"
  expect_rc "自检返回非 0" 1 "$?"
  expect_contains "$C/out.log" "校验和" "日志指出校验和问题"
fi

# ── 场景 8 ────────────────────────────────────────────────────────────────
# deploy-nginx.sh 的立身之本是"校验失败自动回滚"，而原先 BACKUP 只是个路径字符串、
# 从未 cp 过 —— 回滚分支必然失败。这条用静态断言收口：脚本里必须真的出现
# "备份线上配置 → 断言备份存在 → 失败时回滚/明确告警"这三步。
# （本地跑不了真 nginx -t，也不该在开发机上碰 /www/server 下的宝塔目录。）
case_start 8 "deploy-nginx.sh 必须具备「备份 → 校验 → 回滚」三步（回归：备份从未创建）"
if [ "$SKIP" = "0" ]; then
  S="$SANDBOX/app/deploy/deploy-nginx.sh"
  # 待匹配的都是**源码里的文本**（含 $VAR 字面量），不是本脚本的变量。
  # 用双引号 + 转义的 \$ 表达：既让 ShellCheck 看清这是字面量，也避免单引号写法
  # 被它当成"以为变量会展开"而反复告警。
  P_BACKUP="cp -p \"\$VHOST\" \"\$VHOST.bak.\$STAMP\""
  P_ASSERT="[ -f \"\$VHOST.bak.\$STAMP\" ]"
  P_ROLLBACK="cp -p \"\$VHOST_BACKUP\" \"\$VHOST\""
  P_XFF_COVER="X-Forwarded-For \$remote_addr"
  P_XFF_APPEND="X-Forwarded-For \$proxy_add_x_forwarded_for"
  P_INCLUDE='include /www/server/panel/vhost/nginx/hangkathon-proxy-common.inc'

  expect_contains "$S" "$P_BACKUP" "第一步：真的备份线上配置"
  expect_contains "$S" "$P_ASSERT" "第二步：断言备份文件确实生成"
  expect_contains "$S" "$P_ROLLBACK" "第三步：失败时从备份回滚"
  expect_contains "$S" '回滚失败，配置目录处于不一致状态' "回滚失败时有明确告警而非静默"
  # 反代头必须在公共片段里，且公共片段本身要覆盖 XFF 覆盖语义
  expect_contains "$SANDBOX/app/deploy/nginx-hangkathon.com.conf" "$P_INCLUDE" "主站 vhost 引用公共片段"
  expect_contains "$SANDBOX/app/deploy/nginx-proxy-common.inc" "$P_XFF_COVER" "公共片段用 remote_addr 覆盖（不是 proxy_add_x_forwarded_for）"
  expect_missing "$SANDBOX/app/deploy/nginx-hangkathon.com.conf" "$P_XFF_APPEND" "vhost 里没有残留的追加式 XFF"
fi

echo
echo "故障注入：$pass 通过，$fail 失败"
[ "$fail" -eq 0 ] || exit 1
