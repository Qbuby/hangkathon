#!/bin/sh
# 每日全球赛事抓取：宿主机 python3 跑 scripts/events/fetch.py，把结果 POST 给应用入库。
# 由 hangkathon-events.timer 每天调用一次；手动跑：sudo systemctl start hangkathon-events.service
set -eu

: "${EVENTS_INGEST_TOKEN:?EVENTS_INGEST_TOKEN 没配置（写在 /opt/hangkathon/.env）}"

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
out=$(mktemp)
trap 'rm -f "$out"' EXIT

python3 "$root/scripts/events/fetch.py" >"$out"

# 应用在自己的容器里（127.0.0.1:3210）；入库口自己做令牌校验
curl -fsS --max-time 30 -X POST http://127.0.0.1:3210/api/events/ingest \
  -H "Authorization: Bearer $EVENTS_INGEST_TOKEN" \
  -H "Content-Type: application/json" --data-binary @"$out"
