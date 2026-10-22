#!/bin/sh
# 杭客松自托管部署（在服务器上以 root 执行，幂等）。
# 独立于 Vercel 的那一份，通过 IP + 非标端口访问。
set -eu

APP_DIR=/opt/hangkathon
PORT=3210

log() { echo "[deploy] $*"; }

# 1) Docker：这台机器直连 Docker Hub 不通，走阿里云镜像站装，再配 registry 镜像
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker-ce from mirrors.aliyun.com"
  dnf install -y dnf-utils >/dev/null 2>&1 || true
  dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo >/dev/null
  # Alibaba Cloud Linux 3 的 releasever 是 3，docker-ce 仓库里没有对应路径，固定成 8
  # shellcheck disable=SC2016  # 单引号是刻意的：这里的 \$releasever 是给 sed 的字面量，不该被 shell 展开
  sed -i 's/\$releasever/8/g' /etc/yum.repos.d/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# 1b) daemon.json：只配镜像源。
#
# ⚠️ 2026-10-22 事故：曾经在这里加了
#     "builder": {"gc": {"enabled": true, "defaultKeepStorage": "2GB"}}
# 想让它自动回收 buildkit 缓存。实测后果是 **dockerd 内存从 99MB 涨到 800~1150MB**
# （它会扫描全量层），而本机只有 1.8GB 内存 —— 直接被 OOM 杀掉，
# 三个容器一起消失、站点 502。同一台机器上连续复现三次。
# 所以这里**绝不能**再开 builder.gc。磁盘增长的控制改由人工执行
# deploy/docker-reclaim.sh（停机回收，见该脚本注释）。
NEED_RESTART=0
if [ ! -f /etc/docker/daemon.json ]; then
  log "writing /etc/docker/daemon.json with registry mirrors"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://docker.m.daocloud.io", "https://hub.rat.dev"]
}
JSON
  NEED_RESTART=1
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if [ "$NEED_RESTART" = "1" ]; then
  systemctl restart docker
  sleep 3
fi
log "docker $(docker --version | cut -d' ' -f3 | tr -d ',')"

# 2) 环境变量：缺 .env 就生成一个随机 AUTH_SECRET（不打印明文）
cd "$APP_DIR"
if [ ! -f .env ]; then
  printf 'AUTH_SECRET=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -d '\n')" > .env
  chmod 600 .env
  log ".env created with a generated AUTH_SECRET (value not printed)"
fi
log "env keys: $(cut -d= -f1 .env | tr '\n' ' ')"

# 3) 构建并启动
docker compose up -d --build

# 4) 等应用起来
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/"; then
    log "app responding on 127.0.0.1:$PORT after $((i * 5))s"
    break
  fi
  if [ "$i" = "60" ]; then
    log "app did NOT come up within 300s"
  fi
  sleep 5
done

docker compose ps
