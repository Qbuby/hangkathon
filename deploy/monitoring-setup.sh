#!/bin/sh
# 部署 Uptime Kuma 监控栈（幂等）。
#
# 四件事：
#   1. 起 uptime-kuma 容器（绑定 127.0.0.1:3001，公网不可达）
#   2. 把公共反代头片段与 uptime vhost 原子部署（走 deploy-nginx.sh 的 校验/回滚 路径）
#   3. 输出需要人工确认的信息（DNS、证书、账号）
#
# 修复记录（2026-10-12）：原先直接 `cp "$VHOST_SRC" "$VHOST_DST"` 覆盖**正在生效**的
# vhost，既没有 nginx -t 前置也没有备份 —— 这正是本项目历史上"改坏线上 vhost"的复现路径。
# 现在 vhost 落盘一律走 deploy-nginx.sh（备份 → 写入 → nginx -t → reload 或回滚）。
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
hk_init monitoring-setup

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
[ -f "$APP_DIR/deploy/nginx-proxy-common.inc" ] || { echo "缺少 nginx-proxy-common.inc" >&2; exit 1; }

# 前置条件先查全，缺什么一次性列出来 —— 不要先 cp 了配置再因为缺证书失败
missing=0
if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
  echo "  证书缺失，请先签发：" >&2
  echo "    cd /root/.acme.sh && sh ./acme.sh --issue --dns dns_ali -d $SUBDOMAIN --keylength ec-256 --server letsencrypt" >&2
  echo "    然后 mkdir -p $CERT_DIR 并把 fullchain.cer/key 复制进去（改名 fullchain.pem / key.pem）" >&2
  missing=1
fi
if [ ! -f "$HTPASSWD" ]; then
  echo "  缺少 $HTPASSWD，请先创建：" >&2
  echo "    openssl passwd -apr1 '<你的口令>' | sed 's/^/monitor:/' > $HTPASSWD" >&2
  echo "    chown root:www $HTPASSWD && chmod 640 $HTPASSWD" >&2
  missing=1
fi
if [ "$missing" = "1" ]; then
  echo "  容器已启动（步骤 1 成功），但 nginx 反代未部署 —— 补全上面的凭据后重跑本脚本。" >&2
  exit 1
fi

# 公共片段先落盘（uptime vhost 的 include 引用它），再走 deploy-nginx.sh 部署主站。
# 主站部署脚本会一并把片段与主站 vhost 原子换掉，这里不重复做。
cp "$APP_DIR/deploy/nginx-proxy-common.inc" /www/server/panel/vhost/nginx/hangkathon-proxy-common.inc

# uptime vhost 自己先备份再写，然后 nginx -t；失败回滚。
BAK=""
if [ -f "$VHOST_DST" ]; then
  BAK="$VHOST_DST.bak.$(date '+%Y%m%d%H%M%S')"
  cp -p "$VHOST_DST" "$BAK"
fi
cp "$VHOST_SRC" "$VHOST_DST"
if ! nginx -t 2>/tmp/nginx-test.log; then
  echo "配置校验失败，回滚：" >&2
  cat /tmp/nginx-test.log >&2
  if [ -n "$BAK" ] && [ -f "$BAK" ]; then
    cp -p "$BAK" "$VHOST_DST"
    echo "已恢复到 $BAK" >&2
  else
    rm -f "$VHOST_DST"
    echo "首次部署无备份，已移除坏配置" >&2
  fi
  exit 1
fi
nginx -s reload

echo "== 3/3 状态 =="
docker ps --format '{{.Names}}  {{.Status}}' | grep uptime || echo "（未发现 uptime 容器，请检查步骤 1）"
echo "面板地址：https://$SUBDOMAIN/ （Basic Auth：monitor / 见 $HTPASSWD）"
echo "首次访问需要创建管理员账号，之后在 Settings → Notifications 接入告警渠道。"
