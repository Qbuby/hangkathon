#!/bin/sh
# 部署 Uptime Kuma 监控栈（幂等）。
#
# 三件事：
#   1. 起 uptime-kuma 容器（绑定 127.0.0.1:3001，公网不可达）
#   2. 部署 uptime.hangkathon.com 的 nginx 反代 + Basic Auth
#   3. 输出需要人工确认的信息（DNS、证书、账号）
#
# 用法：sh deploy/monitoring-setup.sh
set -eu

APP_DIR=/opt/hangkathon
COMPOSE="$APP_DIR/deploy/monitoring.compose.yml"
VHOST_SRC="$APP_DIR/deploy/nginx-uptime.hangkathon.com.conf"
VHOST_DST=/www/server/panel/vhost/nginx/uptime.hangkathon.com.conf
CERT_DIR=/www/server/nginx/cert/uptime.hangkathon.com
HTPASSWD=/etc/nginx/conf.d/kuma.htpasswd
SUBDOMAIN=uptime.hangkathon.com

echo "== 1/3 启动容器 =="
cd "$APP_DIR"
docker compose -f "$COMPOSE" up -d

echo "== 2/3 nginx 反代 =="
[ -f "$VHOST_SRC" ] || { echo "缺少 $VHOST_SRC" >&2; exit 1; }
cp "$VHOST_SRC" "$VHOST_DST"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "  证书缺失，请先签发："
  echo "    cd /root/.acme.sh && sh ./acme.sh --issue --dns dns_ali -d $SUBDOMAIN --keylength ec-256 --server letsencrypt"
  echo "    然后 mkdir -p $CERT_DIR 并把 fullchain.cer/key 复制进去（改名 fullchain.pem / key.pem）"
  exit 1
fi
if [ ! -f "$HTPASSWD" ]; then
  echo "  缺少 $HTPASSWD，请先创建："
  echo "    openssl passwd -apr1 '<你的口令>' | sed 's/^/monitor:/' > $HTPASSWD"
  echo "    chown root:www $HTPASSWD && chmod 640 $HTPASSWD"
  exit 1
fi
nginx -t && nginx -s reload

echo "== 3/3 状态 =="
docker ps --format '{{.Names}}  {{.Status}}' | grep uptime || true
echo "面板地址：https://$SUBDOMAIN/ （Basic Auth：monitor / 见 $HTPASSWD）"
echo "首次访问需要创建管理员账号，之后在 Settings → Notifications 接入告警渠道。"
