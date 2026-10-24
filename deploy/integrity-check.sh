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
# 阈值必须**高于每次 CI 部署的正常产出**，否则这条告警会变成天天报的噪音，
# 自检的"未通过"就不再有信号价值（2026-10-17 实测：一次构建留下 18 个 <none>，
# 阈值却是 15，于是每次部署后必然 1/8 异常）。
# 真正需要报警的是"连续几个部署没清理"——实测堆到几百个 overlay 时能吃 30GB。
# 取 40：约两个部署周期的正常产出。
DANGLING_ALERT_COUNT="${DANGLING_ALERT_COUNT:-40}"
DOCKERD_ALERT_MB="${DOCKERD_ALERT_MB:-900}"
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

# 悬空镜像：每次 CI 重建都留下一个 <none> layer（实测 2026-10-12 有 31 个）——
# 它们会稳定占用磁盘，是磁盘水位上涨的主要来源。这里**只统计、只告警，不自动删**：
# 清理是人工决策（`docker image prune -f`），自检脚本不该在半夜动宿主机的镜像。
#
# 三条纪律：
#   1. **不用 `docker system df`**：2026-10-12 实测这条命令在本机会长时间挂住
#      （它要遍历所有层算可回收空间），而自检脚本被它拖住时，systemd 那边的
#      TimeoutStartSec 会把整次自检判成失败 —— 一个查询命令不该有这种能力。
#      改用 `docker images -f dangling=true -q | wc -l`，快且够用。
#   2. **绝不 `docker system prune`**（历史事故：会删掉运行中的容器与 compose 网络，站点直接 502）。
#   3. 计划任务是每日 04:10，比 CI 每次重建滞后最多一天；这只是个提醒，不是实时看板。
#
# 2026-10-22 复盘（磁盘 98% 告警的真正原因）：
#   悬空镜像只有 20 个、`docker image prune -f` 回收 **0B** —— 因为每次 CI 是用
#   `docker build` 重建同名镜像，旧镜像的 layer 被 buildkit 缓存继续引用，
#   并不是 dangling。真正吃掉 26G 的是 **buildkit 构建缓存**
#   （`/var/lib/docker/buildkit`，每次构建一个约 1.3GB 的 standalone 层）。
#   人工执行 `docker builder prune -f` 后：98% → 75%，可用空间 1.1G → 9.6G。
#   因此这里增加一项独立的 buildkit 缓存统计（只读，不删）。
DANGLING="$(docker images -f 'dangling=true' -q 2>/dev/null | wc -l || true)"
DANGLING="$(printf '%s' "$DANGLING" | tr -d '[:space:]')"
if ! is_int "$DANGLING"; then
  hk_check 0 "无法统计悬空镜像（返回 '$DANGLING'，docker 不可用？）"
elif [ "$DANGLING" -ge "$DANGLING_ALERT_COUNT" ]; then
  hk_check 0 "悬空镜像 $DANGLING 个（阈值 ${DANGLING_ALERT_COUNT}），需**人工** docker image prune -f 回收（脚本不会自动删；绝不要用 docker system prune）"
else
  hk_check 1 "悬空镜像 $DANGLING 个"
fi

# buildkit 构建缓存：**磁盘水位上涨的真正主因**（见上方 2026-10-22 复盘）。
# `du` 在 overlay2 上有硬链接重复计数问题，不能用来判总量；这里只量 buildkit
# 自己的目录（它是纯文件，没有挂载嵌套），阈值取 3GB —— 约等于 2 次完整构建。
#
# 为什么只告警不自动清：`docker builder prune` 在本机会让 dockerd 短暂无响应
# （2026-10-22 实测：命令输出超时，但清理其实已经完成）。半夜自动执行有可能
# 撞上备份或部署，把一个"省空间"的动作变成故障源。人工在低峰执行更安全。
BUILDKIT_ALERT_MB="${BUILDKIT_ALERT_MB:-3072}"
BUILDKIT_DIR="${BUILDKIT_DIR:-/var/lib/docker/buildkit}"
if [ ! -d "$BUILDKIT_DIR" ]; then
  hk_check 1 "buildkit 缓存目录不存在（未使用 buildkit？）"
else
  BUILDKIT_MB="$(du -sm "$BUILDKIT_DIR" 2>/dev/null | cut -f1 || true)"
  if ! is_int "${BUILDKIT_MB:-}"; then
    hk_check 0 "读不到 buildkit 缓存大小（du 返回 '${BUILDKIT_MB:-}'）"
  elif [ "$BUILDKIT_MB" -ge "$BUILDKIT_ALERT_MB" ]; then
    hk_check 0 "buildkit 构建缓存 ${BUILDKIT_MB}MB（阈值 ${BUILDKIT_ALERT_MB}MB）—— 这是磁盘上涨主因，人工在低峰执行 docker builder prune -f（注意该命令会让 dockerd 短暂无响应，不要放进定时任务）"
  else
    hk_check 1 "buildkit 构建缓存 ${BUILDKIT_MB}MB"
  fi
fi

# dockerd 内存：这台 2C2G 机器上 dockerd 的 RSS 会缓慢增长，涨到 ~1.4GB 时被内核
# OOM 杀掉，**连带把三个容器一起带走**，站点变 502 且不会自己恢复
# （restart: unless-stopped 不覆盖"守护进程整个没了"这种情况）。
#
# 2026-10-12 复盘：当天 13 次 dockerd OOM 集中爆发在一次排查过程中 ——
# 每次都是「dockerd 的 RSS 涨到 ~1.4GB → 内核 OOM 杀 dockerd → 三个容器一起消失 → 502」，
# 且不会自愈（容器 restart 策略不覆盖"守护进程整个没了"）。
# 触发点之一是 `docker system df`（宝塔面板的 docker 模块也用它，
# /www/server/panel/class/btdockerModel/statusModel.py:282）：这条命令要遍历全部镜像层
# 算可回收空间，在本机会长时间挂住、把 dockerd RSS 顶到 GB 级。
# 我一度把它抄进了本文件，等于给生产环境装了个定时炸弹，已移除。
# 教训：**往关键脚本里加外部命令前，先确认它在这台机器上是稳定的** ——
# 一个"只是查一下"的命令不该有把站点打挂的能力。
#
# 这里只做检测 + 告警：超过阈值就该人工 `systemctl restart docker`（约 30 秒，
# 容器的 restart 策略会把它们带回来）。自动重启会打断正在跑的备份/部署，风险更大。
DOCKERD_RSS_KB="$(ps -o rss= -p "$(pidof dockerd 2>/dev/null)" 2>/dev/null | tr -d '[:space:]' || true)"
DOCKERD_ALERT_MB="${DOCKERD_ALERT_MB:-900}"
if ! is_int "$DOCKERD_RSS_KB"; then
  hk_check 0 "读不到 dockerd 的内存占用（ps 返回 '$DOCKERD_RSS_KB'）"
elif [ "$((DOCKERD_RSS_KB / 1024))" -ge "$DOCKERD_ALERT_MB" ]; then
  hk_check 0 "dockerd 内存 $((DOCKERD_RSS_KB / 1024))MB（阈值 ${DOCKERD_ALERT_MB}MB）—— 接近 OOM 会在杀守护进程时带走所有容器，执行 systemctl restart docker"
else
  hk_check 1 "dockerd 内存 $((DOCKERD_RSS_KB / 1024))MB"
fi

# 容器 OOM 优先级：必须比构建进程（-500）更受保护。
#
# 2026-10-24 事故：机器只有 1870MB 内存，一次 next build 峰值约 1.4GB，构建期可用
# 内存只剩 ~1.1GB → 内核 OOM。而**被杀的是运行中的站点**：
#   · 构建进程继承 dockerd 的 oom_score_adj=-500 → 受保护；
#   · 运行中的 next-server / uptime node（adj=0）→ 挨刀 → 站点 502、监控自己重启。
# 结果每次部署必出一条 Down 再一条 Up（Uptime Kuma 告警里的那两个）。
#
# 这里查 compose 里有没有把长期服务设成更低的 adj（-900）。真被改了或被手工
# `docker update` 覆盖过，这里会报出来 —— 少了它，下次部署又会重演。
check_oom_priority() {
  _expected='oom_score_adj: -900'
  _bad=0
  _checked=0
  for _f in "$APP_DIR/docker-compose.yml" "$APP_DIR/deploy/monitoring.compose.yml"; do
    if [ ! -f "$_f" ]; then
      continue
    fi
    _checked=$((_checked + 1))
    if grep -q "$_expected" "$_f"; then
      _n="$(grep -c "$_expected" "$_f" || true)"
      log "OK $(basename "$_f") 长期服务 OOM 优先级 $_expected（$_n 处）"
    else
      log "ALERT $(basename "$_f") 缺少 '$_expected' —— 构建期 OOM 会优先杀掉运行中的站点"
      _bad=$((_bad + 1))
    fi
  done
  # 一个都没查到（比如开发机没有这两个文件）不算异常，只说明本项无从检查。
  [ "$_checked" -eq 0 ] && return 0
  return "$_bad"
}
if check_oom_priority; then
  hk_check 1 "长期服务的 OOM 优先级（-900）配置在位"
else
  hk_check 0 "长期服务的 OOM 优先级（-900）配置缺失 —— 部署期 OOM 会误杀运行中的站点"
fi

# swap 可用性：swappiness=0 时内核**宁可不换出也直接杀进程**（阿里云镜像的默认值）。
# 2026-10-24 的 OOM 就是被这个放大的：机器上有 2.3GB 空闲 swap，却因为
# swappiness=0 没用上，直接把运行中的站点杀了。
#
# 读不到就不算异常：这台检查也会在开发机（无 /proc）上跑，
# 读不到只能说明"这个环境不适用"，不能算自检失败。
SWAPPINESS="$(cat /proc/sys/vm/swappiness 2>/dev/null || echo '')"
case "$SWAPPINESS" in
  ''|*[!0-9]*) log "注：读不到 vm.swappiness（返回 '$SWAPPINESS'），本项跳过" ;;
  0) hk_check 0 "vm.swappiness=0 —— 内核不会用 swap 换出，内存紧张时直接杀进程（应设为 10）" ;;
  *) hk_check 1 "vm.swappiness=${SWAPPINESS}（>0，内存紧张时会先换出而不是直接杀进程）" ;;
esac

hk_finish \
  "【杭客松】完整性自检告警" \
  "服务器 $(hostname) 于 $(date '+%F %T') 自检未通过：$HK_CHECK_FAILED/$HK_CHECK_TOTAL 项异常，明细见 $HK_LOG" \
  "$STATUS_FILE"
