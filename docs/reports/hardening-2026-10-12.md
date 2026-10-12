# 安全加固记录 · 2026-10-12

对应「客观评估」清单里 P1 与可修 P2 的处置，每项都带**攻击测试**结果。
配套报告：[pentest-2026-10-12.md](./reports/pentest-2026-10-12.md)（复测 0 发现）。

## P1 · SSH 对全网 root 密码登录 + 无爆破防护

**处置：云防火墙删除 22 端口放行规则**（不是改 sshd 配置）。
查证过这条路零风险：`authorized_keys` 为空、wtmp 里从无公网 SSH 登录记录、
实际运维一直走阿里云 Workbench（内网 100.104.x）与云助手——两者都不经过公网防火墙。
服务器上 sshd 照常监听（主机侧可见），公网不可达即纵深防御生效。

**攻击验证**：公网 TCP 22 超时，`SSH-2.0-OpenSSH_8.0` 横幅消失，站点 200。

**未做**：fail2ban / `PasswordAuthentication no`。理由是保留 Workbench 兜底路径
（若将来防火墙误操作，还能从控制台进）。若你希望收得更紧，告诉我。

## P2 · XFF 可伪造 → 审计不可溯源 + 限流可绕过

**处置**：nginx 三处 `X-Forwarded-For` 从 `$proxy_add_x_forwarded_for`（追加）
改为 `$remote_addr`（覆盖）。应用层取 XFF 首位的逻辑随之可信。

**攻击验证**：30 个请求每个伪造不同 `X-Forwarded-For`（`10.255.x.x`）——
第 7 个起全部 429（修复前每个假 IP 都重置计数，全 302）；
审计日志中只出现真实出口 IP，伪造值零记录。

## P2 · nginx 无 limit_req（文档声称有）+ 429 缺 Retry-After

**处置**：`limit_req_zone` 双区（`/api/auth/` 10次/分 burst 5；非 GET 的 `/api/` 30次/分 burst 10，
用 map 把 GET 的 key 置空实现「只限写」）；429 经 `error_page → @rate_limited`
统一输出 JSON + `Retry-After: 60`。

**攻击验证**：连打登录入口，第 7 个起 429 且带 `Retry-After: 60`；
伪造 XFF 再打仍被限（第 13 个 302 为窗口滑动的正常放行）。

**配置已收进版本管理**：`deploy/nginx-hangkathon.com.conf` 是源码，
`deploy/deploy-nginx.sh` 负责「拷贝 → nginx -t → reload / 失败自动回滚」。
改配置请改仓库再部署，不要直接在服务器上手改（本次就因此写坏过一次）。

## P2 · JWT 会话 30 天不可吊销

**处置**：`auth.ts` 的 `session.maxAge` 从默认 30 天降到 **7 天**，缩短泄露窗口。

**攻击验证**：`maxAge: -7200` 签一个过期 token → 管理接口 **401**、`/api/me` 返回空用户。
（踩坑记录：`encode()` 会用 `now() + maxAge` 覆盖 `exp`，想造过期 token 必须传负 maxAge。）

## P2 · CSP 的 `unsafe-inline` 使 nonce 形同虚设

**处置**：CSP 移到 `middleware.ts` 逐请求生成 nonce；根布局 `force-dynamic`
（静态 HTML 无法注入 per-request nonce）；引导脚本外置为 `public/motion-boot.js`，
并加了一条测试保证它与 `app/motion.ts` 的 MOTION_BOOT 不漂移；
`next.config.ts` 里的静态 CSP 移除（两份策略并存会取交集，缺 nonce 的那份会拦死所有脚本）。

**攻击验证**：浏览器实测——水合正常（`window.next` 存在）、canvas 场景渲染、
入场动效执行、四块内容齐全；页面内所有可执行内联脚本均带 CSP 同源 nonce
（`ld+json` 数据块不在 CSP 管辖内，属规范行为）。

## 过程中发现并修复的测试自身缺陷

- 对抗套件把 `<script src="/motion-boot.js">` 误判为「缺 nonce 的内联脚本」：
  正则里的 `\b` 经 heredoc 被写成退格符（\x08），前瞻失效。按字节修复并加校验。
  这类"JSON/heredoc 双层转义吞反斜杠"的问题在本项目已犯过两次，值得单独记。
- 套件把 nginx 层的 429 当成失败：429 是比应用层 401/403 更靠前的拒绝，算通过。

## 依赖侧阻断（影响部署，非安全漏洞）

wrangler 4.149 要求 `@cloudflare/workers-types` v5，而 `@cloudflare/vite-plugin` 1.37
的 peer 仍钉 v4，两者冲突导致服务器 `npm ci` 失败、CI 静默卡在旧版本。
已把 vite-plugin 升到 1.63.1（不再 peer types）解除。

## 未完成（需要你操作或采购）

- **告警通道**：云监控拨测创建报 `ExceedingQuota`（账号级配额，不是参数问题）。
  请在控制台手工建：云监控 → 站点监控 → `https://hangkathon.com`，频率 1 分钟，
  报警联系人填 `taotaisheng@proton.me`。目前「每日完整性自检」只写日志、无人接收。
- **异地备份 / WAF / 第三方渗透报告**：架构与采购级，见 `security-compliance.md` 的遗留项。