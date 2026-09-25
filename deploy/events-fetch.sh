#!/bin/sh
# 每日全球赛事抓取：宿主机 python3 跑 scripts/events/fetch.py，把结果 POST 给应用入库。
# 由 hangkathon-events.timer 每天调用一次；手动跑：sudo systemctl start hangkathon-events.service
set -eu

: "${EVENTS_INGEST_TOKEN:?EVENTS_INGEST_TOKEN 没配置（写在 /opt/hangkathon/.env）}"

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=$(mktemp)
trap 'rm -f "$out"' EXIT

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

# 应用在自己的容器里（127.0.0.1:3210）；入库口自己做令牌校验
curl -fsS --max-time 30 -X POST http://127.0.0.1:3210/api/events/ingest \
  -H "Authorization: Bearer $EVENTS_INGEST_TOKEN" \
  -H "Content-Type: application/json" --data-binary @"$out"
