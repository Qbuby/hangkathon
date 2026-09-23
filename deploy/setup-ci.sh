#!/bin/sh
# 一次性初始化 CI：装 git、生成部署密钥、把 /opt/hangkathon 变成 git 检出、装 systemd timer。
# 幂等，可以反复执行（例如把公钥加到 GitHub 之后再跑一次完成首次检出）。
set -u

APP_DIR=/opt/hangkathon
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

echo "== 4) systemd timer =="
install -m 644 "$APP_DIR/deploy/hangkathon-ci.service" /etc/systemd/system/hangkathon-ci.service
install -m 644 "$APP_DIR/deploy/hangkathon-ci.timer" /etc/systemd/system/hangkathon-ci.timer
chmod +x "$APP_DIR/deploy/ci.sh" 2>/dev/null
systemctl daemon-reload
systemctl enable --now hangkathon-ci.timer >/dev/null 2>&1
systemctl list-timers hangkathon-ci.timer --no-pager | head -3

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
