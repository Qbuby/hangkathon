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
#   2. 不在任何容器（含已停止容器）的 UpperDir / MergedDir 里；
#   3. 目录里没有 work/（有 work/ 说明它是容器可写层或被 dockerd 注册中的层）。
#
# 第 2、3 条是 2026-10-22 dry-run 时补上的：第一版只按 cache-id 判断，
# 结果把 uptime-kuma 的**容器可写层**（有 diff/link/lower/work、但没有 cache-id）
# 判成了孤儿 —— 直接 --apply 会删掉运行中容器的数据。这类误删不会报错，
# 只会表现为"容器起来但数据没了"。
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
# 用 docker inspect 拿 GraphDriver 路径；dockerd 在 dry-run 阶段仍在运行，所以可用。
# 这一步失败就中止 —— 没有它就无法证明"不会删到容器数据"。
: > "$TMP/container-layers.txt"
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps -aq 2>/dev/null); do
    for key in UpperDir MergedDir LowerDir; do
      docker inspect "$c" --format "{{.GraphDriver.Data.$key}}" 2>/dev/null || true
    done
  done | tr ':' '\n' | sed "s#^$OVL/##; s#/.*##" | grep -v '^$' | sort -u > "$TMP/container-layers.txt"
else
  die "没有 docker 命令，无法确认容器占用，拒绝继续"
fi
CONTAINER_LAYERS="$(wc -l < "$TMP/container-layers.txt")"
log "容器持有 $CONTAINER_LAYERS 个层目录（含已停止容器）"

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
  # (3) 没有 work/（容器可写层/注册中层的标志）
  if [ -d "$OVL/$d/work" ]; then continue; fi
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
  # 停机后再保护一次：目录里若出现 work/ 就跳过（防御性，不信任时间差）
  if [ -d "$OVL/$d/work" ]; then
    SKIPPED=$((SKIPPED + 1))
    log "跳过（出现 work/）：$d"
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
