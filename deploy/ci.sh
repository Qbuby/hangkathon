#!/bin/sh
# 杭客松 CI：拉取 GitHub main，有变化就重建镜像并重启容器。
# 由 hangkathon-ci.timer 每 3 分钟调用一次，也可以手动执行：sh deploy/ci.sh
#
# 修复记录（2026-10-12，两处静默失败）：
#   a) `git fetch` 失败原先直接 `exit 0` —— 部署密钥失效或网络不通时，CI **静默停摆**，
#      站点停在旧版本上而没有任何人知道（systemd 也看到绿色）。现在：告警 + 退出 1，
#      并在 systemd 里标红。为避免每 3 分钟一次的告警风暴，加了"连续失败只告警一次"的
#      状态文件，恢复成功时清掉。
#   b) LOCAL/REMOTE 都用 `|| echo none` 兜底，两者同时取不到时相等 → 判成"无变化"→ exit 0。
#      现在任一为 none 都按失败处理。
set -u

# 先按脚本自身位置定位：从仓库检出直接跑（本地体检、故障注入）也能用；
# APP_DIR 仍可被环境变量覆盖（沙箱测试就靠它）。
SELF_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
APP_DIR="${APP_DIR:-$(dirname -- "$SELF_DIR")}"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
# 显式检查公共库存在：`. ` 失败在 set -u（无 set -e）下不会中断脚本，
# 结果是后面每个 hk_* 都报 command not found 而脚本继续跑下去 ——
# ci.sh 走这条路会让"自动部署"静默半瘫。宁可这里就退非零。
[ -f "$SELF_DIR/lib/common.sh" ] || { echo "缺少 $SELF_DIR/lib/common.sh（检出损坏？）" >&2; exit 1; }
. "$SELF_DIR/lib/common.sh"

HK_LOG=/var/log/hangkathon-ci.log
KEY=/root/.ssh/hangkathon_deploy
LOCK=/tmp/hangkathon-ci.lock
FETCH_FAIL_FLAG=/var/run/hangkathon-ci.fetchfail

hk_init ci
PORT="$(hk_port)"

# 部署链的死人开关：开始/结束各 ping 一次。
# 为什么部署也要接：这个 timer 每 3 分钟跑一次，是体系里最密集的心跳 ——
# 整机宕机时它比每日的备份/自检更早失效，是"服务器整个不见了"最快能被外部发现的一路。
# 未配置 HEALTHCHECK_PING_URL 时降级为一行日志，不影响部署。
hk_ping start --quiet

# 磁盘水位闸门 + 报告（**只读，绝不清理**）。
#
# 为什么放在 CI 里：每次 `docker compose up -d --build` 都会在 buildkit
# 留下约 1.3GB 的层。2026-10-22 这台 40G 的机器累计到 26G（98%）。
#
# **绝不在 CI 里自动清理**，这不是保守，是三次实测换来的：
#   · `docker system df`     → dockerd 挂住，被 OOM 杀掉（容器全灭、站点 502）
#   · `docker builder prune` → 90 秒超时，什么都没删
#   · `docker buildx du`     → 同样拖死 dockerd
#   · daemon.json 的 builder.gc → dockerd RSS 99MB → 800~1150MB，直接 OOM
# 这台机器只有 1.8GB 内存，任何让 dockerd 遍历全量层的动作都会把它打死。
# 所以增长控制只能在**构建前**做：空间不足就别构建，并明确告警。
#
# 返回：0 可以继续部署；非 0 表示空间不足，应跳过本次部署。
check_disk_before_build() {
  used="$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}' || true)"
  case "$used" in ''|*[!0-9]*) log "读不到磁盘水位，按放行处理"; return 0 ;; esac

  avail_kb="$(df -Pk / 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  case "$avail_kb" in ''|*[!0-9]*) avail_kb=0 ;; esac
  avail_mb=$((avail_kb / 1024))

  # 一次构建实测峰值：buildkit 层约 1.3GB + 新镜像 293MB + 构建期临时空间。
  # 留 3GB 余量，低于它就不构建 —— 构建到一半磁盘满会把镜像写坏，比不部署更糟。
  MIN_FREE_MB="${MIN_FREE_MB:-3072}"
  if [ "$avail_mb" -lt "$MIN_FREE_MB" ]; then
    log "磁盘可用仅 ${avail_mb}MB（阈值 ${MIN_FREE_MB}MB），**跳过本次部署**以免构建中途写满。"
    log "处置：在维护窗口执行 deploy/docker-reclaim.sh --dry-run 确认后 --apply（需停机）。"
    # 文案里刻意不写完整命令名：它们进不了"代码不得执行"的断言，
    # 也避免有人复制粘贴时被误以为是推荐做法。处置脚本里写得更清楚。
    log "绝不要用任何 docker 清理/统计子命令排查 —— 本机实测都会把 dockerd 拖死，详见 deploy/docker-reclaim.sh。"
    hk_alert "【杭客松】CI 因磁盘不足跳过部署" \
      "服务器 $(hostname) $(date '+%F %T') 磁盘可用 ${avail_mb}MB（阈值 ${MIN_FREE_MB}MB），已跳过构建。处置见 deploy/docker-reclaim.sh"
    return 1
  fi

  if [ "$used" -ge "${DISK_WARN_PCT:-80}" ]; then
    log "提示：磁盘已用 ${used}%（可用 ${avail_mb}MB），本次仍继续部署。"
  fi
  return 0
}

# 部署后验证：容器健康只说明"进程起来了"，不代表契约没坏。
# 两个套件用仓库里的脚本（纯 Node 标准库，不需要在宿主机装依赖），
# 通过一个临时 node 容器执行 —— 宿主机上没有 node。
#   smoke      每个页面/接口的状态码与 JSON 字段、SEO 文件、安全响应头、响应时间预算
#   adversarial 越权、信息泄露、限流、输入健壮性、响应安全（含"未泄露 X-Powered-By"）
# 失败只记日志不阻断部署：站点已经在新版本上跑着，回滚是人工决策；
# 但日志里会留下明确的 FAIL 清单，且退出码非零，systemd 会标红这次运行。
run_post_deploy_checks() {
  sha="$1"
  if ! command -v docker >/dev/null 2>&1; then
    log "跳过部署后验证：宿主机没有 docker"
    return 0
  fi

  fail=0
  # 三个套件：冒烟（能不能开）、对抗（防守还在不在）、SEO（能不能被正确收录）。
  # SEO 单独成一档是因为它查的是"原始 HTML 里的结构化数据"—— 不执行 JS 的爬虫
  # （GPTBot / PerplexityBot）看到的就是这一层，用浏览器看会得到不同的结论。
  for pair in "scripts/ci/smoke.mjs:部署后冒烟" "scripts/security/adversarial.mjs:对抗测试" "scripts/seo/audit.mjs:SEO 检查"; do
    script="${pair%%:*}"
    title="${pair#*:}"
    [ -f "$APP_DIR/$script" ] || { log "跳过 $title：$script 不存在"; continue; }
    # 整个 scripts 目录挂进容器：套件之间用相对路径互相 import（../ci/lib.mjs），单挂一个文件会解析失败
    if docker run --rm --network host \
        -e TEST_BASE_URL="http://127.0.0.1:$PORT" \
        -e ADVERSARIAL_ACK=1 \
        -v "$APP_DIR/scripts:/scripts:ro" \
        node:22-alpine node "/$script" >>"$HK_LOG" 2>&1; then
      log "$title 通过（$sha）"
    else
      log "$title 失败（$sha）—— 详见上方输出"
      hk_alert "【杭客松】部署后检查失败" "$title 未通过（提交 $sha），明细见 $HK_LOG"
      fail=1
    fi
  done
  return $fail
}

# 防重叠：上一次还没跑完就直接退出
if ! mkdir "$LOCK" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$APP_DIR" || { log "APP_DIR $APP_DIR missing"; exit 1; }
[ -d .git ] || { log "not a git checkout yet — 先跑 deploy/setup-ci.sh"; exit 0; }

# 认证方式：优先部署密钥（SSH），其次 HTTPS 的 credential store
if [ -f "$KEY" ]; then
  export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
elif [ ! -f /root/.git-credentials ]; then
  log "没有可用凭据（既无 $KEY 也无 /root/.git-credentials），跳过"
  exit 0
fi

if ! git fetch --depth 1 --quiet origin main 2>>"$HK_LOG"; then
  log "git fetch 失败 —— 部署密钥可能还没加到 GitHub，或网络不通。CI 已停摆，站点停留在旧版本。"
  if [ ! -f "$FETCH_FAIL_FLAG" ]; then
    hk_alert "【杭客松】CI 拉取失败" "服务器 $(hostname) $(date '+%F %T') git fetch origin main 失败，自动部署已停摆（持续失败不再重复告警）。明细见 $HK_LOG"
    : > "$FETCH_FAIL_FLAG"
  fi
  hk_ping fail
  exit 1
fi
# 拉取恢复：清掉"连续失败"标记，下次再坏会重新告警
if [ -f "$FETCH_FAIL_FLAG" ]; then
  rm -f "$FETCH_FAIL_FLAG"
  log "git fetch 恢复正常"
fi

# 两个 SHA 都必须拿到：任一为空说明仓库状态异常，不能按"无变化"处理（原先是这么漏的）
LOCAL="$(git rev-parse --short=7 HEAD 2>/dev/null || true)"
REMOTE="$(git rev-parse --short=7 origin/main 2>/dev/null || true)"
if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
  log "无法解析 HEAD 或 origin/main（LOCAL='$LOCAL' REMOTE='$REMOTE'），仓库状态异常，本次跳过"
  exit 1
fi
if [ "$LOCAL" = "$REMOTE" ]; then
  # 无变化：不写日志不占资源，但仍要 ping 一次 —— 这条心跳的意义正是"机器还在按点
  # 跑脚本"，而不是"又部署了一次"。没有它，平静无部署的日子里外部监控什么也收不到。
  hk_ping ok --quiet
  exit 0
fi

# 构建前先看磁盘：空间不足就别构建（构建到一半写满会把镜像写坏）。
# 这一条是本轮唯一被允许的"预防性动作" —— 它不碰 dockerd。
if ! check_disk_before_build; then
  hk_ping fail
  exit 1
fi

log "main 有更新：$LOCAL -> $REMOTE，开始重建"
if ! git reset --hard origin/main >>"$HK_LOG" 2>&1; then
  log "git reset 失败"
  hk_ping fail
  hk_alert "【杭客松】CI 部署失败" "$(date '+%F %T') git reset --hard origin/main 失败（$LOCAL -> $REMOTE）"
  exit 1
fi
if ! docker compose up -d --build >>"$HK_LOG" 2>&1; then
  log "docker compose 构建/启动失败"
  hk_ping fail
  hk_alert "【杭客松】CI 部署失败" "$(date '+%F %T') docker compose up -d --build 失败（提交 $REMOTE）"
  exit 1
fi

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/"; then
    log "已部署 $(git rev-parse --short=7 HEAD) —— 健康检查通过"
    run_post_deploy_checks "$(git rev-parse --short=7 HEAD)"
    checks=$?
    # 部署后检查失败也算这一轮不健康：死人开关要能反映站点在跑但契约坏了
    if [ "$checks" -eq 0 ]; then hk_ping ok; else hk_ping fail; fi
    exit $checks
  fi
  sleep 5
done
log "已部署 $(git rev-parse --short=7 HEAD) 但健康检查未通过"
hk_ping fail
hk_alert "【杭客松】CI 部署后健康检查未通过" "$(date '+%F %T') 提交 $REMOTE 部署后 300 秒内未应答，站点可能处于异常状态"
exit 1
