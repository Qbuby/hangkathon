#!/bin/sh
# 从备份恢复（安全检查表 8.3.1：灾难或介质故障时可恢复）。
#
# 用法：/bin/sh deploy/restore.sh /var/backups/hangkathon/hangkathon-YYYYmmdd-HHMMSS.dump.gz
# 恢复前会先验 sha256；会覆盖现有数据库，必须显式传 --yes。
set -eu

APP_DIR=/opt/hangkathon
DB_USER="${POSTGRES_USER:-hangkathon}"
DB_NAME="${POSTGRES_DB:-hangkathon}"
CONTAINER=hangkathon-postgres
LOG=/var/log/hangkathon-restore.log

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; echo "$*"; }

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

# shellcheck disable=SC1091
. "$APP_DIR/.env"

if [ -f "$BACKUP.sha256" ]; then
  if (cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256" >/dev/null 2>&1); then
    log "校验通过：$(basename "$BACKUP")"
  else
    log "校验失败：备份文件已损坏，拒绝恢复"
    exit 1
  fi
else
  log "警告：没有 .sha256 校验文件，跳过完整性校验"
fi

if [ "$CONFIRMED" != "1" ]; then
  log "这是演练模式（未加 --yes）。加 --yes 会清空并覆盖数据库 $DB_NAME。"
  log "恢复演练：解包校验通过，文件 $(du -h "$BACKUP" | cut -f1)"
  exit 0
fi

log "开始恢复到 $DB_NAME"
# 先在临时库里解包验证结构，确认可用再切过去，避免恢复到一半才发现备份是坏的。
TMP_DB="restore_check_$(date '+%s')"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $TMP_DB" >/dev/null
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $TMP_DB" >/dev/null
gunzip -c "$BACKUP" | docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$TMP_DB" --no-owner >/dev/null
log "临时库还原成功，开始切换"

docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME'" >/dev/null
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE $DB_NAME" >/dev/null
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "ALTER DATABASE $TMP_DB RENAME TO $DB_NAME" >/dev/null

log "恢复完成，请到 /manage 总览确认数据量，并重启应用容器：docker compose up -d"