#!/bin/sh
# 一次性回收 Docker 的历史孤儿层（**必须停机执行**，不在任何定时任务里）。
#
# ── 为什么需要它 ────────────────────────────────────────────────────────────
# 2026-10-22：40G 的机器磁盘 98%，完整性自检告警。查下来：
#   · 悬空镜像只有 20 个，`docker image prune -f` 回收 **0B**；
#   · 实际占用：/var/lib/docker/overlay2 26G，而现存镜像总共只有约 1.5G；
#   · overlay2 里积压了上百个历史构建层，Docker 26 不会自动回收它们。
# 增长控制已交给 dockerd 的 builder.gc（见 deploy/deploy.sh），本脚本只做**存量清理**。
#
# ── 为什么不用 docker 命令清 ────────────────────────────────────────────────
# 本机实测（每一次都导致容器全部退出、站点 502）：
#   · `docker system df`      → dockerd 挂住，被 OOM 杀掉
#   · `docker builder prune`  → 90 秒无响应后超时，什么都没删
#   · `docker buildx du`      → 同样把 dockerd 拖死
# 所以这里完全不碰这些命令，只在 **dockerd 停止** 的状态下操作文件系统。
#
# ── 安全边界（三重，缺一不可）──────────────────────────────────────────────
# 一个目录必须**同时**满足以下三条才会被删：
#   1. layerdb 里没有它的 cache-id（Docker 不认为它属于任何镜像/构建缓存）；
#   2. 不在任何容器（含已停止容器）的 UpperDir / MergedDir / LowerDir 里；
#   3. 名字不是 *-init（容器初始化层由 dockerd 管理）。
#
# 第 2 条是 2026-10-22 dry-run 时补上的：第一版只按 cache-id 判断，
# 结果把 uptime-kuma 的**容器可写层**（有 diff/link/lower/work、但没有 cache-id）
# 判成了孤儿 —— 直接 --apply 会删掉运行中容器的数据。这类误删不会报错，
# 只会表现为"容器起来但数据没了"。
#
# ⚠️ 特别提醒：**不要**用"目录里有没有 work/ 或 committed 文件"来判断安全性。
# 2026-10-22 实测 overlay2 下有 100+ 个带 work/ 与 committed 的目录（约 14.7GB），
# 它们是 BuildKit 的历史构建快照缓存（可以清），而容器的可写层同样带 work/（不能清）。
# 两者只能靠"是否被容器持有"区分。
#
# 用法（在服务器上以 root 执行）：
#   sh deploy/docker-reclaim.sh --dry-run    # 只报告，不做任何修改（必须先跑）
#   sh deploy/docker-reclaim.sh --apply      # 停 docker → 删孤儿层 → 启 docker
#
# 退出码：0 成功；1 前置条件不满足或执行失败（失败也会把 docker 拉起来）。
set -eu

APP_DIR="${APP_DIR:-/opt/hangkathon}"
DOCKER_ROOT="${DOCKER_ROOT:-/var/lib/docker}"
LDB="$DOCKER_ROOT/image/overlay2/layerdb/sha256"
OVL="$DOCKER_ROOT/overlay2"
LOG="${RECLAIM_LOG:-/var/log/hangkathon-reclaim.log}"

MODE="${1:-}"
case "$MODE" in
  --dry-run|--apply) ;;
  *)
    echo "用法：$0 --dry-run | --apply" >&2
    exit 2
    ;;
esac

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "错误：$*"; exit 1; }

[ -d "$LDB" ] || die "找不到 layerdb：$LDB（DOCKER_ROOT 不对？）"
[ -d "$OVL" ] || die "找不到 overlay2：$OVL"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── 1) layerdb 认得的 cache-id ─────────────────────────────────────────────
: > "$TMP/known.txt"
for d in "$LDB"/*/; do
  [ -d "$d" ] || continue
  cid="$(cat "$d/cache-id" 2>/dev/null || true)"
  [ -n "$cid" ] && printf '%s\n' "$cid" >> "$TMP/known.txt"
done
sort -u "$TMP/known.txt" -o "$TMP/known.txt"
KNOWN="$(wc -l < "$TMP/known.txt")"
[ "$KNOWN" -gt 0 ] || die "layerdb 里一个 cache-id 都没读到 —— 路径或权限异常，拒绝继续（否则会把所有层都当成孤儿）"

# ── 2) 容器持有的层（含已停止的容器）───────────────────────────────────────
# 用 docker inspect 拿 GraphDriver 的 UpperDir/MergedDir/LowerDir —— **三个都要**：
#   · UpperDir  可写层（容器数据就在里面，误删 = 数据丢失）；
#   · LowerDir  只读层链，删了容器起不来；
#   · MergedDir 合并挂载点。
# 每个字段是冒号分隔的路径列表，必须逐个拆开再取第一级目录名。
#
# 这一步失败就中止 —— 没有它就无法证明"不会删到容器数据"。
: > "$TMP/container-layers.txt"
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps -aq 2>/dev/null); do
    for key in UpperDir MergedDir LowerDir; do
      docker inspect "$c" --format "{{.GraphDriver.Data.$key}}" 2>/dev/null || true
      printf '\n'
    done
  done | tr ':' '\n' | while IFS= read -r p; do
    case "$p" in
      "$OVL"/*) rest="${p#"$OVL"/}"; printf '%s\n' "${rest%%/*}" ;;
    esac
  done | grep -v '^$' | sort -u > "$TMP/container-layers.txt"
else
  die "没有 docker 命令，无法确认容器占用，拒绝继续"
fi
CONTAINER_LAYERS="$(wc -l < "$TMP/container-layers.txt")"
log "容器持有 $CONTAINER_LAYERS 个层目录（含已停止容器）"
[ "$CONTAINER_LAYERS" -gt 0 ] || die "一个容器层都没读到 —— docker inspect 异常，拒绝继续（否则可能删到运行中容器的数据）"

# ── 3) overlay2 下的候选目录 ───────────────────────────────────────────────
ls -d "$OVL"/*/ 2>/dev/null | sed "s#$OVL/##; s#/\$##" \
  | grep -v '^l$' | grep -v -- '-init$' | sort > "$TMP/all.txt"
ALL="$(wc -l < "$TMP/all.txt")"

# ── 4) 三重过滤 ────────────────────────────────────────────────────────────
: > "$TMP/orphans.txt"
while IFS= read -r d; do
  # (1) layerdb 不认
  if grep -qx "$d" "$TMP/known.txt"; then continue; fi
  # (2) 不被任何容器持有
  if grep -qx "$d" "$TMP/container-layers.txt"; then continue; fi
  # (3) 不是 *-init（容器初始化层，由 dockerd 管理，删了容器起不来）
  #
  # ⚠️ 不能用"有没有 work/ 或 committed"来判定：2026-10-22 实测 overlay2 下有
  # 100+ 个带 work/ 与 committed 的目录（合计约 14.7GB），它们是 BuildKit 的
  # 历史构建快照缓存，不是容器数据；而容器的可写层同样带 work/。
  # 两者只能靠"是否被容器持有"（上一段）区分。
  case "$d" in *-init) continue ;; esac
  printf '%s\n' "$d" >> "$TMP/orphans.txt"
done < "$TMP/all.txt"

ORPHANS="$(wc -l < "$TMP/orphans.txt")"

SIZE_MB=0
while IFS= read -r d; do
  s="$(du -x -sm "$OVL/$d" 2>/dev/null | cut -f1 || true)"
  [ -n "${s:-}" ] && SIZE_MB=$((SIZE_MB + s))
done < "$TMP/orphans.txt"

log "layerdb 记录 $KNOWN；overlay2 目录 $ALL；判定为孤儿 $ORPHANS 个（约 ${SIZE_MB}MB）"

if [ "$ORPHANS" -eq 0 ]; then
  log "没有可回收的孤儿层，退出"
  exit 0
fi

if [ "$MODE" = "--dry-run" ]; then
  log "dry-run：以下目录会被删除（最多列 20 个）"
  head -20 "$TMP/orphans.txt" | while IFS= read -r d; do
    s="$(du -x -sm "$OVL/$d" 2>/dev/null | cut -f1 || true)"
    log "  ${s:-?}MB  $d"
  done
  log "dry-run 结束，未做任何修改。确认无误后执行：$0 --apply"
  exit 0
fi

# ── 5) 执行：停 docker → 再核一次容器层 → 删 → 启 docker ────────────────────
log "开始回收：先停止 docker"
if ! systemctl stop docker; then
  die "systemctl stop docker 失败，未做任何删除"
fi
if pidof dockerd >/dev/null 2>&1; then
  log "dockerd 仍在运行，重新拉起并放弃本次回收"
  systemctl start docker || true
  die "dockerd 未停止，拒绝删除"
fi

# dockerd 停了之后，容器不会再变化；但仍以停机前采集的清单为准（宁可少删）。
RECLAIMED=0
FAILED=0
SKIPPED=0
while IFS= read -r d; do
  # 停机后再核一次：容器不可能再变化，但若这个目录仍被某个容器的 LowerDir 引用
  # （例如 dry-run 与 apply 之间有人加了容器），跳过。这是防时间差的最后一道。
  # 判据仍是"是否被容器持有"，**不是** work/ —— 见第 4 段注释。
  if grep -qx "$d" "$TMP/container-layers.txt"; then
    SKIPPED=$((SKIPPED + 1))
    log "跳过（被容器持有）：$d"
    continue
  fi
  if rm -rf "$OVL/$d" 2>/dev/null; then
    RECLAIMED=$((RECLAIMED + 1))
  else
    FAILED=$((FAILED + 1))
    log "删除失败：$d"
  fi
done < "$TMP/orphans.txt"

log "删除完成：成功 $RECLAIMED，跳过 $SKIPPED，失败 $FAILED"

# ── 5b) 重置 BuildKit 缓存索引 ─────────────────────────────────────────────
# **必须做**（2026-10-22 实测踩过）：删掉层目录后，BuildKit 的 metadata_v2.db
# 里仍记着这些层，下一次 `docker compose build` 会直接失败：
#   #1 ERROR: stat /var/lib/docker/overlay2/<已删目录>: no such file or directory
#   failed to solve: failed to read dockerfile
# 而 `docker builder prune` 在本机会卡死 dockerd，没法用它让 BuildKit 自愈。
#
# 做法：把 buildkit 目录整个挪走（不是删除，留作证据），让 dockerd 重建空索引。
# 代价是丢失构建缓存 —— 下一次构建会慢一些（实测约 6 分钟），但这是唯一安全的路径。
BUILDKIT_DIR="${BUILDKIT_DIR:-$DOCKER_ROOT/buildkit}"
if [ -d "$BUILDKIT_DIR" ]; then
  STAMP="$(date '+%Y%m%d%H%M%S')"
  if mv "$BUILDKIT_DIR" "$BUILDKIT_DIR.broken.$STAMP" 2>/dev/null; then
    mkdir -p "$BUILDKIT_DIR"
    log "已重置 BuildKit 索引（旧目录留作 $BUILDKIT_DIR.broken.$STAMP，确认构建正常后可删）"
  else
    log "警告：无法重置 BuildKit 索引，下一次构建可能因 'stat ... no such file' 失败"
  fi
fi

log "重新启动 docker"
systemctl start docker || {
  log "严重：systemctl start docker 失败，需要人工介入"
  exit 1
}

# 等 dockerd 可用
i=0
while [ "$i" -lt 30 ]; do
  if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then break; fi
  i=$((i + 1))
  sleep 2
done
if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  log "严重：docker 启动后不可用，需要人工排查"
  exit 1
fi

log "docker 已恢复：$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
log "现存镜像："
docker images --format '  {{.Repository}}:{{.Tag}} {{.Size}}' 2>/dev/null | tee -a "$LOG"

cd "$APP_DIR" 2>/dev/null || true
if [ -f "$APP_DIR/docker-compose.yml" ]; then
  docker compose up -d >>"$LOG" 2>&1 || log "警告：docker compose up -d 失败，需人工检查"
fi
if [ -f "$APP_DIR/deploy/monitoring.compose.yml" ]; then
  docker compose -f "$APP_DIR/deploy/monitoring.compose.yml" up -d >>"$LOG" 2>&1 \
    || log "警告：监控栈启动失败，需人工检查"
fi

df -h / | tail -1 | while IFS= read -r line; do log "磁盘：$line"; done
log "完成。请验证站点后运行 deploy/integrity-check.sh 确认通过。"
