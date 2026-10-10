#!/bin/sh
# 杭客松 CI：拉取 GitHub main，有变化就重建镜像并重启容器。
# 由 hangkathon-ci.timer 每 3 分钟调用一次，也可以手动执行：sh deploy/ci.sh
set -u

APP_DIR=/opt/hangkathon
PORT="${PORT:-3210}"
KEY=/root/.ssh/hangkathon_deploy
LOG=/var/log/hangkathon-ci.log
LOCK=/tmp/hangkathon-ci.lock

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

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
  for pair in "scripts/ci/smoke.mjs:部署后冒烟" "scripts/security/adversarial.mjs:对抗测试"; do
    script="${pair%%:*}"
    title="${pair#*:}"
    [ -f "$APP_DIR/$script" ] || { log "跳过 $title：$script 不存在"; continue; }
    # 整个 scripts 目录挂进容器：套件之间用相对路径互相 import（../ci/lib.mjs），单挂一个文件会解析失败
    if docker run --rm --network host \
        -e TEST_BASE_URL="http://127.0.0.1:$PORT" \
        -e ADVERSARIAL_ACK=1 \
        -v "$APP_DIR/scripts:/scripts:ro" \
        node:22-alpine node "/$script" >>"$LOG" 2>&1; then
      log "$title 通过（$sha）"
    else
      log "$title 失败（$sha）—— 详见上方输出"
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

if ! git fetch --depth 1 --quiet origin main 2>>"$LOG"; then
  log "git fetch 失败 —— 部署密钥可能还没加到 GitHub，或网络不通"
  exit 0
fi

LOCAL=$(git rev-parse --short=7 HEAD 2>/dev/null || echo none)
REMOTE=$(git rev-parse --short=7 origin/main 2>/dev/null || echo none)
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0   # 无变化，安静退出，不写日志不占资源
fi

log "main 有更新：$LOCAL -> $REMOTE，开始重建"
if ! git reset --hard origin/main >>"$LOG" 2>&1; then
  log "git reset 失败"; exit 1
fi
if ! docker compose up -d --build >>"$LOG" 2>&1; then
  log "docker compose 构建/启动失败"; exit 1
fi

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/"; then
    log "已部署 $(git rev-parse --short=7 HEAD) —— 健康检查通过"
    run_post_deploy_checks "$(git rev-parse --short=7 HEAD)"
    exit $?
  fi
  sleep 5
done
log "已部署 $(git rev-parse --short=7 HEAD) 但健康检查未通过"
exit 1
