#!/bin/sh
# 部署 nginx 站点配置：先 nginx -t，通过才 reload；不通过就恢复备份并拒绝 reload。
#
# 用法（云助手在服务器执行）：
#   cp deploy/nginx-hangkathon.com.conf /www/server/panel/vhost/nginx/hangkathon.com.conf
#   sh deploy/deploy-nginx.sh
#
# 为什么需要它：直接在服务器手改 vhost 会改坏且无版本记录（踩过一次：location 写到了
# server 块外导致 nginx -t 失败）。这份脚本把"改 → 验证 → 生效/回滚"变成原子步骤。
set -eu

VHOST=/www/server/panel/vhost/nginx/hangkathon.com.conf
SRC="$(dirname "$0")/nginx-hangkathon.com.conf"
BACKUP="$VHOST.bak.$(date '+%Y%m%d%H%M%S')"

cp "$SRC" "$VHOST"
if nginx -t 2>/tmp/nginx-test.log; then
  nginx -s reload
  echo "nginx 配置已生效（备份：$BACKUP）"
else
  cp "$BACKUP" "$VHOST"
  echo "配置校验失败，已恢复上一份（未 reload，线上仍是旧配置生效状态）" >&2
  cat /tmp/nginx-test.log >&2
  exit 1
fi