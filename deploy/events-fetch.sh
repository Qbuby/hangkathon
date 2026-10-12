#!/bin/sh
# 每日全球赛事抓取：宿主机跑 scripts/events/fetch.py，把结果 POST 给应用入库。
# 由 hangkathon-events.timer 每天调用一次；手动跑：sudo systemctl start hangkathon-events.service
#
# 修复记录（2026-10-12）：详情回传那步原先写成 `curl … || echo "[events] 详情回传失败（下轮重试）"`，
# 在 `set -e` 下这等于把失败"消灭"在本进程里 —— 每轮都可能静默失败而 systemd 一直看到绿色。
# 现在失败会明确退出非零并写日志（详情回传不是关键路径，但必须留痕）。
set -eu

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
hk_init events
PORT="$(hk_port)"

: "${EVENTS_INGEST_TOKEN:?EVENTS_INGEST_TOKEN 没配置（写在 /opt/hangkathon/.env）}"

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
out=$(mktemp)
ing_res=$(mktemp)
det_out=$(mktemp)
trap 'rm -f "$out" "$ing_res" "$det_out"' EXIT

# 这台机器的默认 python3 是 3.6（ALinux3 自带），抓取脚本要 3.10+；按顺序挑一个够新的
py=
for cand in python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
    py="$cand"
    break
  fi
done
[ -n "$py" ] || { echo "没有找到 python >= 3.10" >&2; exit 1; }

"$py" "$root/scripts/events/fetch.py" >"$out"

# 应用在自己的容器里（127.0.0.1:$PORT）；入库口自己做令牌校验
curl -fsS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/events/ingest" \
  -H "Authorization: Bearer $EVENTS_INGEST_TOKEN" \
  -H "Content-Type: application/json" --data-binary @"$out" >"$ing_res"

# 详情 enrichment：ingest 响应里带还没抓过详情页的赛事清单，逐个补抓正文与海报
if grep -q '"needDetail":\[{' "$ing_res"; then
  "$py" "$root/scripts/events/fetch.py" --enrich-from "$ing_res" >"$det_out"
  if grep -q '"details"' "$det_out"; then
    # 失败不再被 `|| echo` 吞掉：写日志 + 非零退出，下轮 systemd 状态里能看见
    if ! curl -fsS --max-time 60 -X POST "http://127.0.0.1:$PORT/api/events/detail" \
      -H "Authorization: Bearer $EVENTS_INGEST_TOKEN" \
      -H "Content-Type: application/json" --data-binary @"$det_out"; then
      echo "[events] 详情回传失败（下轮重试）" >&2
      exit 1
    fi
  else
    echo "[events] 详情抓取无产出，跳过回传" >&2
  fi
fi
