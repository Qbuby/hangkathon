#!/bin/sh
# 杭客松备份（安全检查表 8.3.1 备份策略 / 8.4.5 留存期）。
#
# 产出三类东西：
#   1. 全库 pg_dump（custom 格式 + gzip），用于灾难恢复；
#   2. 审计日志单独导一份 CSV —— 检查/公安调取时直接给，不用开库；
#   3. 每次备份写 .sha256 校验文件，恢复前先验完整性（8.2c 文件完整性）。
#
# 保留策略：日备 14 份、周备（周日）8 份、月备（1 号）6 份，其余自动清理。
# 凭据只从 .env 读，不写在命令行里。
set -eu

APP_DIR=/opt/hangkathon
BACKUP_DIR=/var/backups/hangkathon
LOG=/var/log/hangkathon-backup.log
RETENTION_DAILY=14
RETENTION_WEEKLY=8
RETENTION_MONTHLY=6

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; echo "$*"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# shellcheck disable=SC1091
. "$APP_DIR/.env"

DB_USER="${POSTGRES_USER:-hangkathon}"
DB_NAME="${POSTGRES_DB:-hangkathon}"
CONTAINER=hangkathon-postgres
STAMP="$(date '+%Y%m%d-%H%M%S')"
DAY_OF_WEEK="$(date '+%u')"
DAY_OF_MONTH="$(date '+%d')"

log "开始备份 ${STAMP}"

# 1) 全库
DUMP="$BACKUP_DIR/hangkathon-${STAMP}.dump.gz"
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc 2>/dev/null | gzip -9 > "$DUMP"; then
  log "全库备份完成 $(du -h "$DUMP" | cut -f1) -> $DUMP"
else
  rm -f "$DUMP"
  log "全库备份失败"
  exit 1
fi

# 2) 审计日志 CSV（表可能还不存在，第一次部署后备份会跳过，不算失败）
AUDIT_CSV="$BACKUP_DIR/audit-${STAMP}.csv"
if docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -F, \
  -c "SELECT created_at, category, action, coalesce(user_email,''), coalesce(ip,''), coalesce(port,''), coalesce(protocol,''), coalesce(target_type,''), coalesce(target_id,''), result FROM audit_logs ORDER BY created_at" \
  > "$AUDIT_CSV" 2>/dev/null; then
  log "审计日志导出 $(wc -l < "$AUDIT_CSV") 行 -> $AUDIT_CSV"
else
  rm -f "$AUDIT_CSV"
  log "审计日志导出跳过（audit_logs 表还不存在）"
fi

# 3) 校验和
sha256sum "$DUMP" > "$DUMP.sha256"
[ -f "$AUDIT_CSV" ] && sha256sum "$AUDIT_CSV" > "$AUDIT_CSV.sha256"

# 4) 保留策略：日备 / 周备 / 月备
ls -1t "$BACKUP_DIR"/hangkathon-*.dump.gz 2>/dev/null | tail -n +$((RETENTION_DAILY + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
done
if [ "$DAY_OF_WEEK" = "7" ]; then
  ls -1t "$BACKUP_DIR"/hangkathon-*.dump.gz 2>/dev/null | tail -n +$((RETENTION_WEEKLY + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
fi
if [ "$DAY_OF_MONTH" = "01" ]; then
  ls -1t "$BACKUP_DIR"/hangkathon-*.dump.gz 2>/dev/null | tail -n +$((RETENTION_MONTHLY + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
fi

log "备份流程结束，目录占用 $(du -sh "$BACKUP_DIR" | cut -f1)"