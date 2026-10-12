#!/bin/sh
# 飞书告警发送（服务器侧统一入口）。
#
# 用法：sh deploy/alert.sh <标题> <正文>
# 不依赖宿主机 node —— 宿主机没有 node，走 node:22-alpine 容器执行（镜像 CI 时已缓存）。
# 任何失败都只记 stderr、不影响调用方的退出码：告警通道本身不该让备份/自检任务失败。
set -u

APP_DIR=/opt/hangkathon
TITLE="${1:-杭客松监控}"
BODY="${2:-（无正文）}"

if ! docker run --rm --network host \
      --env-file "$APP_DIR/.env" \
      -v "$APP_DIR/deploy:/d:ro" \
      node:22-alpine node /d/feishu-alert.mjs "$TITLE" "$BODY" 2>>/var/log/hangkathon-alert.log; then
  echo "$(date '+%F %T') 飞书告警发送失败：$TITLE" >> /var/log/hangkathon-alert.log
  exit 0
fi
echo "$(date '+%F %T') 已发送飞书告警：$TITLE" >> /var/log/hangkathon-alert.log
exit 0