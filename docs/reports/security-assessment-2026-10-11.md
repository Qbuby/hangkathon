# 全方位安全测评报告 · 杭客松

**评估对象：** `hangkathon.com`（自托管生产站）+ `Qbuby/hangkathon` 仓库与 CI + 依赖链
**日期：** 2026-10-11
**方法论：** [superagent-ai/skills](https://github.com/superagent-ai/skills) 全部 13 项技能逐项套用（下表标注每项的适用性与结论）
**配套报告：** [pentest-2026-10-11.md](./pentest-2026-10-11.md)（外部渗透流程，recon-security）
**整体结论：** 测评期共发现 **10 项问题（1 critical / 2 high / 4 medium / 3 low）**，全部已修复或在 GitHub 平台侧生效；复测归零。

## 逐技能结论

| 技能 | 适用性 | 做了什么 | 发现 → 处置 |
|---|---|---|---|
| **recon-security** | ✅ 核心 | 八段式渗透管线 `scripts/pentest/run.mjs`（详见配套报告） | 888 端口监听（P2）、无 CAA（P3）→ 均已修复 |
| **authz-security** | ✅ 核心 | 新增 `scripts/security/authz-matrix.mjs`：静态枚举 32 个路由文件的方法与守卫，写方法必须有 require* 守卫、管理路由必须 requireAdmin | 0 缺陷：全部写方法有守卫；管理路由全 requireAdmin；抓取入库口用 timingSafeEqual Bearer 令牌（常量时间比较）；IDOR 审读确认作品刷新有归属校验（先查本人提交列表） |
| **crypto-secrets** | ✅ | 源码硬编码密钥模式扫描（排除抖音 vendor）+ 高熵串扫描 | 无硬编码密钥；AUTH_SECRET 只走环境变量；md5 仅存在于抖音签名 vendor 层（协议要求，非自选弱算法） |
| **supply-chain-security** | ✅ 核心成果 | `npm audit`（服务器容器内跑，绕本机 TLS 拦截）+ 依赖 install 钩子审计 + npmmirror audit 端点缺失的替代验证 | **1 critical + 2 high + 2 moderate 全部修复**：next 16.3.4→16.4.0（next/og RCE GHSA-vcvr-r3jv-pc5j + Draft Mode 泄漏，本站不使用受影响面）、sharp 0.35.4→0.35.5（overrides 强制，librsvg CVE）、source-map-js→1.2.2、fast-uri→3.1.8、baseline-browser-mapping→2.11.28 |
| **ci-cd-security** | ✅ | workflow 审计（无 pull_request_target、无 secrets 注入 PR 路径）+ 加固 | 加固 3 处：GITHUB_TOKEN 最小权限（contents: read）、actions 按 SHA 固定（浮动 tag 可被上游接管）、新增 `npm audit --omit=dev --audit-level=high` 闸门 |
| **repo-security-posture** | ✅ 有实货 | gh api 全量体检仓库设置 | **public 仓库安全开关全关** → dependabot alerts / secret scanning / push protection 三项已启用；新增 dependabot.yml（npm 周更）与 SECURITY.md；main 无分支保护（单人维护的权衡，暂不改） |
| **vulnerability-triage** | ✅ | 对 audit 结果逐条验证修复线（不盲目 `npm audit fix --force`） | 5 条 advisory 全部确认在修复版本之外（semver 逐条核对） |
| **infra-security** | ✅ | Dockerfile / compose / nginx 配置核查 | 应用容器非 root（nextjs 用户）✓、基础镜像钉 22-alpine ✓、postgres 不发布端口 ✓、`ssl_protocols TLSv1.2 TLSv1.3`（TLS1.1 握手实测被拒）✓、`server_tokens off` ✓ |
| **hacker** | ⚠️ 部分适用 | 只采用了其 validate-findings 纪律（每个发现要有最小复现）；Pass 7 利用验证按 RoE 对生产恒定跳过 | — |
| **security-disclosure-triage** | ➖ N/A | 自有资产自查，无外部报告方；已建 SECURITY.md 备将来 | — |
| **vulnerability-triage**（Dependabot PR 分诊） | ✅ | Dependabot 启用后立即产生 4 个 PR，逐个分诊 | eslint 10（破坏 eslint-config-next 插件 API）→ ignore major；@types/node 26（类型应跟运行时）→ ignore major；28 个更新的组 PR（wrangler↔workers-types peer 冲突根因）→ 主分支成对升级后 recreate |
| **skill-security / superagent / redteam-autoresearch** | ➖ N/A | 不安装第三方 skill 作为依赖；不使用 Superagent MCP；平台无 LLM 端点可做 guardrail 对抗 | — |

## 发现与修复清单

| # | 级别 | 发现 | 修复 | 状态 |
|---|---|---|---|---|
| 1 | **Critical** | next 16.3.4：next/og RCE（GHSA-vcvr-r3jv-pc5j）+ use cache Draft Mode 泄漏（GHSA-3w37-wq28-93x7） | 升级 16.4.0，双构建目标门禁全过 | ✅ 已部署 |
| 2 | High | sharp 0.35.4 librsvg CVE（GHSA-wq5f-xc86-pv6w） | package.json overrides 强制 ^0.35.5 | ✅ 已部署 |
| 3 | High | source-map-js 事件循环 DoS（GHSA-68fv-2mgg-jv7q） | →1.2.2 | ✅ 已部署 |
| 4 | Medium | fast-uri 主机名归一化不一致（GHSA-hrr3-gc8f-f4qj） | →3.1.8 | ✅ 已部署 |
| 5 | Medium | baseline-browser-mapping DoS（GHSA-w5vr-8v7q-w6rv） | →2.11.28 | ✅ 已部署 |
| 6 | Medium | public 仓库 secret scanning / push protection / dependabot alerts 全关 | 三项全部启用（API 实证） | ✅ 平台侧生效 |
| 7 | Medium | CI 的 GITHUB_TOKEN 权限未显式收紧、actions 用浮动 tag | permissions: read + SHA 固定 + audit 闸门 | ✅ 已部署 |
| 8 | Medium | 888 端口公网监听（宝塔默认站）| 收回 127.0.0.1:888（复测确认公网只剩 443/80/22） | ✅ 已生效 |
| 9 | Low | 无 CAA 记录 | `0 issue "letsencrypt.org"` 已加（解析器实测生效） | ✅ 已生效 |
| 10 | Low | 无 SECURITY.md / 无 dependabot 配置 | 两文件已入库 | ✅ 已部署 |

## 复测结果

修复后重跑渗透管线（`node scripts/pentest/run.mjs --ack`）：

- **发现 0 项、线索 0 条**（修复前：P2×2 + P3×1）
- 冒烟 51/51、对抗 53/53 全过
- 公网监听收敛为 443/80/22
- CAA 由公共解析器确认生效

## 过程中发现的方法论问题（已修）

1. **渗透管线的探测默认跟随重定向**：http→https 的 301 被跟成 200，把"已强制跳转"误报为发现。重定向类探测必须 `redirect: "manual"`。
2. **端口监听 ≠ 公网可达**：888 一直在监听但云防火墙未放行。管线应测可达性而非监听状态；纵深上仍把监听收到环回。
3. **append-only 表不能持有业务外键**（前一轮 E2E 发现，此处存档）：删用户触发 ON DELETE SET NULL 的 UPDATE，被审计触发器拒绝。

## 遗留与建议

- **第三方渗透测试报告**仍是安全检查表 8.2d 的采购项，本管线不能替代。
- **main 无分支保护**：单人维护下强制 PR 会打断现有直推流程；建议后续用 ruleset 要求"verify"检查通过（已具备闸门）。
- npmmirror 不代理 npm audit 端点，本地审计要靠服务器容器或直接核对 advisory 区间（已写入流程）。
- CAA 只签 Let's Encrypt：若将来换 CA 需先改 DNS。
