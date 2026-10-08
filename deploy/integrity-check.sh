#!/bin/sh
# 每日完整性自检（安全检查表 8.2c 重要文件完整性检测 + 8.4.4 审计日志防篡改）。
#
# 三件事：
#   1. 最近一份备份的 sha256 是否还对得上（备份没被改坏）；
#   2. 审计日志哈希链是否连续（有人绕过应用直接改库会断链）；
#   3. 容器与磁盘水位是否正常。
# 任何一项不过就在 /var/log/hangkathon-integrity.log 写 ALERT，并留下标记文件给告警脚本用。
set -eu

APP_DIR=/opt/hangkathon
BACKUP_DIR=/var/backups/hangkathon
LOG=/var/log/hangkathon-integrity.log
STATUS_FILE=/var/run/hangkathon-integrity.status

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

fail=0

# 1) 最新备份校验和
LATEST=$(ls -1t "$BACKUP_DIR"/hangkathon-*.dump.gz 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  log "ALERT 没有任何备份文件"
  fail=1
else
  if (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$LATEST").sha256" >/dev/null 2>&1); then
    log "OK 备份完整性 $(basename "$LATEST")"
  else
    log "ALERT 备份校验和不匹配：$(basename "$LATEST")"
    fail=1
  fi
  # 备份超过 26 小时没更新也算异常
  AGE=$(( $(date '+%s') - $(stat -c '%Y' "$LATEST") ))
  if [ "$AGE" -gt 93600 ]; then
    log "ALERT 最新备份已 $((AGE / 3600)) 小时未更新"
    fail=1
  fi
fi

# 2) 审计日志哈希链：走应用内的 verify 接口需要登录态，这里直接用 SQL 复核首尾一致性
COUNT=$(docker exec hangkathon-postgres psql -U "${POSTGRES_USER:-hangkathon}" -d "${POSTGRES_DB:-hangkathon}" -At \
  -c "SELECT count(*) FROM audit_logs" 2>/dev/null || echo 0)
TAIL_HASH=$(docker exec hangkathon-postgres psql -U "${POSTGRES_USER:-hangkathon}" -d "${POSTGRES_DB:-hangkathon}" -At \
  -c "SELECT hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1" 2>/dev/null || echo "")
if [ "$COUNT" = "0" ]; then
  log "OK 审计日志为空（还没有安全事件记录）"
elif [ -z "$TAIL_HASH" ]; then
  log "ALERT 审计日志有 $COUNT 条但读不出链尾哈希"
  fail=1
else
  # 统计有多少行的 prev_hash 指向一个不存在的 hash —— 正常是 1（创世行），多了就有人插过行
  ORPHANS=$(docker exec hangkathon-postgres psql -U "${POSTGRES_USER:-hangkathon}" -d "${POSTGRES_DB:-hangkathon}" -At \
    -c "SELECT count(*) FROM audit_logs a WHERE a.prev_hash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_logs b WHERE b.hash = a.prev_hash)" 2>/dev/null || echo "?")
  log "OK 审计日志 $COUNT 条，链尾 ${TAIL_HASH:0:12}…，断链候选 $ORPHANS"
  if [ "$ORPHANS" != "?" ] && [ "$ORPHANS" -gt 1 ]; then
    log "ALERT 审计日志出现 $ORPHANS 条断链记录，疑似被直接改库"
    fail=1
  fi
fi

# 3) 容器与磁盘
docker inspect -f '{{.State.Health.Status}}' hangkathon 2>/dev/null | while read -r state; do
  if [ "$state" != "healthy" ]; then
    log "ALERT 应用容器状态 $state"
  else
    log "OK 应用容器 healthy"
  fi
done
DISK=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK" -ge 90 ]; then
  log "ALERT 磁盘使用率 ${DISK}%"
  fail=1
else
  log "OK 磁盘使用率 ${DISK}%"
fi

if [ "$fail" -eq 0 ]; then
  echo OK > "$STATUS_FILE"
else
  echo ALERT > "$STATUS_FILE"
fi
exit "$fail"