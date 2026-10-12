#!/bin/sh
# 一次性初始化 CI：装 git、生成部署密钥、把 /opt/hangkathon 变成 git 检出、装 systemd timer。
# 幂等，可以反复执行（例如把公钥加到 GitHub 之后再跑一次完成首次检出）。
#
# timer 的安装统一交给 deploy/install-timers.sh（四个 timer 一个入口），本脚本只负责
# git 侧的一次性动作 —— 原先这里只装 hangkathon-ci.timer，backup/integrity/events
# 三个 timer 全靠文档里手敲 cp，实际没人装（2026-10-12 查过：装了，但没有任何脚本能重现）。
set -u

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
hk_init setup-ci

KEY=/root/.ssh/hangkathon_deploy
REPO_SSH=git@github.com:Qbuby/hangkathon.git

echo "== 1) git =="
if ! command -v git >/dev/null 2>&1; then
  dnf install -y git >/dev/null 2>&1 || { echo "git 安装失败"; exit 1; }
fi
git --version

echo "== 2) 部署密钥 =="
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N "" -C "hangkathon-ci@$(hostname)" -f "$KEY" >/dev/null
  chmod 600 "$KEY"
  echo "已生成新的密钥对"
else
  echo "密钥已存在，沿用"
fi
ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
echo "PUBLIC_KEY_BEGIN"
cat "$KEY.pub"
echo "PUBLIC_KEY_END"

echo "== 3) 把应用目录变成 git 检出 =="
cd "$APP_DIR" || exit 1
[ -d .git ] || git init -q
git remote remove origin 2>/dev/null
git remote add origin "$REPO_SSH"
git config core.sshCommand "ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git config user.name "hangkathon-ci"
git config user.email "ci@hangkathon.local"
echo "remote=$(git remote get-url origin)"

echo "== 4) systemd timer（全部四个，走统一入口）=="
sh "$APP_DIR/deploy/install-timers.sh" || echo "timer 安装未全部成功，见上方输出"

echo "== 5) 首次检出 =="
if git fetch --depth 1 origin main > /tmp/hangkathon-first-fetch.log 2>&1; then
  git reset --hard origin/main >/dev/null 2>&1
  git branch -f main origin/main 2>/dev/null
  echo "首次检出完成：$(git rev-parse --short=7 HEAD)"
  echo "工作区文件数：$(git ls-files | wc -l)"
else
  echo "首次 fetch 失败，git 的报错如下："
  tail -4 /tmp/hangkathon-first-fetch.log
  echo "十有八九是部署密钥还没加到 GitHub。"
  echo "把上面的公钥加到 GitHub → 仓库 Settings → Deploy keys（只读）后，再跑一次本脚本。"
fi
echo "== done =="
