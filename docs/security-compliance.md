# 杭客松安全合规对照

对照《交互式服务安全检查表（空）》（Sheet2，网站类型勾选「留言版」）里与技术实现相关的条款，
逐条写清楚**代码里做了什么、在哪看证据、还差什么**。制度类条款（4/5/6/11/13 章）不在代码里，
需要线下准备文件，见文末「需要人来做的部分」。

> 关于本文件的修订原则：涉及"每日定时任务""自动检测"的条款，答复必须**能被代码重现** ——
> 也就是任何人在一台新机器上跑一遍部署脚本，都能得到同样的能力。2026-10-12 因为发现
> 两个 timer 没有安装路径而专门补了 `deploy/install-timers.sh`，并加了 CI 守卫
> （`scripts/ci/drift-guard.mjs`）。写"已实现"之前请先确认这一点。

## 一、已实现（代码 + 运维）

| 条款 | 要求 | 实现 | 位置 |
|---|---|---|---|
| 8.4.1 | 记录用户活动、异常情况、故障和安全事件 | 统一审计写入函数，7 个分类：auth / register / publish / behavior / admin / security / system | `lib/server/audit.ts` |
| 8.4.2a | 用户注册信息：唯一标识、名称、注册时间、IP 及端口、邮箱 | 首次登录即注册，登录事件带 IP/端口/协议/UA；users 表新增 last_login_at / last_login_ip | `auth.ts` events、`db/schema.ts` |
| 8.4.2c | 登录信息：用户标识、登录时间、退出时间、IP 及端口 | 登录/登出都落审计；nginx 透传 `x-forwarded-port` 取真实源端口 | `auth.ts` events |
| 8.4.2d | 用户信息发布日志：标识、发布时间、IP、标题或摘要 | 活动创建、作品提交都写 publish 日志，带标题/摘要/联系方式 | `app/api/activities/route.ts`、`app/api/activities/[slug]/submissions/route.ts` |
| 8.4.2e | 用户行为：进出活动、上传下载 | 报名写 behavior 日志（进出活动 + 是否被邀请） | `app/api/activities/[slug]/join/route.ts` |
| 8.4.3 | 可溯源到真实用户 ID、网络地址和协议 | 每条审计带 userId + email + ip + port + protocol + UA；微信身份用 openid 合成邮箱且 openid 恒定，不易伪造 | `lib/server/audit.ts` |
| 8.4.4 | 审计日志不可单独中断、不可删除修改覆盖 | ① 数据库触发器拒绝 UPDATE/DELETE；② 每条带 hash 链（前一条哈希串联），改动任何一条都会断链。**两者均有自动化测试**（`scripts/db-schema.test.mjs` 在真 Postgres 上断言 UPDATE/DELETE 被拒、触发器存在；故意删掉触发器会让 CI 变红） | `drizzle/0009_security_audit.sql`、`scripts/db-schema.test.mjs` |
| 8.4.5 | 可按公安要求留存指定内容 | 管理端「审计日志」标签支持分类/关键字/邮箱/时间过滤与 CSV 导出 | `/manage` + `app/api/admin/audit/route.ts` |
| 8.4.5 留存期 | 注册信息永久；用户日志永久；发布内容永久；**系统维护日志 90 天** | 审计库不做任何清理（数据库触发器禁止 UPDATE/DELETE）；运维日志统一 90 天：logrotate 90 + journald `MaxRetentionSec=90day`（容器日志驱动改为 journald 共用此策略）；备份日 90 + 周 12 + 月 3，审计 CSV 随备份归档 | `deploy/backup.sh`、`/etc/logrotate.d/hangkathon`、`/etc/systemd/journald.conf.d/hangkathon.conf` |
| 8.3.1 | 备份策略、备份设施、备份记录 | 每日 03:20 全库 pg_dump（容器内 `-f` 落盘 → `docker cp` → 压缩，**不经管道**）+ 审计日志 CSV + sha256 校验（写完立即回验）；保留日 90 / 周 12 / 月 3 取并集；`deploy/restore.sh` 先验校验、先还原到临时库验证再原子切换。**timer 由 `deploy/install-timers.sh` 幂等安装**（此前无安装路径，靠人工装，任何重建都复现不了） | `deploy/backup.{sh,service,timer}`、`deploy/install-timers.sh` |
| 8.2b | 7×24 入侵预防、检测与响应 | nginx `limit_req` 挡脚本 + 应用层按 IP/账号限流（登录 10 次/分、写接口 5 次/分）；超限记 security 审计。**限流窗口 SQL 有回归测试**（`scripts/db-schema.test.mjs` 从源码抽出那条 upsert 执行：窗口内累加、窗口外重置、边界严格小于；条件写成恒真会失败 —— 这个 bug 真发生过） | `lib/server/rate-limit.ts`、`scripts/db-schema.test.mjs` |
| 8.2c | 重要文件完整性检测与恢复 | 每日 04:10 校验备份 sha256（含新鲜度）、审计链连续性、**应用与数据库两个容器**健康、磁盘水位、**悬空镜像堆积**（磁盘被打满的真实原因）；异常写 ALERT 状态文件 + 飞书告警 + 带外死人开关 fail，且**脚本退出非零**。判定逻辑有故障注入测试（`deploy/fault-injection.sh`）证明"故障下确实会失败" | `deploy/integrity-check.{sh,service,timer}`、`deploy/fault-injection.sh` |
| 8.2 | 网络与主机安全响应头 | CSP（含 frame-ancestors 'none'，逐请求 nonce）、HSTS、nosniff、X-Frame-Options、Referrer-Policy、Permissions-Policy | `middleware.ts` + `next.config.ts` |
| 9.2.2c | 用户黑名单制度，记录生效时间 | 黑名单表带生效时间、来源（平台自查/公安通报）、命中次数、解除人与解除时间；管理端可增删 | `lib/server/blacklist.ts`、`/manage` |
| 9.3.3a | 基于关键词的文字信息屏蔽过滤 | 活动标题/简介/主办方/联系方式、作品文案逐字段过滤，命中即拦截；6 类词库 + 环境变量 `SECURITY_EXTRA_KEYWORDS` 热加词 | `lib/security/filter.ts` |
| 9.3.3c | 基于 URL 的屏蔽过滤 | 作品链接只放行抖音站内 https 域名，防后缀伪造 | `lib/security/filter.ts` |
| 9.3.4 | 对违法有害信息来源实施控制 | 名单内账号禁止发起活动/报名/提交作品；连续 3 次命中内容过滤自动进黑名单 | `lib/server/users.ts` + `lib/security/filter.ts` |
| 9.3.2 | 对发布的信息逐条审核 | 活动审核流 + 作品审核流都在管理端留痕（谁、何时、结论） | `/manage` + 审计 admin 分类 |
| 7.2 / 7.3 | 权限分配与特殊权限使用记录 | 管理员角色变更、删除用户、改公开状态、审核动作全部写 admin 审计 | `app/api/admin/**` |
| 10.2 | 防止个人信息泄露的技术措施 | 会话 JWT + `__Secure-` cookie（https 下 Secure）、服务端不返回他人数据、审计日志不含密码/令牌 | 现有实现 |

### 合规声明的可复现性（2026-10-12 补充）

上面几行涉及"每日定时任务"的条款，此前存在一个**声明与事实脱节**的风险：
`hangkathon-backup.timer` 与 `hangkathon-integrity.timer` 在整个仓库里出现 **0 次** ——
没有任何 `cp …/etc/systemd/system/` 也没有 `systemctl enable`，它们是靠早期人工操作
装上去的，任何一次重建机器都无法复现。

现已补齐并纳入 CI 守护：

- `deploy/install-timers.sh` 幂等安装全部四个 timer（ci / backup / integrity / events）；
- `scripts/ci/drift-guard.mjs` 在每次 push 检查"每个 timer 都有单元文件 + 安装路径"，
  少一个就失败；
- 运维脚本的失败可见性由 `deploy/fault-injection.sh`（沙箱故障注入，25 项断言）
  与 `deploy/lib/common-selftest.sh`（15 项）守护。


## 二、已知不足（写清楚，别在检查时被问住）

1. **CSP 的 `script-src` 仍带 `'unsafe-inline'`（作为 legacy 兜底）** —— 已实现逐请求 nonce
   （`middleware.ts`）：支持 CSP3 的浏览器看到 nonce 后会忽略 `'unsafe-inline'`，
   内联脚本必须带同一 nonce 才能执行，套件有专项断言。保留该关键字只为不支持 nonce 的老浏览器
   不至于白屏；若检查方要求**彻底移除**，代价是老浏览器不可用，属产品决策。
2. **审核是「人工 + 关键词」两道**，没有接第三方内容安全 API（如阿里云内容安全）。词库在代码里，
   完整词库与举报通道要在制度文件里写明。
3. **没有第三方渗透测试报告**。这是检查表 8.2d 明确要的，需要采购第三方漏扫/渗透服务并留报告。
   （自有资产上的自研管线 `scripts/pentest/run.mjs` 每晚跑一次，属回归防护，**不能**代替第三方报告。）
4. **容灾只有单机 + 备份**：8.3.2 要「登录、消息发布等基础服务具备容灾能力」。目前是本机备份 +
   可在 1 小时内重建，跨机房容灾需要另购 ECS 或做双活，属采购事项。
5. **文件特征值过滤（9.3.3b）N/A**：平台不接受用户上传文件，作品只提交外链，故该项填 N/A 并说明。
6. **实名（9.2.2a）**：微信登录属于「已确认真实身份的网络服务的注册用户」这一档，审计里留存
   openid 合成账号、昵称、注册时间、IP。若检查方要求身份证核验，需要另接实名认证服务。
7. **带外告警依赖一个外部账号**：第四层告警（整机宕机时仍能响）需要 Healthchecks.io 的 ping URL
   写进服务器 `.env` 的 `HEALTHCHECK_PING_URL`。未配置时降级为写日志，**此时"整机宕机"没有告警**，
   检查组若问到这一点，答复应是"已就绪但待配置"，而不是"已覆盖"。
8. **正向路径授权测试只覆盖一半**：对抗套件里"匿名被拒"的断言很全，但"有权限者能进"
   需要提供 `TEST_SESSION_COOKIE` 才会执行。这是当前最大的单点覆盖缺口（见 `docs/ci-testing.md` 已知边界）。

## 三、需要人来做的部分（代码解决不了）

- 制度文件：安全岗位制度、操作权限管理、用户管理制度、信息发布审核、违法有害信息处置、
  投诉举报处理、个人信息保护、应急预案 —— 对应检查表 4.x / 13.x，需要成文并留存修订记录。
- 应急处置预案报备属地公安机关 + 演练记录。
- 第三方漏扫/渗透测试报告（8.2d）。
- 投诉举报渠道的公示与记录留存（11.x）。
- 若引入分包方（云安全服务等），需签安全协议（12.x）。