#!/bin/sh
# 从备份恢复（安全检查表 8.3.1：灾难或介质故障时可恢复）。
#
# 用法：
#   sh deploy/restore.sh /var/backups/hangkathon/hangkathon-YYYYmmdd-HHMMSS.dump.gz          # 演练
#   sh deploy/restore.sh /var/backups/hangkathon/hangkathon-YYYYmmdd-HHMMSS.dump.gz --yes    # 真恢复
#
# 恢复前会先验 sha256；会覆盖现有数据库，必须显式传 --yes。
#
# 修复记录（2026-10-12，两处）：
#   a) `DB_USER`/`DB_NAME` 原先在 source .env **之前**就展开成默认值了，非默认
#      POSTGRES_DB 的部署会去恢复**错误的库**（kubectl 式的"跑完了但跑错了对象"）。
#      现在凭证一律走 hk_init --with-env / db_env()，顺序被固定为"先读 .env 再取值"。
#   b) 切换不原子：DROP DATABASE 成功、RENAME 失败就丢了线上库。现在改成
#      「还原到临时库 → 校验 → 才动线上库」，任一步失败线上库原封不动。
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

HK_LOG="${HK_LOG:-/var/log/hangkathon-restore.log}"
SAFETY_DIR="${SAFETY_DIR:-/var/backups/hangkathon}"
hk_init restore --with-env

CONTAINER="$HK_DB_CONTAINER"

BACKUP=""
CONFIRMED=""
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=1 ;;
    *) BACKUP="$arg" ;;
  esac
done

if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
  echo "用法：$0 <备份文件.dump.gz> [--yes]" >&2
  exit 2
fi

if verify_checksum "$BACKUP"; then
  log "校验通过：$(basename "$BACKUP")"
else
  log "校验失败：备份文件已损坏或缺校验文件，拒绝恢复"
  exit 1
fi

if [ "$CONFIRMED" != "1" ]; then
  log "这是演练模式（未加 --yes）。加 --yes 会清空并覆盖数据库 $DB_NAME。"
  log "恢复演练：解包校验通过，文件 $(du -h "$BACKUP" | cut -f1)"
  exit 0
fi

log "开始恢复到 $DB_NAME（容器 $CONTAINER）"

# ── 1) 先还原到临时库并验证 ────────────────────────────────────────────────
TMP_DB="restore_check_$(date '+%s')"
cleanup_tmp() {
  docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $TMP_DB" >/dev/null 2>&1 || true
}
trap cleanup_tmp EXIT

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $TMP_DB" >/dev/null || { log "临时库清理失败"; exit 1; }
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $TMP_DB" >/dev/null || { log "临时库创建失败"; exit 1; }

# 解包是管道（gunzip | pg_restore），但 pg_restore 在最右端，退出码就是它的，
# 且加了 --exit-on-error，解包失败会让 pg_restore 直接非零退出。
if ! gunzip -c "$BACKUP" | docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$TMP_DB" --no-owner --exit-on-error >/dev/null; then
  log "临时库还原失败，线上库 $DB_NAME 未被动过"
  exit 1
fi

TABLES="$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$TMP_DB" -At -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || true)"
if [ -z "$TABLES" ] || [ "$TABLES" -lt 1 ]; then
  log "临时库还原后没有任何表，判定备份不可用，线上库 $DB_NAME 未被动过"
  exit 1
fi
log "临时库还原成功（public schema 下 $TABLES 张表）"

# ── 2) 切换 ────────────────────────────────────────────────────────────────
# 到这一步临时库已验证可用，丢线上库的风险已经从"备份坏了"降为"切换本身出问题"。
# 切换前给当前库留一份兜底 dump：DROP 之后 RENAME 之前失败还能救回来。
SAFETY="$SAFETY_DIR/pre-restore-$(date '+%Y%m%d-%H%M%S').dump.gz"
mkdir -p "$SAFETY_DIR"
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f /tmp/pre-restore.dump 2>/dev/null \
   && docker cp "$CONTAINER:/tmp/pre-restore.dump" /tmp/pre-restore.dump >/dev/null 2>&1 \
   && gzip -9 -c /tmp/pre-restore.dump > "$SAFETY" 2>/dev/null; then
  rm -f /tmp/pre-restore.dump
  docker exec "$CONTAINER" rm -f /tmp/pre-restore.dump >/dev/null 2>&1 || true
  log "已留存切换前兜底备份：$SAFETY"
else
  rm -f /tmp/pre-restore.dump
  log "警告：切换前兜底备份失败（不影响继续，但本次切换没有退路）"
fi

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME'" >/dev/null \
  || { log "断开现有连接失败，线上库未动"; exit 1; }

# DROP + RENAME 之间没有事务（Postgres 不允许在事务里删库），
# 所以这两条必须连着跑，且都判退出码。
if ! docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $DB_NAME" >/dev/null; then
  log "删除旧库失败，线上库未动，临时库保留（可人工处理）"
  exit 1
fi
if ! docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE $TMP_DB RENAME TO $DB_NAME" >/dev/null; then
  log "ALERT 重命名失败：线上库已删除、临时库仍在（名 $TMP_DB）。"
  log "ALERT 立即执行：ALTER DATABASE $TMP_DB RENAME TO $DB_NAME（或从 $SAFETY 恢复）"
  sh "$APP_DIR/deploy/alert.sh" "【杭客松】数据库恢复中断" \
    "$(hostname) $(date '+%F %T') DROP 成功但 RENAME 失败，临时库 $TMP_DB 与兜底备份 $SAFETY 均保留" || true
  # 不清临时库了，留给人工处理
  trap - EXIT
  exit 1
fi

trap - EXIT
log "恢复完成。请到 /manage 总览确认数据量，并重启应用容器：docker compose up -d"
log "兜底备份（切换前的旧数据）：$SAFETY"
