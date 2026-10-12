#!/bin/sh
# 健康检查：容器状态 + 各路由 HTTP 状态码 + 最近日志。
# 用法：sh /opt/hangkathon/deploy/healthcheck.sh
#
# 修复记录（2026-10-12）：`|| echo FAIL` 把 curl 的失败改写成一段"看起来正常"的输出，
# 且脚本无论发现什么都不影响退出码 —— 拿来当门禁用的时候等于永远通过。
# 现在：不可达记入失败项，脚本以非零退出，可以直接 `sh healthcheck.sh || 告警`。
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
hk_init healthcheck
PORT="$(hk_port)"

failed=0
report() {
  # $1 = 名称，$2 = 结果，$3 = 期望（空表示只打印不判定）
  if [ -z "${3:-}" ]; then
    printf '%-38s %s\n' "$1" "$2"
    return 0
  fi
  if [ "$2" = "$3" ]; then
    printf '%-38s %s\n' "$1" "$2"
  else
    printf '%-38s %s（期望 %s）\n' "$1" "$2" "$3"
    failed=$((failed + 1))
  fi
}

echo "== container =="
docker ps -a --filter name=hangkathon --format '{{.Names}} | {{.Status}} | {{.Ports}}'

echo "== healthcheck state =="
STATE="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' hangkathon 2>/dev/null || true)"
if [ -z "$STATE" ]; then
  report "hangkathon 容器" "缺失" "healthy"
else
  report "hangkathon 容器" "$STATE" "healthy"
fi

echo "== endpoints =="
for p in / /activities /activities/midautumn-poetry /leaderboard /profile /create /auth-error /api/session; do
  # curl 自己带 --max-time；失败时 -w 仍会输出 000，所以用 000 判定而不是 `|| echo FAIL`
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT$p" 2>/dev/null || true)"
  [ -n "$code" ] || code="000"
  case "$p" in
    /auth-error) report "GET $p" "$code" "200" ;;   # 404 也算正常返回
    *)           report "GET $p" "$code" "200" ;;
  esac
done

echo "== static assets =="
for p in /brand/hangkathon-logo-dark.png /brand/hangkathon-logo.png /assets/hangzhou-upgrade-background.png /favicon.ico; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT$p" 2>/dev/null || true)"
  [ -n "$code" ] || code="000"
  report "GET $p" "$code" "200"
done

echo "== recent logs =="
# 应用容器日志驱动已改 journald，`docker logs` 不再可用，走 journalctl
journalctl CONTAINER_NAME=hangkathon -n 25 --no-pager 2>/dev/null \
  || docker logs --tail 25 hangkathon 2>&1 \
  || echo "(无法读取日志：journalctl 与 docker logs 都失败)"

if [ "$failed" -gt 0 ]; then
  echo
  echo "健康检查失败：$failed 项不符合预期" >&2
  exit 1
fi
echo
echo "健康检查通过。"
