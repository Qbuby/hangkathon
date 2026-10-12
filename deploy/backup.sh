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
#
# 修复记录（2026-10-12）：原先 `pg_dump … | gzip -9 > "$DUMP"` 是**管道**，退出码取的是
# gzip（几乎总是 0），pg_dump 失败被完全掩盖 —— 结果是：数据库连不上也能产出一个 20 字节
# 的"成功"备份、照常算 sha256、照常进保留清单，恢复时才发现是空的。
# 现在改成 pg_dump 直接在容器里落文件（-f），再 docker cp 出来，最后才压缩：
# 三段各自判退出码，任何一段失败都 exit 1 且不留文件。
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

HK_LOG="${HK_LOG:-/var/log/hangkathon-backup.log}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hangkathon}"
RETENTION_DAILY=90
RETENTION_WEEKLY=12
RETENTION_MONTHLY=3

hk_init backup --with-env
CONTAINER="$HK_DB_CONTAINER"

# 刻意不再本地定义 log()：common.sh 里那份已经加了时间戳、按 HK_LOG 落盘、并在
# hk_init 里 mkdir -p 日志目录。各脚本各定义一份（原先 5 份）就是漂移的源头。

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
log "开始备份 ${STAMP}"
hk_ping start

fail() {
  log "ALERT $1"
  hk_alert "【杭客松】备份失败" "$(date '+%F %T') $1，明细见 $HK_LOG"
  hk_ping fail
  exit 1
}

# ── 1) 全库 ────────────────────────────────────────────────────────────────
# 三段式，无管道：容器内落盘 -> docker cp -> 压缩。任何一段非零立刻失败。
DUMP="$BACKUP_DIR/hangkathon-${STAMP}.dump.gz"
INNER="/tmp/hangkathon-${STAMP}.dump"

if ! docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f "$INNER" 2>>"$HK_LOG"; then
  docker exec "$CONTAINER" rm -f "$INNER" >/dev/null 2>&1 || true
  fail "全库 pg_dump 失败（容器 $CONTAINER，库 $DB_NAME）"
fi
# pg_dump 返回 0 但文件为空也是灾难（例如权限问题写出 0 字节），显式拦一道
INNER_SIZE="$(docker exec "$CONTAINER" stat -c '%s' "$INNER" 2>/dev/null || echo 0)"
if [ "${INNER_SIZE:-0}" -lt 1024 ]; then
  docker exec "$CONTAINER" rm -f "$INNER" >/dev/null 2>&1 || true
  fail "pg_dump 产物异常（${INNER_SIZE} 字节，期望 >1KB），拒绝入库"
fi
if ! docker cp "$CONTAINER:$INNER" "$BACKUP_DIR/hangkathon-${STAMP}.dump" 2>>"$HK_LOG"; then
  docker exec "$CONTAINER" rm -f "$INNER" >/dev/null 2>&1 || true
  fail "docker cp 导出 dump 失败"
fi
docker exec "$CONTAINER" rm -f "$INNER" >/dev/null 2>&1 || true

if ! gzip -9 "$BACKUP_DIR/hangkathon-${STAMP}.dump" 2>>"$HK_LOG"; then
  rm -f "$BACKUP_DIR/hangkathon-${STAMP}.dump"
  fail "gzip 压缩失败"
fi
log "全库备份完成 $(du -h "$DUMP" | cut -f1) -> $DUMP"

# ── 2) 审计日志 CSV ────────────────────────────────────────────────────────
# 表可能还不存在（首次部署）—— 那种情况不算失败。但**其他**错误必须报出来：
# 原先 `psql … 2>/dev/null` 把连不上数据库也伪装成"表不存在，跳过"。
#
# 用 SQL 自己判断表是否存在（to_regclass 不报错，返回 NULL），这样能把
# "表不存在"与"库连不上"分开：前者正常跳过，后者是故障。
AUDIT_CSV="$BACKUP_DIR/audit-${STAMP}.csv"
TABLE_EXISTS="$(hk_psql -At -c "SELECT to_regclass('public.audit_logs') IS NOT NULL" 2>/dev/null || true)"
if [ -z "$TABLE_EXISTS" ]; then
  fail "数据库不可达或查询失败：无法确认 audit_logs 是否存在"
elif [ "$TABLE_EXISTS" != "t" ]; then
  log "审计日志跳过：audit_logs 表还不存在（首次部署前的正常情况）"
else
  if hk_psql -At -F, -c "SELECT created_at, category, action, coalesce(user_email,''), coalesce(ip,''), coalesce(port,''), coalesce(protocol,''), coalesce(target_type,''), coalesce(target_id,''), result FROM audit_logs ORDER BY created_at" > "$AUDIT_CSV" 2>>"$HK_LOG"; then
    log "审计日志导出 $(wc -l < "$AUDIT_CSV") 行 -> $AUDIT_CSV"
  else
    rm -f "$AUDIT_CSV"
    fail "审计日志导出失败（表存在但查询报错）"
  fi
fi

# ── 3) 校验和 ──────────────────────────────────────────────────────────────
sha256sum "$DUMP" > "$DUMP.sha256"
if [ -f "$AUDIT_CSV" ]; then
  sha256sum "$AUDIT_CSV" > "$AUDIT_CSV.sha256"
fi
# 立刻回验一次：写完不验证等于没写（磁盘坏块、写到一半断电都发现不了）
if ! verify_checksum "$DUMP"; then
  fail "刚生成的备份校验和不匹配（磁盘问题？）"
fi

# ── 4) 保留策略：日备 90 份 + 周备 12 份 + 月备 3 份，三档取并集（统一 90 天口径）──
#    早先的写法是三档依次 prune 同一批文件，月备日会把日备也砍到 6 份 ——
#    那样一旦数据库损坏，最新可用备份只有 6 天。现在改成先算保留清单再删。
KEEP="$(mktemp)"
trap 'rm -f "$KEEP"' EXIT
ALL="$(ls -1t "$BACKUP_DIR"/hangkathon-*.dump.gz 2>/dev/null || true)"

keep_basename() { basename "$1" >> "$KEEP"; }

# 日备：最近 90 份
echo "$ALL" | head -n "$RETENTION_DAILY" | while read -r f; do [ -n "$f" ] && keep_basename "$f"; done

ymd_of() { echo "$1" | sed -n 's/^hangkathon-\([0-9]\{8\}\)-.*/\1/p'; }

# 周备：最近 12 份（文件名日期为周日）
i=0
for f in $ALL; do
  ymd=$(ymd_of "$f")
  # 日期解析失败不再改写成 0：`|| echo 0` 会让损坏的文件名被当成非周日，
  # 从而提前跌出周备保留清单。取不到就标成 "?"，不作为周日候选，交给日备档兜住。
  #
  # 用 cut 取子串而不是 ${ymd:0:4}：后者是 bash 扩展，本脚本 shebang 是 /bin/sh。
  # 这台机器上 /bin/sh 恰好是 bash 所以能跑，但靠 shell 实现兜底的写法不该留在运维脚本里。
  yy=$(printf '%s' "$ymd" | cut -c1-4)
  mm=$(printf '%s' "$ymd" | cut -c5-6)
  dd=$(printf '%s' "$ymd" | cut -c7-8)
  dow=$(date -d "$yy-$mm-$dd" +%u 2>/dev/null || echo "?")
  if [ "$dow" = "7" ]; then i=$((i + 1)); [ "$i" -le "$RETENTION_WEEKLY" ] && keep_basename "$f"; fi
done

# 月备：最近 3 份（文件名日期为 01 日）
i=0
for f in $ALL; do
  ymd=$(ymd_of "$f")
  if [ "$(printf '%s' "$ymd" | cut -c7-8)" = "01" ]; then
    i=$((i + 1)); [ "$i" -le "$RETENTION_MONTHLY" ] && keep_basename "$f"
  fi
done

for f in $ALL; do
  if ! grep -qx "$(basename "$f")" "$KEEP"; then
    rm -f "$f" "$f.sha256"
    log "清理过期备份 $(basename "$f")"
  fi
done
rm -f "$KEEP"
trap - EXIT

SIZE="$(du -sh "$BACKUP_DIR" | cut -f1)"
log "备份流程结束，目录占用 $SIZE"
hk_alert "【杭客松】备份完成" "$(date '+%F %T') 备份成功，体积 $SIZE"
hk_ping ok
