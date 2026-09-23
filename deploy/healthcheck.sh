#!/bin/sh
# 健康检查：容器状态 + 各路由 HTTP 状态码 + 最近日志。
# 用法：sh /opt/hangkathon/deploy/healthcheck.sh
set -u

PORT="${PORT:-3210}"

echo "== container =="
docker ps -a --filter name=hangkathon --format '{{.Names}} | {{.Status}} | {{.Ports}}'
echo "== healthcheck state =="
docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' hangkathon 2>/dev/null || echo "container missing"

echo "== endpoints =="
for p in / /activities /activities/midautumn-poetry /leaderboard /profile /create /auth-error /api/session; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://127.0.0.1:$PORT$p" 2>/dev/null || echo FAIL)
  echo "$p -> $code"
done

echo "== static assets =="
for p in /brand/hangkathon-logo-dark.png /brand/hangkathon-logo.png /assets/hangzhou-upgrade-background.png /favicon.ico; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://127.0.0.1:$PORT$p" 2>/dev/null || echo FAIL)
  echo "$p -> $code"
done

echo "== recent logs =="
docker logs --tail 25 hangkathon 2>&1 || true
