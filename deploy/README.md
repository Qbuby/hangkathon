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

## CI：自动拉取 main 并重建

服务器上跑着一个 systemd timer，**每 3 分钟**检查一次 GitHub 的 `main`：

```
hangkathon-ci.timer ──每 3 分钟──> hangkathon-ci.service ──> deploy/ci.sh
                                                              ├─ git fetch origin main
                                                              ├─ SHA 没变？直接退出（不写日志、不占资源）
                                                              └─ 变了？reset --hard → docker compose up -d --build
                                                                        → 等健康检查 → 写 /var/log/hangkathon-ci.log
```

### 一次性设置（部署密钥）

仓库是私有的，所以服务器需要只读凭据。用的是 **deploy key**：私钥只存在服务器
（`/root/.ssh/hangkathon_deploy`，权限 600），公钥加到 GitHub 后即可拉取。

把下面这把公钥贴到 **GitHub → Qbuby/hangkathon → Settings → Deploy keys → Add deploy key**
（标题随便写，**不要**勾选 Allow write access）：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILVvO7K4CRTpi4QuoK1fs2JfE54uKsdFGU4OvdLj2AhK hangkathon-ci@iZuf6cprftrzprkkzqeniwZ
```

加完在服务器上跑一次 `sh /opt/hangkathon/deploy/setup-ci.sh` 完成首次检出（脚本幂等，
再跑不会重复生成密钥）。之后 timer 会自己保持更新。

### 日常查看

```sh
systemctl list-timers hangkathon-ci.timer     # 下次检查时间
systemctl status hangkathon-ci.service        # 上次执行结果
tail -30 /var/log/hangkathon-ci.log           # CI 日志（只有真正重建时才写）
sh /opt/hangkathon/deploy/ci.sh               # 手动触发一次
systemctl disable --now hangkathon-ci.timer   # 暂停自动更新
```

### 行为说明

- **只有 `main` 的 commit 变化才会重建**，无变化时脚本立即退出，几乎不耗资源。
- 重建走 Docker 层缓存，源码没动的层会复用；实际耗时主要在 `next build`。
- 重建后会等应用在 `127.0.0.1:3210` 上应答才算成功，失败会写日志并以非 0 退出（`systemctl status` 可见）。
- `/opt/hangkathon/.env` 不在版本库里，`git reset --hard` 不会动它（未跟踪文件不受影响）。
- 想改成"push 后秒级触发"，可以在 GitHub 加 webhook + 服务器上放一个校验签名的接收端点；
  当前轮询方案不需要 GitHub 额外配置，也不用多开端口。

## 环境变量

`/opt/hangkathon/.env`（权限 600，不进版本库）：

- `AUTH_SECRET`：首次部署时随机生成，用于签名会话 cookie。
- 可选：`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`。不配就只是登录不可用，站点其余功能正常（与本地预览一致）。

## 更新代码

正常路径就是**往 `main` 推提交**：CI 会在 3 分钟内自动拉取并重建（见上一节）。

首次部署时源码是用云助手分片上传到 `/opt/hk-src` 再解包的（当时还不是 git 检出）。
现在 `/opt/hangkathon` 已经是 git 检出，`deploy/setup-ci.sh` 完成后即可由 CI 接管；
只有在 CI 凭据不可用时，才需要回到"重新打包上传覆盖 + `docker compose up -d --build`"这条老路。
