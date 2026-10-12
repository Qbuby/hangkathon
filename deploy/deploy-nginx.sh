#!/bin/sh
# 部署 nginx 站点配置：先备份 → 写入 → nginx -t → reload；不通过就回滚并拒绝 reload。
#
# 用法（云助手在服务器执行）：
#   sh /opt/hangkathon/deploy/deploy-nginx.sh
#
# 为什么需要它：直接在服务器手改 vhost 会改坏且无版本记录（踩过一次：location 写到了
# server 块外导致 nginx -t 失败）。这份脚本把"改 → 验证 → 生效/回滚"变成原子步骤。
#
# 修复记录（2026-10-12）：原先 `BACKUP="$VHOST.bak.$(date …)"` 只是拼了个路径字符串，
# **从来没有执行过 cp**，所以校验失败时的 `cp "$BACKUP" "$VHOST"` 必然失败 ——
# 备份不存在、回滚失效，而这个脚本的立身之本就是回滚。现在备份是显式的一步，
# 且回滚前会断言备份确实是个文件，否则明确报错而不是假装恢复成功。
set -eu

APP_DIR="${APP_DIR:-/opt/hangkathon}"
VHOST_DIR=/www/server/panel/vhost/nginx
VHOST="$VHOST_DIR/hangkathon.com.conf"
INC="$VHOST_DIR/hangkathon-proxy-common.inc"
LOG=/var/log/hangkathon-deploy-nginx.log

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "错误：$*"; exit 1; }

STAMP="$(date '+%Y%m%d%H%M%S')"
SRC_DIR="$(dirname "$0")"
SRC_VHOST="$SRC_DIR/nginx-hangkathon.com.conf"
SRC_INC="$SRC_DIR/nginx-proxy-common.inc"

[ -f "$SRC_VHOST" ] || die "缺少源文件 $SRC_VHOST"
[ -f "$SRC_INC" ] || die "缺少源文件 $SRC_INC"
mkdir -p "$VHOST_DIR"

# ── 1) 备份当前生效的两份（vhost + 公共片段）───────────────────────────────
# 片段可能还不存在（首次部署），所以分开判断：只要存在就必须备份成功，否则不往下走。
if [ -f "$VHOST" ]; then
  cp -p "$VHOST" "$VHOST.bak.$STAMP" || die "备份 $VHOST 失败"
  [ -f "$VHOST.bak.$STAMP" ] || die "备份文件未生成：$VHOST.bak.$STAMP"
  VHOST_BACKUP="$VHOST.bak.$STAMP"
  log "已备份 vhost -> $VHOST_BACKUP"
else
  VHOST_BACKUP=""
  log "线上暂无 vhost（首次部署），无备份可留"
fi

if [ -f "$INC" ]; then
  cp -p "$INC" "$INC.bak.$STAMP" || die "备份 $INC 失败"
  INC_BACKUP="$INC.bak.$STAMP"
else
  INC_BACKUP=""
fi

# ── 2) 写入新配置 ──────────────────────────────────────────────────────────
# 顺序：先片段后 vhost。片段单独存在时不会被 include（vhost 才引用它），
# 所以中途失败不会留下"引用不存在的文件"的半成品状态。
cp "$SRC_INC" "$INC" || die "写入 $INC 失败"
cp "$SRC_VHOST" "$VHOST" || die "写入 $VHOST 失败"

# ── 3) 校验；失败则回滚 ────────────────────────────────────────────────────
if nginx -t 2>/tmp/nginx-test.log; then
  nginx -s reload || die "nginx -t 通过但 reload 失败，请检查 nginx 进程状态"
  log "nginx 配置已生效（备份：${VHOST_BACKUP:-无}）"
  exit 0
fi

log "配置校验失败，开始回滚"
cat /tmp/nginx-test.log | tee -a "$LOG" >&2

rollback_ok=1
if [ -n "$VHOST_BACKUP" ] && [ -f "$VHOST_BACKUP" ]; then
  cp -p "$VHOST_BACKUP" "$VHOST" || rollback_ok=0
else
  # 首次部署失败：没有旧版本可回滚，把坏文件移走，让 nginx 回到"没有这个站点"的状态
  rm -f "$VHOST" || rollback_ok=0
fi
if [ -n "$INC_BACKUP" ] && [ -f "$INC_BACKUP" ]; then
  cp -p "$INC_BACKUP" "$INC" || rollback_ok=0
else
  rm -f "$INC" || rollback_ok=0
fi

if [ "$rollback_ok" = "1" ]; then
  log "已回滚到上一份配置（未 reload，线上仍是旧配置生效状态）"
else
  log "ALERT 回滚失败，配置目录处于不一致状态，需要人工介入"
  sh "$APP_DIR/deploy/alert.sh" "【杭客松】nginx 配置回滚失败" \
    "$(hostname) $(date '+%F %T') $VHOST 回滚失败，nginx 未 reload，但目录内文件可能不一致，请人工核对" || true
fi
exit 1
