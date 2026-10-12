#!/bin/sh
# 每日完整性自检（安全检查表 8.2c 重要文件完整性检测 + 8.4.4 审计日志防篡改）。
#
# 四件事：
#   1. 最近一份备份的 sha256 是否还对得上（备份没被改坏）、是否新鲜；
#   2. 审计日志哈希链是否连续（有人绕过应用直接改库会断链）；
#   3. 容器健康与磁盘水位；
#   4. 悬空镜像堆积（磁盘被吃满的**实际**原因，2026-10-12 实测过）。
# 任何一项不过就写 ALERT 状态文件 + 飞书告警 + 死人开关 fail。
#
# 修复记录（2026-10-12，三处静默失败）：
#   a) 容器健康原先写成 `docker inspect … | while read state; do … done` —— `fail=1` 在
#      **管道子 shell** 里，管道结束就丢了；而且那个分支只 log 不置位。结果是：容器
#      unhealthy 时自检照样写 OK、退出 0。现在用命令替换取值，判定在主 shell 里。
#   b) `psql … || echo 0` 把"数据库连不上"读成"审计日志为空 → OK"。现在用 hk_psql
#      自己判退出码，连不上直接 ALERT。
#   c) `ls … | head -1 || true` 让 ls 的失败与"没有备份"不可区分。现在显式区分。
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

# 路径全部可被环境变量覆盖：本地故障注入演练要用临时目录跑同一份脚本，
# 而不是"复制一份改路径"（改出来的副本永远不会被验证）。
HK_LOG="${HK_LOG:-/var/log/hangkathon-integrity.log}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hangkathon}"
STATUS_FILE="${STATUS_FILE:-/var/run/hangkathon-integrity.status}"
DISK_ALERT_PCT="${DISK_ALERT_PCT:-90}"
DANGLING_ALERT_COUNT="${DANGLING_ALERT_COUNT:-15}"
APP_CONTAINER="${APP_CONTAINER:-hangkathon}"
BACKUP_MAX_AGE="${BACKUP_MAX_AGE:-93600}"

hk_init integrity

# 数值守卫。
#
# 为什么必须有：`[ "$x" -gt 1 ]` 在 $x 不是整数时返回 **2**（错误），而 if 只把非零当
# "不成立"，于是 elif 落到 else 分支 —— 也就是说**垃圾值会被当成通过**。
# 这正是本文件要消灭的那类静默失败，所以每个数值判定前先确认取值真的是数字。
# （这个缺陷是在故障注入测试里用假的 psql 输出 "healthy" 时暴露出来的。）
is_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# ── 1) 最新备份：存在 / 新鲜 / 校验和 ──────────────────────────────────────
if [ ! -d "$BACKUP_DIR" ]; then
  hk_check 0 "备份目录不存在：$BACKUP_DIR"
else
  # 用 find 排序而不是 `ls | head`：管道的退出码取自 head，ls 失败会被吞掉
  LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'hangkathon-*.dump.gz' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-)"
  if [ -z "$LATEST" ]; then
    hk_check 0 "备份目录里没有任何 hangkathon-*.dump.gz"
  elif [ ! -f "$LATEST" ]; then
    hk_check 0 "备份目录里找不到可用文件（find 返回 '$LATEST'）"
  else
    if verify_checksum "$LATEST"; then
      hk_check 1 "备份完整性 $(basename "$LATEST")"
    else
      hk_check 0 "备份校验和不匹配或缺少校验文件：$(basename "$LATEST")"
    fi
    MTIME="$(stat -c '%Y' "$LATEST" 2>/dev/null || true)"
    if ! is_int "$MTIME"; then
      hk_check 0 "读不到备份文件的修改时间（stat 返回 '$MTIME'）"
    else
      AGE=$(( $(date '+%s') - MTIME ))
      if [ "$AGE" -gt "$BACKUP_MAX_AGE" ]; then
        hk_check 0 "最新备份已 $((AGE / 3600)) 小时未更新（阈值 $((BACKUP_MAX_AGE / 3600)) 小时）"
      else
        hk_check 1 "最新备份 $((AGE / 3600)) 小时前生成"
      fi
    fi
  fi
fi

# ── 2) 审计日志哈希链 ──────────────────────────────────────────────────────
# 库连不上要让整条自检失败 —— 这正是审计记录本身不可用的时刻，最不该报 OK。
COUNT="$(hk_psql -At -c "SELECT count(*) FROM audit_logs" 2>/dev/null || true)"
if ! is_int "$COUNT"; then
  hk_check 0 "审计日志不可读（数据库不可达或 audit_logs 缺失，返回 '$COUNT'）—— 无法完成防篡改校验"
elif [ "$COUNT" = "0" ]; then
  hk_check 1 "审计日志为空（还没有安全事件记录）"
else
  # 统计有多少行的 prev_hash 指向一个不存在的 hash —— 正常是 1（创世行），多了就有人插过行
  ORPHANS="$(hk_psql -At -c "SELECT count(*) FROM audit_logs a WHERE a.prev_hash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit_logs b WHERE b.hash = a.prev_hash)" 2>/dev/null || true)"
  if ! is_int "$ORPHANS"; then
    hk_check 0 "审计日志有 $COUNT 条但断链统计查询失败（返回 '$ORPHANS'）"
  elif [ "$ORPHANS" -gt 1 ]; then
    hk_check 0 "审计日志出现 $ORPHANS 条断链记录（正常为 1 条创世行），疑似被直接改库"
  else
    hk_check 1 "审计日志 $COUNT 条，断链候选 $ORPHANS（正常为 1）"
  fi
fi

# ── 3) 容器健康 ────────────────────────────────────────────────────────────
# 命令替换（不是管道）：state 拿在主 shell 里，判定也在这里，fail 不会丢。
APP_STATE="$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null || true)"
if [ -z "$APP_STATE" ]; then
  hk_check 0 "应用容器 $APP_CONTAINER 不存在或 docker 不可用"
elif [ "$APP_STATE" != "healthy" ]; then
  hk_check 0 "应用容器状态 $APP_STATE"
else
  hk_check 1 "应用容器 healthy"
fi

DB_STATE="$(docker inspect -f '{{.State.Health.Status}}' "$HK_DB_CONTAINER" 2>/dev/null || true)"
if [ -z "$DB_STATE" ]; then
  hk_check 0 "数据库容器 $HK_DB_CONTAINER 不存在或 docker 不可用"
elif [ "$DB_STATE" != "healthy" ]; then
  hk_check 0 "数据库容器状态 $DB_STATE"
else
  hk_check 1 "数据库容器 healthy"
fi

# ── 4) 磁盘与镜像堆积 ──────────────────────────────────────────────────────
DISK="$(df -h / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if ! is_int "$DISK"; then
  hk_check 0 "读不到根分区使用率（返回 '$DISK'）"
elif [ "$DISK" -ge "$DISK_ALERT_PCT" ]; then
  hk_check 0 "磁盘使用率 ${DISK}%（阈值 ${DISK_ALERT_PCT}%）"
else
  hk_check 1 "磁盘使用率 ${DISK}%"
fi

# 悬空镜像：每次 CI 重建都留下一个 <none> layer，58 个就吃掉十几 GB ——
# 这是磁盘被打满的真实原因（2026-10-12 观察到 99%）。这是自检里唯一能
# **提前**发现它的地方。清理方式是 `docker image prune -f`，
# 绝不要用 `docker system prune`（会连运行中的容器和 compose 网络一起删，踩过）。
DANGLING="$(docker images -f 'dangling=true' -q 2>/dev/null | wc -l || true)"
DANGLING="$(printf '%s' "$DANGLING" | tr -d '[:space:]')"
DANGLING_GB="$(docker system df 2>/dev/null | awk '/^Images/ {print $4}')"
if ! is_int "$DANGLING"; then
  hk_check 0 "无法统计悬空镜像（返回 '$DANGLING'，docker 不可用？）"
elif [ "$DANGLING" -ge "$DANGLING_ALERT_COUNT" ]; then
  hk_check 0 "悬空镜像 $DANGLING 个（阈值 ${DANGLING_ALERT_COUNT}），可回收 ${DANGLING_GB:-未知}；执行 docker image prune -f"
else
  hk_check 1 "悬空镜像 $DANGLING 个（可回收 ${DANGLING_GB:-未知}）"
fi

hk_finish \
  "【杭客松】完整性自检告警" \
  "服务器 $(hostname) 于 $(date '+%F %T') 自检未通过：$HK_CHECK_FAILED/$HK_CHECK_TOTAL 项异常，明细见 $HK_LOG" \
  "$STATUS_FILE"
