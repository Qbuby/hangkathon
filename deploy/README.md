# 自托管部署（阿里云轻量应用服务器）

这份部署与 Vercel 上的 `hangkathon.net` **互相独立**：域名仍在 Vercel，这台机器用 `IP + 非标端口` 访问。

**两者最关键的区别：这台有后端。** 它跑一个自己的 Postgres 容器，活动 / 报名 / 作品提交 / 邀请事件都存在服务端，
并且**写操作需要登录**；Vercel 那份没有 `DATABASE_URL`，继续用浏览器 localStorage（登录可选、数据只在本机）。
代码是同一份，靠 `DATABASE_URL` 是否存在自动切换，见 `lib/api/data.ts`。

## 目标环境

| 项 | 值 |
| --- | --- |
| 实例 | `898328a868294f2e8f0b48c4ba003816`（cn-shanghai，Alibaba Cloud Linux 3，2C2G/40G） |
| 公网 IP | `106.14.92.106` |
| 应用目录 | `/opt/hangkathon` |
| 对外端口 | `3210` → 容器内 `3000` |
| 数据库 | compose 内的 `hangkathon-postgres`（postgres:18-alpine），只在 compose 内网，不对外发布端口 |
| 数据卷 | `hangkathon_pgdata`（挂载在 `/var/lib/postgresql`） |

## 部署

```sh
sh /opt/hangkathon/deploy/deploy.sh
```

脚本是幂等的：装 Docker（走 mirrors.aliyun.com）→ 写 registry 镜像（这台机器直连 Docker Hub 不通）→ 生成 `.env` → `docker compose up -d --build` → 等应用应答。

## 数据库

容器入口 `deploy/entrypoint.sh` 会先跑 `db/migrate.mjs`（幂等，重复启动不会重复建表），再启动 Next.js。
`lib/published-activities.ts` 里的预置活动在首次读取时自动 upsert 入库（归属 `seed@hangkathon.local`）。

```sh
cd /opt/hangkathon

# 看表与行数
docker exec hangkathon-postgres psql -U hangkathon -d hangkathon -c '\dt'
docker exec hangkathon-postgres psql -U hangkathon -d hangkathon -c 'select count(*) from activities;'

# 备份 / 恢复
docker exec hangkathon-postgres pg_dump -U hangkathon hangkathon > /root/hangkathon-$(date +%F).sql
docker exec -i hangkathon-postgres psql -U hangkathon -d hangkathon < /root/hangkathon-2026-09-24.sql

# 进交互式 psql
docker exec -it hangkathon-postgres psql -U hangkathon -d hangkathon
```

改 schema 的流程：改 `db/schema.ts` → 本地 `npx drizzle-kit generate` → 提交生成的 `drizzle/*.sql` → 部署时自动应用。

**注意**：postgres:18 起数据目录是带版本号的子目录，卷必须挂在 `/var/lib/postgresql`；
挂到 `/var/lib/postgresql/data` 会被镜像判定为旧版布局并拒绝启动（第一次部署就踩过这个坑）。

## 登录（OAuth）

写操作（发起活动 / 报名 / 提交作品 / 邀请）要求登录，凭据放在 `.env`：
`AUTH_SECRET`（必须）/ `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`，
以及 **`AUTH_URL=http://106.14.92.106:3210`** —— 没有它 Auth.js 会把 Dockerfile 里的
`HOSTNAME=0.0.0.0:3000` 当成回调 origin，GitHub 那边直接报 redirect_uri 不匹配（2026-09-24 踩过）。

- GitHub：这台机器用的是**专用的 GitHub OAuth App**（一个 App 可配最多 10 个回调地址，
  所以一份凭据同时服务多个部署也行），回调是 `http://106.14.92.106:3210/api/auth/callback/github`。
- Google：**在裸 IP + HTTP 的 origin 上用不了**——Google 要求重定向 URI 必须是 HTTPS 且禁止裸 IP
  （localhost 除外）。等站点有 HTTPS 域名后再启用；`.env` 里的 Google 凭据目前是闲置状态。

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

## 全球赛事抓取（每日）

活动页底部的「全球赛事」来自每日一次的自动抓取：宿主机 `python3` 跑 `scripts/events/fetch.py`
（7 个可自动化源），结果 POST 给应用的 `/api/events/ingest` 入库，页面经 `/api/events` 读取。
源清单与取舍见 `docs/global-events.md`。

一次性设置（.env 已配 `EVENTS_INGEST_TOKEN` 的前提下）：

```sh
cd /opt/hangkathon
cp deploy/hangkathon-events.service deploy/hangkathon-events.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hangkathon-events.timer
```

日常查看：

```sh
systemctl list-timers hangkathon-events.timer      # 下次抓取时间
systemctl status hangkathon-events.service         # 上次抓取结果
journalctl -u hangkathon-events.service -n 50      # 抓取日志（失败源会列在 stderr）
systemctl start hangkathon-events.service          # 手动抓一轮
```

## 环境变量

`/opt/hangkathon/.env`（权限 600，不进版本库）：

- `AUTH_SECRET`：首次部署时随机生成，用于签名会话 cookie。
- `AUTH_URL`：对外访问的 origin（这台是 `http://106.14.92.106:3210`），OAuth 回调靠它推导。
- `EVENTS_INGEST_TOKEN`：全球赛事抓取入库口的持有者令牌（`deploy/events-fetch.sh` 与 ingest 路由各持一半），换令牌时两处同步改。
- 可选：`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`。不配就只是登录不可用，站点其余功能正常（与本地预览一致）。

## 更新代码

正常路径就是**往 `main` 推提交**：CI 会在 3 分钟内自动拉取并重建（见上一节）。

首次部署时源码是用云助手分片上传到 `/opt/hk-src` 再解包的（当时还不是 git 检出）。
现在 `/opt/hangkathon` 已经是 git 检出，`deploy/setup-ci.sh` 完成后即可由 CI 接管；
只有在 CI 凭据不可用时，才需要回到"重新打包上传覆盖 + `docker compose up -d --build`"这条老路。

## 监控告警（2026-10-12 起）

三层构成，任何一层不通都能被下一层补上：

| 层 | 组件 | 覆盖 | 位置 |
|---|---|---|---|
| 存活探测 | Uptime Kuma（自建） | 站点、接口、容器健康 | `uptime.hangkathon.com`（Basic Auth；容器仅绑 127.0.0.1:3001，不新增公网端口） |
| 定时任务 | backup.sh / integrity-check.sh | 备份与完整性自检成功/失败都推送 | `deploy/backup.sh`、`deploy/integrity-check.sh` |
| 部署验证 | ci.sh 的部署后检查 | 冒烟与对抗套件失败时推送 | `deploy/ci.sh` |

告警出口：飞书自建应用（`deploy/feishu-alert.mjs`，凭据在服务器 `.env`），
统一入口 `deploy/alert.sh`。所有调用都吞掉自身错误（退出码恒为 0）——
告警通道故障不该让备份任务失败。

```sh
sh deploy/alert.sh "标题" "正文"          # 手工发一条
sh deploy/backup.sh                       # 备份（含成功通知）
sh deploy/integrity-check.sh              # 自检（仅失败时通知）
```

Kuma 面板的监控项在 Web 界面添加（它的 socket.io 通知配置没有稳定的无头 API）。
注意 Kuma 自带的 Feishu 渠道只吃**群自定义机器人 webhook**；自建应用走的是
App ID/Secret → tenant_access_token → im/v1/messages，由上面的脚本实现，两条路互不通用。
