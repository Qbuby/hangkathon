#!/bin/sh
# 运维脚本公共库（被 deploy/*.sh 以 `. deploy/lib/common.sh` 引入）。
#
# 为什么存在：这五样东西原先在 13 个脚本里各写了一遍 —— log() 5 份、DB 凭证推导 7 处、
# 校验和 2 处、端口 5 处、告警调用到处散落。重复的代价不是行数，是**漂移**：改了两处
# 漏了第三处（本项目就吃过这个亏，nginx 的 XFF 三处 server 块）。
#
# 两条落地约定：
#   1. 引入后调用 `hk_init "<脚本名>"`：统一定位 APP_DIR、按需加载 .env。
#   2. 用 `hk_check <0|1> "<消息>"` 汇总自检结果，收尾用 `hk_finish` 决定退出码。
#      这样"某项没通过"永远不会被管道子 shell 吞掉 —— 计数器在主 shell 里。
#
# 刻意不用 `set -o pipefail`：deploy/*.sh 的 shebang 是 `#!/bin/sh`，systemd 也以
# `/bin/sh` 调用，pipefail 是 bash 扩展，在真 dash 上会直接报错。管道类问题一律用
# 结构化改写解决（不产生"需要 pipefail 才安全"的管道），而不是换 shell。

# ── 通用小工具 ────────────────────────────────────────────────────────────────

# 时间戳前缀日志。$HK_LOG 指向日志文件时同时追加（脚本自己要设 HK_LOG）。
log() {
  _hk_line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  printf '%s\n' "$_hk_line"
  if [ -n "${HK_LOG:-}" ]; then
    printf '%s\n' "$_hk_line" >> "$HK_LOG"
  fi
}

# 运维脚本的对外端口。集中一处，改的时候不会漏。
# 也能少写一个变量：取值优先级 PORT 环境变量 > .env 里的 PORT > 默认 3210。
hk_port() {
  if [ -n "${PORT:-}" ]; then
    printf '%s' "$PORT"
    return 0
  fi
  if [ -f "${APP_DIR:-/opt/hangkathon}/.env" ]; then
    _hk_p="$(sed -n 's/^PORT=\([0-9]\{1,5\}\).*/\1/p' "${APP_DIR:-/opt/hangkathon}/.env" | head -1)"
    if [ -n "$_hk_p" ]; then
      printf '%s' "$_hk_p"
      return 0
    fi
  fi
  printf '3210'
}

# 数据库容器名。compose 里定的，这里只做单一来源。
HK_DB_CONTAINER="${HK_DB_CONTAINER:-hangkathon-postgres}"

# 从 .env 读 DB 凭证，并导出 DB_USER / DB_NAME。
#
# 必须在需要 DB_USER/DB_NAME **之前**调用：原先 restore.sh 在 source .env 之前就展开了
# 这两个变量，非默认 POSTGRES_DB 的部署会去恢复错误的库。这里把顺序固定下来。
db_env() {
  if [ -n "${HK_DB_ENV_LOADED:-}" ]; then
    return 0
  fi
  if [ -f "$APP_DIR/.env" ]; then
    hk_source_env "$APP_DIR/.env"
  fi
  DB_USER="${POSTGRES_USER:-hangkathon}"
  DB_NAME="${POSTGRES_DB:-hangkathon}"
  export DB_USER DB_NAME
  HK_DB_ENV_LOADED=1
}

# 读 .env。
#
# **为什么不能直接 `. "$APP_DIR/.env"`**（2026-10-17 实踩）：`.env` 会被 shell **求值**，
# 所以值里的 shell 元字符会被解释。真实事故：
#
#     FEISHU_ADMINS=ou_xxx=a@b.com|1479856809@qq.com|owu1v2fz...
#                     ↑ 这个竖线被解析成管道
#
# shell 把它读成「赋值 | 命令 | 命令」→ 两条 `command not found` → 退出 127
# → **每日备份静默中断两天**（timer 显示跑过，实际零产出，直到完整性自检告警才发现）。
#
# 而且报错说的是「line 28」，看着像文件坏了，其实是那一行被解析成了管道 ——
# 没有报错的备份中断，比直接报错难查得多。
#
# 所以这里自己解析：只认 `KEY=VALUE`，**不求值 VALUE**，并剥掉两端引号。
# 代价是不支持 `KEY=$(command)` 这类动态值 —— .env 里本来也不该有，
# 需要动态值请放到 systemd 的 EnvironmentFile 或 unit 的 Environment=。
hk_source_env() {
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    # 跳过空行与注释
    case "$line" in
      ''|'#'*) continue ;;
    esac
    # 必须是 KEY=VALUE 形态；不以 = 开头的行（曾经踩到的多行值残骸）直接报错而不是默默跳过 ——
    # 默默跳过会让运维脚本带着半份配置运行，那比报错危险得多。
    case "$line" in
      *=*) ;;
      *)
        echo "hk_source_env: $1 第 $(grep -n -x -F -- "$line" "$1" | head -1 | cut -d: -f1) 行不是 KEY=VALUE：${line%% *}" >&2
        return 1
        ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    # 只剥成对的首尾引号（shell 不做求值，引号只是书写习惯）
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$1"
}

# psql 独立调用（**不带管道**）。用法：
#   hk_psql -At -c "select 1"       # 库 = $DB_NAME
# stdout 只有查询结果，数据库不可达/查询报错时返回**非零退出码**，错误走 stderr。
# 调用方必须自己判退出码 —— 这是本库的核心约定：失败必须可见，不能被 `|| echo 0` 抹掉。
hk_psql() {
  db_env
  docker exec "$HK_DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

# 校验 sha256。返回 0 通过 / 1 不通过（含缺 .sha256 文件）。$1 = 文件路径。
verify_checksum() {
  _hk_file="$1"
  if [ ! -f "$_hk_file.sha256" ]; then
    log "警告：缺少 $(basename "$_hk_file").sha256，无法校验完整性"
    return 1
  fi
  # 必须 cd 到目录：.sha256 里存的是 basename
  if (cd "$(dirname "$_hk_file")" && sha256sum -c "$(basename "$_hk_file").sha256" >/dev/null 2>&1); then
    return 0
  fi
  return 1
}

# ── 告警 ─────────────────────────────────────────────────────────────────────

# 飞书告警（同故障域内最快）。失败只记日志，绝不影响调用方退出码 —— 告警通道本身
# 不该让备份任务失败。
hk_alert() {
  sh "$APP_DIR/deploy/alert.sh" "$1" "${2:-}" >/dev/null 2>&1 || \
    log "飞书告警发送失败（不影响本次任务）：$1"
}

# 死人开关（dead man's switch）。参考 healthchecks/healthchecks 的 cron 监控模型：
# 任务每轮 ping 一个托管在**服务器之外**的 URL，超过 period+grace 没收到就告警。
#
# 这是唯一能在「整机宕机 / Docker 全挂 / 网络不通」时仍然告警的一层 —— Uptime Kuma
# 和飞书通道都与被监控对象同故障域，机器没了它们也哑了。
#
# 未配置 HEALTHCHECK_PING_URL 时降级为一行日志，不引入新故障点。
#
# 容错：ping 自己的失败（curl 非零）只记日志、返回 0。理由与 hk_alert 一致 ——
# 告警通道故障不该污染被监控任务的退出码（否则 Healthchecks 挂了会让备份天天"失败"）。
# 唯一的例外是显式的 fail 状态：那条 curl 也容忍失败，但**脚本本身的失败**已经
# 由 hk_finish/fail() 决定了退出码。
#
# 用法：hk_ping start|ok|fail [--quiet]
#   --quiet：未配置或 ping 失败时**不写日志**。给"每 3 分钟一次的心跳"用 ——
#   那种调用会天天写日志，而"未配置"是常态，写它只会把真正的事件淹掉。
hk_ping() {
  _hk_state="${1:-ok}"
  _hk_quiet="${2:-}"
  if [ -z "${HEALTHCHECK_PING_URL:-}" ]; then
    [ "$_hk_quiet" = "--quiet" ] || log "（未配置 HEALTHCHECK_PING_URL，跳过死人开关 ping：$_hk_state）"
    return 0
  fi
  case "$_hk_state" in
    start) _hk_url="$HEALTHCHECK_PING_URL/start" ;;
    fail)  _hk_url="$HEALTHCHECK_PING_URL/fail" ;;
    *)     _hk_url="$HEALTHCHECK_PING_URL" ;;
  esac
  if [ "$_hk_state" = "fail" ]; then
    curl -fsS -m 10 --retry 2 -X POST -d "$(hostname) $(date '+%F %T')" "$_hk_url" >/dev/null 2>&1 \
      || log "死人开关 ping 失败：$_hk_state"
  else
    curl -fsS -m 10 --retry 2 "$_hk_url" >/dev/null 2>&1 \
      || [ "$_hk_quiet" = "--quiet" ] || log "死人开关 ping 失败：$_hk_state"
  fi
  return 0
}

# ── 自检汇总 ─────────────────────────────────────────────────────────────────
#
# 计数器放在主 shell 的变量里（不是管道子 shell），所以 fail 计数永远不会丢。
# 原先 integrity-check.sh 把容器健康检查写在 `docker inspect | while read` 里，
# 子 shell 中的 fail=1 随管道一起消失，容器 unhealthy 时自检照样报 OK —— 这就是
# 这套机制存在的理由。
#
# 每个脚本是独立进程，全局变量不会串，不需要按脚本名区分。

HK_CHECK_TOTAL=0
HK_CHECK_FAILED=0

# 用法：hk_check <0|1> "<消息>"   1=通过
hk_check() {
  _hk_passed="$1"
  _hk_msg="$2"
  HK_CHECK_TOTAL=$((HK_CHECK_TOTAL + 1))
  if [ "$_hk_passed" = "1" ]; then
    log "OK $_hk_msg"
  else
    log "ALERT $_hk_msg"
    HK_CHECK_FAILED=$((HK_CHECK_FAILED + 1))
  fi
}

# 收尾：写状态文件、必要时告警、ping 死人开关。参数：
#   $1 告警标题  $2 告警正文  $3 状态文件路径（可空）
# 返回 0（全过）或 1（有失败项）。退出码刻意只区分"过/不过"两态 ——
# 把失败项数当退出码会让 `>255` 回绕，也让调用方的 `if` 判断失去意义。
hk_finish() {
  _hk_title="$1"
  _hk_body="$2"
  _hk_status_file="${3:-}"
  if [ "$HK_CHECK_FAILED" -eq 0 ]; then
    [ -n "$_hk_status_file" ] && echo OK > "$_hk_status_file"
    log "自检通过（$HK_CHECK_TOTAL 项）"
    hk_ping ok
    return 0
  fi
  [ -n "$_hk_status_file" ] && echo ALERT > "$_hk_status_file"
  log "自检未通过：$HK_CHECK_FAILED/$HK_CHECK_TOTAL 项异常"
  hk_alert "$_hk_title" "$_hk_body"
  hk_ping fail
  return 1
}

# ── 初始化 ───────────────────────────────────────────────────────────────────

# 用法：hk_init <脚本短名> [--with-env]
#   APP_DIR 可被环境变量覆盖（本地演练用），默认 /opt/hangkathon
#   HK_LOG  日志文件路径，**必须在 hk_init 之前设好**，否则 log() 只打 stdout 不落盘
hk_init() {
  HK_SCRIPT_NAME="$1"
  APP_DIR="${APP_DIR:-/opt/hangkathon}"
  export APP_DIR HK_SCRIPT_NAME
  if [ "${2:-}" = "--with-env" ]; then
    db_env
  fi
  # 日志目录不存在就直接创建，省得每个脚本自己 mkdir
  if [ -n "${HK_LOG:-}" ]; then
    mkdir -p "$(dirname "$HK_LOG")" 2>/dev/null || true
  fi
}
