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

NEED_RESTART=0
if [ ! -f /etc/docker/daemon.json ]; then
  log "writing /etc/docker/daemon.json with registry mirrors + builder GC"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://docker.m.daocloud.io", "https://hub.rat.dev"],
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "2GB"
    }
  }
}
JSON
  NEED_RESTART=1
else
  # 已有配置：只在缺少 builder.gc 时补上，不覆盖镜像源等其它设置。
  #
  # 为什么必须有 builder.gc（2026-10-22 事故）：`docker compose up -d --build`
  # 每次构建都会在 buildkit 里留下一个约 1.3GB 的层，**不会自动回收**；
  # 40G 的机器累计到 26G 时磁盘 98%。
  # 而所有现场清理命令在这台机器上都会卡死 dockerd（实测 `docker system df`、
  # `docker builder prune`、`docker buildx du` 各自把 dockerd 拖死一次，
  # 每次都导致容器全部退出、站点 502）。
  # 让 dockerd 按策略在后台 GC，是唯一不经过 CLI、不冒卡死风险的方案。
  if ! grep -q '"builder"' /etc/docker/daemon.json 2>/dev/null; then
    if command -v python3 >/dev/null 2>&1; then
      log "adding builder GC to existing /etc/docker/daemon.json"
      cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%Y%m%d%H%M%S)"
      # 用 python 合并 JSON：手写 sed 改 JSON 太容易改坏（文件坏了 dockerd 起不来）
      python3 - <<'PY'
import json
path = "/etc/docker/daemon.json"
with open(path, encoding="utf-8") as fh:
    cfg = json.load(fh)
cfg.setdefault("builder", {}).setdefault("gc", {}).update(
    {"enabled": True, "defaultKeepStorage": "2GB"}
)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
      NEED_RESTART=1
    else
      log "警告：没有 python3，无法安全合并 daemon.json —— 请手工加入 builder.gc"
    fi
  fi
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
