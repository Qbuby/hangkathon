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
  sed -i 's/\$releasever/8/g' /etc/yum.repos.d/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

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
