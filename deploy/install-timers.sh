#!/bin/sh
# 幂等安装全部 systemd timer（ci / backup / integrity / events）。
#
# 为什么需要这个脚本：2026-10-12 排查发现，`hangkathon-backup.timer` 与
# `hangkathon-integrity.timer` 在**整个仓库里出现 0 次** —— 没有任何 `cp …/etc/systemd/system/`
# 也没有 `systemctl enable`。它们是靠早期人工操作装上去的，任何一次重建机器都无法复现。
# 而 `docs/security-compliance.md` 已经把"每日 03:20 备份 / 04:10 完整性自检"作为
# 检查表 8.3.1 与 8.2c 的正式答复 —— 合规声明必须能由代码重现，否则就是纸面承诺。
#
# 用法：sh deploy/install-timers.sh            # 安装并启用
#       sh deploy/install-timers.sh --status   # 只看当前状态，不改动
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
hk_init install-timers

UNIT_DIR=/etc/systemd/system
TIMERS="hangkathon-ci hangkathon-backup hangkathon-integrity hangkathon-events"

if [ "${1:-}" = "--status" ]; then
  systemctl list-timers 'hangkathon-*' --all --no-pager || true
  echo
  systemctl list-unit-files 'hangkathon-*' --no-pager || true
  exit 0
fi

if [ "$(id -u)" != "0" ]; then
  echo "需要 root 权限（install 到 /etc/systemd/system）" >&2
  exit 1
fi

failed=0
for name in $TIMERS; do
  svc="$APP_DIR/deploy/$name.service"
  tmr="$APP_DIR/deploy/$name.timer"
  if [ ! -f "$svc" ] || [ ! -f "$tmr" ]; then
    log "ALERT 缺少单元文件：$name.service / $name.timer（跳过）"
    failed=$((failed + 1))
    continue
  fi
  install -m 644 "$svc" "$UNIT_DIR/$name.service"
  install -m 644 "$tmr" "$UNIT_DIR/$name.timer"
  log "已安装 $name.service + $name.timer"
done

systemctl daemon-reload

for name in $TIMERS; do
  [ -f "$UNIT_DIR/$name.timer" ] || continue
  # enable --now 对已在运行的 timer 是幂等的；失败要报出来，不能沉默
  if systemctl enable --now "$name.timer" >/dev/null 2>&1; then
    log "已启用 $name.timer"
  else
    log "ALERT 启用 $name.timer 失败"
    failed=$((failed + 1))
  fi
done

# 脚本本身要可执行（git 在 Windows 上没有 exec 位，服务器上 clone 出来可能是 644）
chmod +x "$APP_DIR"/deploy/*.sh 2>/dev/null || true

echo
echo "== 当前定时器 =="
systemctl list-timers 'hangkathon-*' --all --no-pager || true

if [ "$failed" -gt 0 ]; then
  echo
  echo "有 $failed 项未成功安装，见上方 ALERT。" >&2
  exit 1
fi
echo
echo "四个 timer 全部就位。"
