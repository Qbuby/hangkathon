# 杭客松安全合规对照（提交 8878aa6 之后的增量）

对照《交互式服务安全检查表（空）》（Sheet2，网站类型勾选「留言版」）里与技术实现相关的条款，
逐条写清楚**代码里做了什么、在哪看证据、还差什么**。制度类条款（4/5/6/11/13 章）不在代码里，
需要线下准备文件，见文末「需要人来做的部分」。

## 一、已实现（代码 + 运维）

| 条款 | 要求 | 实现 | 位置 |
|---|---|---|---|
| 8.4.1 | 记录用户活动、异常情况、故障和安全事件 | 统一审计写入函数，7 个分类：auth / register / publish / behavior / admin / security / system | `lib/server/audit.ts` |
| 8.4.2a | 用户注册信息：唯一标识、名称、注册时间、IP 及端口、邮箱 | 首次登录即注册，登录事件带 IP/端口/协议/UA；users 表新增 last_login_at / last_login_ip | `auth.ts` events、`db/schema.ts` |
| 8.4.2c | 登录信息：用户标识、登录时间、退出时间、IP 及端口 | 登录/登出都落审计；nginx 透传 `x-forwarded-port` 取真实源端口 | `auth.ts` events |
| 8.4.2d | 用户信息发布日志：标识、发布时间、IP、标题或摘要 | 活动创建、作品提交都写 publish 日志，带标题/摘要/联系方式 | `app/api/activities/route.ts`、`app/api/activities/[slug]/submissions/route.ts` |
| 8.4.2e | 用户行为：进出活动、上传下载 | 报名写 behavior 日志（进出活动 + 是否被邀请） | `app/api/activities/[slug]/join/route.ts` |
| 8.4.3 | 可溯源到真实用户 ID、网络地址和协议 | 每条审计带 userId + email + ip + port + protocol + UA；微信身份用 openid 合成邮箱且 openid 恒定，不易伪造 | `lib/server/audit.ts` |
| 8.4.4 | 审计日志不可单独中断、不可删除修改覆盖 | ① 数据库触发器拒绝 UPDATE/DELETE；② 每条带 hash 链（前一条哈希串联），改动任何一条都会断链 | `drizzle/0009_security_audit.sql` |
| 8.4.5 | 可按公安要求留存指定内容 | 管理端「审计日志」标签支持分类/关键字/邮箱/时间过滤与 CSV 导出 | `/manage` + `app/api/admin/audit/route.ts` |
| 8.4.5 留存期 | 注册信息永久；维护日志 ≥12 个月；用户日志 ≥12 个月；发布内容 ≥6 个月 | 代码不做任何清理（触发器也不允许删）；备份按日/周/月保留，审计 CSV 随备份归档 | `deploy/backup.sh` |
| 8.3.1 | 备份策略、备份设施、备份记录 | 每日 03:20 全库 pg_dump + 审计日志 CSV + sha256 校验；日 14 / 周 8 / 月 6 保留；`deploy/restore.sh` 支持先验校验再恢复 | `deploy/backup.{sh,service,timer}` |
| 8.2b | 7×24 入侵预防、检测与响应 | nginx `limit_req` 挡脚本 + 应用层按 IP/账号限流（登录 10 次/分、写接口 5 次/分）；超限记 security 审计 | `lib/server/rate-limit.ts`、`app/api/auth/[...nextauth]/route.ts` |
| 8.2c | 重要文件完整性检测与恢复 | 每日 04:10 校验备份 sha256、审计链连续性、容器健康与磁盘水位；异常写 ALERT 日志 | `deploy/integrity-check.{sh,service,timer}` |
| 8.2 | 网络与主机安全响应头 | CSP（含 frame-ancestors 'none'）、HSTS、nosniff、X-Frame-Options、Referrer-Policy、Permissions-Policy | `next.config.ts` headers() |
| 9.2.2c | 用户黑名单制度，记录生效时间 | 黑名单表带生效时间、来源（平台自查/公安通报）、命中次数、解除人与解除时间；管理端可增删 | `lib/server/blacklist.ts`、`/manage` |
| 9.3.3a | 基于关键词的文字信息屏蔽过滤 | 活动标题/简介/主办方/联系方式、作品文案逐字段过滤，命中即拦截；6 类词库 + 环境变量 `SECURITY_EXTRA_KEYWORDS` 热加词 | `lib/security/filter.ts` |
| 9.3.3c | 基于 URL 的屏蔽过滤 | 作品链接只放行抖音站内 https 域名，防后缀伪造 | `lib/security/filter.ts` |
| 9.3.4 | 对违法有害信息来源实施控制 | 名单内账号禁止发起活动/报名/提交作品；连续 3 次命中内容过滤自动进黑名单 | `lib/server/users.ts` + `lib/security/filter.ts` |
| 9.3.2 | 对发布的信息逐条审核 | 活动审核流 + 作品审核流都在管理端留痕（谁、何时、结论） | `/manage` + 审计 admin 分类 |
| 7.2 / 7.3 | 权限分配与特殊权限使用记录 | 管理员角色变更、删除用户、改公开状态、审核动作全部写 admin 审计 | `app/api/admin/**` |
| 10.2 | 防止个人信息泄露的技术措施 | 会话 JWT + `__Secure-` cookie（https 下 Secure）、服务端不返回他人数据、审计日志不含密码/令牌 | 现有实现 |

## 二、已知不足（写清楚，别在检查时被问住）

1. **CSP 里 `script-src` 含 `'unsafe-inline'`** —— Next 的 hydration 内联脚本所致。彻底去掉需要
   nonce 方案（middleware 里给每个响应生成 nonce），是下一步的加固项。
2. **审核是「人工 + 关键词」两道**，没有接第三方内容安全 API（如阿里云内容安全）。词库在代码里，
   完整词库与举报通道要在制度文件里写明。
3. **没有自动化渗透测试报告**。这是检查表 8.2d 明确要的，需要采购第三方漏扫/渗透服务并留报告。
4. **容灾只有单机 + 备份**：8.3.2 要「登录、消息发布等基础服务具备容灾能力」。目前是本机备份 +
   可在 1 小时内重建，跨机房容灾需要另购 ECS 或做双活，属采购事项。
5. **文件特征值过滤（9.3.3b）N/A**：平台不接受用户上传文件，作品只提交外链，故该项填 N/A 并说明。
6. **实名（9.2.2a）**：微信登录属于「已确认真实身份的网络服务的注册用户」这一档，审计里留存
   openid 合成账号、昵称、注册时间、IP。若检查方要求身份证核验，需要另接实名认证服务。

## 三、需要人来做的部分（代码解决不了）

- 制度文件：安全岗位制度、操作权限管理、用户管理制度、信息发布审核、违法有害信息处置、
  投诉举报处理、个人信息保护、应急预案 —— 对应检查表 4.x / 13.x，需要成文并留存修订记录。
- 应急处置预案报备属地公安机关 + 演练记录。
- 第三方漏扫/渗透测试报告（8.2d）。
- 投诉举报渠道的公示与记录留存（11.x）。
- 若引入分包方（云安全服务等），需签安全协议（12.x）。