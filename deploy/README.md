# 自托管部署（阿里云轻量应用服务器）

这份部署与 Vercel 上的 `hangkathon.net` **互相独立**：域名仍在 Vercel，这台机器用 `IP + 非标端口` 访问。

## 目标环境

| 项 | 值 |
| --- | --- |
| 实例 | `898328a868294f2e8f0b48c4ba003816`（cn-shanghai，Alibaba Cloud Linux 3，2C2G/40G） |
| 公网 IP | `106.14.92.106` |
| 应用目录 | `/opt/hangkathon` |
| 对外端口 | `3210` → 容器内 `3000` |

## 部署

```sh
sh /opt/hangkathon/deploy/deploy.sh
```

脚本是幂等的：装 Docker（走 mirrors.aliyun.com）→ 写 registry 镜像（这台机器直连 Docker Hub 不通）→ 生成 `.env` → `docker compose up -d --build` → 等应用应答。

## 健康检查

```sh
sh /opt/hangkathon/deploy/healthcheck.sh
```

逐个打印 `/`、`/activities`、`/leaderboard`、`/create` 等路由的 HTTP 状态码、静态资源状态与最近日志。

## 日常运维

```sh
cd /opt/hangkathon
docker compose ps                 # 容器状态
docker compose logs -f --tail=100 # 看日志
docker compose restart            # 重启
docker compose up -d --build      # 改了代码后重建
docker compose down               # 停掉（不删镜像）
```

## 这台机器上的既有服务（不要动）

- 宝塔面板：`21077`
- nginx：`80` / `888`
- PostgreSQL：`127.0.0.1:5432`
- SSH：`22`

本部署只占用 `3210`，不接管、不改动上面任何一项，也没有复用它们的管理配置。

## 对外访问

访问地址：**http://106.14.92.106:3210/**

云防火墙原先只放行 `22 / 80 / 443 / ICMP / 21077`，`3210` 未开、公网访问不到。2026-09-23 已通过
`CreateFirewallRule` 加了一条入方向规则：

| 协议 | 端口 | 来源 | 备注 |
| --- | --- | --- | --- |
| TCP | 3210 | `0.0.0.0/0` | hangkathon self-hosted |

**注意这条规则对全网开放**：任何知道 IP 的人都能访问这个站点（没有域名、没有 HTTPS）。
要收紧就把来源改成你的办公网 IP 段；不需要公网访问时直接删掉这条规则，改用
`ssh -L 3210:127.0.0.1:3210 root@106.14.92.106` 本地端口转发。

**建议不要**用域名把 80/443 指到这台机器：大陆地域对外提供网页服务需要 ICP 备案，而 `hangkathon.net`
仍在 Vercel 上，保持现状最省事。

## 环境变量

`/opt/hangkathon/.env`（权限 600，不进版本库）：

- `AUTH_SECRET`：首次部署时随机生成，用于签名会话 cookie。
- 可选：`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`。不配就只是登录不可用，站点其余功能正常（与本地预览一致）。

## 更新代码

当前源码是通过云助手分片上传到 `/opt/hk-src` 再解包的，**不是** git 检出，所以没有 `git pull`。
更新时重新打包源码上传覆盖 `/opt/hangkathon` 后执行 `docker compose up -d --build` 即可。
若希望以后能直接 `git pull`，把仓库改为公开、或给服务器配一个只读部署密钥。
