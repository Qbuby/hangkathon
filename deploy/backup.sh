#!/bin/sh
# 杭客松备份（安全检查表 8.3.1 备份策略 / 8.4.5 留存期）。
#
# 产出三类东西：
#   1. 全库 pg_dump（custom 格式 + gzip），用于灾难恢复；
#   2. 审计日志单独导一份 CSV —— 检查/公安调取时直接给，不用开库；
#   3. 每次备份写 .sha256 校验文件，恢复前先验完整性（8.2c 文件完整性）。
#
# 保留策略：日备 90 份 + 周备（周日）12 份 + 月备（1 号）3 份，三档取并集，统一 90 天口径。
# 凭据只从 .env 读，不写在命令行里。
set -eu

APP_DIR=/opt/hangkathon
BACKUP_DIR=/var/backups/hangkathon
LOG=/var/log/hangkathon-backup.log
RETENTION_DAILY=90
RETENTION_WEEKLY=12
RETENTION_MONTHLY=3

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

# 4) 保留策略：日备 90 天 + 周备 12 份 + 月备 3 份，三档取并集（统一 90 天口径）。
#    早先的写法是三档依次 prune 同一批文件，月备日会把日备也砍到 6 份 ——
#    那样一旦数据库损坏，最新可用备份只有 6 天。现在改成先算保留清单再删。
KEEP="$(mktemp)"
ALL="$(ls -1t "$BACKUP_DIR"/hangkathon-*.dump.gz 2>/dev/null || true)"

keep_basename() { basename "$1" >> "$KEEP"; }

# 日备：最近 14 份
echo "$ALL" | head -n "$RETENTION_DAILY" | while read -r f; do [ -n "$f" ] && keep_basename "$f"; done

ymd_of() { echo "$1" | sed -n 's/^hangkathon-\([0-9]\{8\}\)-.*/\1/p'; }

# 周备：最近 8 份（文件名日期为周日）
i=0
for f in $ALL; do
  ymd=$(ymd_of "$f")
  dow=$(date -d "${ymd:0:4}-${ymd:4:2}-${ymd:6:2}" +%u 2>/dev/null || echo 0)
  if [ "$dow" = "7" ]; then i=$((i + 1)); [ "$i" -le "$RETENTION_WEEKLY" ] && keep_basename "$f"; fi
done

# 月备：最近 6 份（文件名日期为 01 日）
i=0
for f in $ALL; do
  ymd=$(ymd_of "$f")
  if [ "${ymd:6:2}" = "01" ]; then i=$((i + 1)); [ "$i" -le "$RETENTION_MONTHLY" ] && keep_basename "$f"; fi
done

for f in $ALL; do
  if ! grep -qx "$(basename "$f")" "$KEEP"; then
    rm -f "$f" "$f.sha256"
    log "清理过期备份 $(basename "$f")"
  fi
done
rm -f "$KEEP"

log "备份流程结束，目录占用 $(du -sh "$BACKUP_DIR" | cut -f1)"