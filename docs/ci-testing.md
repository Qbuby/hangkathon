# CI 与对抗测试规范

这份文档定义"改动怎么算通过"。目标是让**能被自动化验证的东西全自动**，
只把真正需要人判断的留给人工评审。

## 一、CI 的五个并行 job（2026-10-12 起重构）

形态参考 [shadcn-ui/ui](https://github.com/shadcn-ui/ui) 的 `code-check.yml`：
**每个检查一个独立 job、彼此无 `needs`、并行启动**，取代原先七步串在一个 job 里的写法。

| job | 内容 | 对应本地命令 |
|---|---|---|
| `lint` | ESLint | `npm run lint` |
| `test` | `scripts/**/*.test.mjs` 全部单测 | `node --test …` |
| `build` | `next build` + 产物凭据扫描 | `npm run build:vercel` |
| `audit` | `npm audit --omit=dev --audit-level=high` | 同上 |
| `authz` | `scripts/security/authz-matrix.mjs` 授权矩阵 | 同上 |

好处：失败时看哪个 job 红即可，总时长从「串行相加」变成「最慢的那个」（实测 1 分钟左右）。

**为什么 build 只跑一次**：自托管与 Vercel 是**运行时**差异（有无 `DATABASE_URL`），
不是构建期差异 —— 两条命令产物同源。原先跑两次是重复劳动，已合并；
真正的双模式覆盖由服务器侧的冒烟 + 对抗套件负责（部署后验证）。

## 二、四层闸门

| 层 | 跑在哪 | 什么时候 | 内容 | 失败后果 |
|---|---|---|---|---|
| **L1 静态与单测** | GitHub runner + 本机 | 每次 push / PR（本机 `gates.mjs --quick`） | ESLint、全部单测 | 阻断合并 |
| **L2 构建与审计** | GitHub runner + 本机 | 每次 push / PR（本机 `gates.mjs`） | 构建、产物凭据扫描、依赖审计、授权矩阵 | 阻断合并 |
| **L3 部署后冒烟** | 服务器（容器健康检查通过后） | 每次 CI 部署完成 | `scripts/ci/smoke.mjs`：路由可达、JSON 字段契约、SEO 文件、安全响应头、响应时间预算 | 记日志 + 飞书告警，人工决定是否回滚 |
| **L4 对抗测试** | 服务器 / 本机 | 每次 CI 部署完成；安全复核时手动 | `scripts/security/adversarial.mjs`：越权、信息泄露、限流、输入健壮性、CSP nonce | 同上 |

## 二、怎么用

```bash
# 提交前随手跑（几秒）
node scripts/ci/gates.mjs --quick

# 完整门禁（含两个构建，数分钟）
node scripts/ci/gates.mjs

# 打一个运行中的站点（本地起服务后，或 TEST_BASE_URL 指向线上）
TEST_BASE_URL=http://127.0.0.1:3210 node scripts/ci/smoke.mjs
TEST_BASE_URL=http://127.0.0.1:3210 node scripts/security/adversarial.mjs

# 对线上站点跑对抗测试必须显式确认（会触发限流计数、产生审计日志）
ADVERSARIAL_ACK=1 TEST_BASE_URL=https://hangkathon.com node scripts/security/adversarial.mjs
```

服务器侧无需安装任何依赖：`deploy/ci.sh` 用 `node:22-alpine` 容器挂载 `scripts/` 目录执行
（宿主机只有 Docker，没有 node）。镜像已缓存，代价约 1 秒。

## 三、对抗测试覆盖了什么（对应安全检查表条款）

| 组 | 攻击面 | 断言 | 对应条款 |
|---|---|---|---|
| A 信息泄露 | 20 个敏感路径、`.map` 源码映射、错误回显、路径穿越 | 全部不可达，且错误响应不含堆栈/绝对路径 | 8.2 / 10.2 |
| B 越权访问 | 7 个管理读接口 + 5 个写操作 + 3 种伪造 cookie | 匿名一律 401/403/503；伪造会话不被认成管理员 | 7.2 / 7.3 |
| B 例外 | `/api/admin/session` | 它**应该**对匿名返回 200（客户端靠它区分三种界面），但断言 user=null、admin=false、不泄漏邮箱 | 10.2 |
| C 来源控制 | 7 种恶意作品链接（含 SSRF 探测内网与云元数据端点、后缀伪造） | 一律不返回 201 | 9.3.3c / 9.3.4 |
| D 限流 | 登录入口连打 20 次、写接口连打 12 次 | 触发 429 且带 `Retry-After`；写接口不出现 5xx | 8.2b |
| E 输入健壮性 | 畸形 JSON、字段类型错乱、2MB 请求体、异常 slug、不支持的方法 | 一律 4xx，绝不 5xx | 8.2 |
| F 响应安全 | CSP / HSTS / X-Powered-By / 缓存策略 / HTTP 跳转 | 安全头齐全、指纹不外泄、管理端不公开缓存 | 8.2 / 10.2 |

## 四、红线（改这套流程时必须守住）

1. **对抗测试只打自己的站点**。`TEST_BASE_URL` 指向非本地时必须设 `ADVERSARIAL_ACK=1`，
   脚本会打印目标并在无确认时拒绝执行 —— 这是防止误把别人的站当靶子。
2. **对抗测试不写业务数据**。C 组只做"应被拒绝"的请求，不会创建活动、不会改数据；
   D 组只触发限流计数。想验证"正向流程"（真发一场活动）请用手工脚本，不要塞进 CI。
3. **凭据永不进仓库，也不进构建产物**。workflow 的最后一步用模式扫描产物，
   命中就构建失败 —— 这是最后一道防线，不要因为"扫描太慢"把它去掉。
4. **失败不静默**。冒烟/对抗失败时 `deploy/ci.sh` 返回非零，systemd 会把这次运行标成 failed，
   `journalctl -u hangkathon-ci` 或 `/var/log/hangkathon-ci.log` 里能直接看到 FAIL 清单。
5. **不要用 `docker system prune`**（历史事故：会删掉运行中的容器与 compose 网络，站点直接 502）。
6. **改 workflow / 门禁前先看成熟开源项目的对应文件**（本项目已参考 shadcn-ui/ui 的
   `code-check.yml` 与 superagent-ai/skills 的 recon-security）；不要凭空设计流程。
7. **Windows 路径分隔符**：扫描类脚本（如 authz-matrix）读到的是 `\`，做 `startsWith("/api/…")`
   之前必须 `replaceAll("\\", "/")` 归一化，否则前缀判断在本地静默失效（CI 是 Linux，发现不了）。

## 五、已知边界（写在明面上，别假装覆盖了）

- **不做真实渗透测试**。这套是"回归防护"，证明已知防守还在；不能替代第三方渗透报告
  （安全检查表 8.2d 明确要求，属于采购事项）。
- **不做浏览器端 E2E**。渲染层与交互由人工/浏览器插件验证，CI 里只断言服务端产物。
  未来若要加，建议 Playwright 跑在独立的「夜间」job，不塞进 push 路径。
- **不做并发压测**。限流是功能验证，不是容量验证；真实容量要用 `wrk`/`k6` 单独做。
- **冒烟里的响应时间预算是 3000ms**（2C2G 的机器，给得宽松）。它只用来抓明显退化，
  不是性能指标。