# CI 与对抗测试规范

这份文档定义"改动怎么算通过"。目标是让**能被自动化验证的东西全自动**，
只把真正需要人判断的留给人工评审。

## 一、CI 的九个并行 job（2026-10-12 二轮加固后）

形态参考 [shadcn-ui/ui](https://github.com/shadcn-ui/ui) 的 `code-check.yml`：
**每个检查一个独立 job、彼此无 `needs`、并行启动**。二轮加固对照的开源实现与差距：

| 新增 job | 参考实现 | 补的是什么空白 |
|---|---|---|
| `shellcheck` | [koalaman/shellcheck](https://github.com/koalaman/shellcheck) | 17 个运维脚本此前**零静态检查**；那批"静默失败"缺陷正在它的规则集里（SC2181/SC2312/SC2046） |
| `actionlint` | [rhysd/actionlint](https://github.com/rhysd/actionlint) | workflow 自身的语法/表达式/上下文无人检查，且它会顺带把 `run:` 里的 shell 片段交给 shellcheck |
| `db` | PostgreSQL service container + `drizzle-orm` 官方 migrator | 8 个迁移、append-only 触发器、限流窗口 SQL 此前**零测试** —— 而 8.4.4 / 8.2b 的合规证据全在那几条 SQL 里 |
| `retina-guard`（漂移守卫） | 自有脚本 `scripts/ci/drift-guard.mjs` | timer 安装路径、nginx 公共片段、XFF 语义、死人开关接线这些"只写在文档里"的约定 |

| job | 内容 | 对应本地命令 |
|---|---|---|
| `lint` | ESLint | `npm run lint` |
| `shellcheck` | `deploy/**/*.sh` + `scripts/**/*.sh`，severity ≥ warning | `node scripts/ci/static-analysis.mjs shellcheck` |
| `actionlint` | `.github/workflows/*.yml` | `node scripts/ci/static-analysis.mjs actionlint` |
| `test` | 全部 `*.test.mjs`（递归发现） | `node scripts/ci/unit-tests.mjs` |
| `db` | 迁移应用/幂等、append-only 触发器、限流窗口、黑名单约束 | `DATABASE_URL=… node --test scripts/db-schema.test.mjs` |
| `build` | `next build` + 产物凭据/私钥扫描 | `npm run build:vercel` |
| `audit` | `npm audit --omit=dev --audit-level=high` | 同上 |
| `authz` | 授权矩阵（**按方法**切分） | `node scripts/security/authz-matrix.mjs` |
| `retina-guard` | 漂移守卫 | `node scripts/ci/drift-guard.mjs` |

好处：失败时看哪个 job 红即可，总时长从「串行相加」变成「最慢的那个」。

**为什么 build 只跑一次**：自托管与 Vercel 是**运行时**差异（有无 `DATABASE_URL`），
不是构建期差异 —— 两条命令产物同源。真正的双模式覆盖由服务器侧的冒烟 + 对抗套件负责（部署后验证）。

**依赖安装 5 次 → 6 次，但总时长反而更短**：`authz` 原先那次 `npm ci` 是纯浪费
（该脚本实测只 `import node:fs` / `node:path`），现已与漂移守卫合并，两者都不装依赖。
于是**只有 4 个 job 装依赖**（lint / test / db / build / audit 里除 authz 外），
且它们全部并行 —— 总时长是最慢的那个，不是求和。
`test` 与 `db` 必须装（8/9 个测试 `import "typescript"`，db 测试 `import "postgres"`）。

## 二、四层闸门

| 层 | 跑在哪 | 什么时候 | 内容 | 失败后果 |
|---|---|---|---|---|
| **L1 静态与单测** | GitHub runner + 本机 | 每次 push / PR（本机 `gates.mjs --quick`） | ESLint、shellcheck、actionlint、全部单测、授权矩阵、漂移守卫 | 阻断合并 |
| **L2 构建与审计** | GitHub runner + 本机 | 每次 push / PR（本机 `gates.mjs`） | 构建、产物凭据扫描、依赖审计 | 阻断合并 |
| **L3 数据库层** | GitHub runner（postgres service） | 每次 push / PR | 迁移应用与幂等、append-only 触发器、限流窗口表达式、外键策略 | 阻断合并 |
| **L4 部署后冒烟** | 服务器（容器健康检查通过后） | 每次 CI 部署完成 | `scripts/ci/smoke.mjs`：路由可达、JSON 字段契约、SEO 文件、安全响应头、响应时间预算 | 记日志 + 飞书告警 + 死人开关 fail，人工决定是否回滚 |
| **L5 对抗测试** | 服务器 / 本机 | 每次 CI 部署完成；安全复核时手动 | `scripts/security/adversarial.mjs`：越权、信息泄露、限流、输入健壮性、CSP nonce | 同上 |

另有 `.github/workflows/nightly.yml`（每日 03:00 CST）：完整渗透管线（限白名单资产）、
moderate 级依赖审计、覆盖率基线采集，只在失败时开 issue（固定标题去重）。

## 三、怎么用

```bash
# 提交前随手跑（一分钟内）
node scripts/ci/gates.mjs --quick

# 完整门禁（含构建与依赖审计，数分钟）
node scripts/ci/gates.mjs

# 数据库层（需要一个可丢弃的 Postgres；CI 上由 service container 提供）
docker run --rm -d --name hk-pgtest -p 55432:5432 \
  -e POSTGRES_PASSWORD=testpw -e POSTGRES_USER=testu -e POSTGRES_DB=testdb postgres:18-alpine
DATABASE_URL=postgres://testu:testpw@127.0.0.1:55432/testdb node scripts/ci/gates.mjs --with-db
docker rm -f hk-pgtest

# 打一个运行中的站点（本地起服务后，或 TEST_BASE_URL 指向线上）
TEST_BASE_URL=http://127.0.0.1:3210 node scripts/ci/smoke.mjs
TEST_BASE_URL=http://127.0.0.1:3210 node scripts/security/adversarial.mjs

# 本地 `next start` 没有数据库：接口会返回 503，与"防线失效"是两回事。
# 这时必须**显式**告诉套件哪些跳过是合理的，不要用一把总开关整体放行：
SMOKE_MODE=local TEST_BASE_URL=http://127.0.0.1:3210 node scripts/ci/smoke.mjs
ADVERSARIAL_ACK=1 TEST_BASE_URL=http://127.0.0.1:3210   REPORT_ALLOW_SKIP_NAMES="/api/admin/session 匿名 user 为 null,/api/admin/session 匿名 admin 为 false,/api/admin/session 不泄漏邮箱"   node scripts/security/adversarial.mjs

# SEO 检查（结构化数据 / robots / sitemap）。查的是**原始 HTML** ——
# 不执行 JS 的爬虫（GPTBot / PerplexityBot）看到的就是这一层。
TEST_BASE_URL=http://127.0.0.1:3210 node scripts/seo/audit.mjs

# 对线上站点跑对抗测试必须显式确认（会触发限流计数、产生审计日志）
ADVERSARIAL_ACK=1 TEST_BASE_URL=https://hangkathon.com node scripts/security/adversarial.mjs

# 运维脚本的故障注入测试（证明"故障下会失败"，全在本机沙箱里跑）
sh deploy/fault-injection.sh
sh deploy/lib/common-selftest.sh
```

服务器侧无需安装任何依赖：`deploy/ci.sh` 用 `node:22-alpine` 容器挂载 `scripts/` 目录执行
（宿主机只有 Docker，没有 node）。镜像已缓存，代价约 1 秒。

## 四、断言可信度：跳过就是失败

这是二轮加固的**核心机制**，值得单独说明。

原先的写法到处是 `if (接口返回 200) { 检查字段… }`。后果是：接口一旦返回 503，
那几条字段断言**直接不存在**了，汇总里还是"全部通过"。这类"少数即通过"比断言失败更危险，
因为它给出的是**好消息**。

现在的规则（`scripts/ci/lib.mjs`）：

- `precondition()` 无条件记录前置状态码断言；不成立时用 `skipGroup()` 把后续断言
  **显式记为 `skipped`** 并计入总数；
- `report()` 的汇总行输出 `N 跳过`；
- **默认 skipped > 0 即退出非零**；
- 确实合理的跳过（最典型：对回环 HTTP 目标检查 https 跳转）必须写进
  `REPORT_ALLOW_SKIP_NAMES` 白名单逐条点名 —— 一把开关整体放行会让护栏形同虚设，
  新出现的意外跳过会跟着被容忍。整体放行只在明确需要时用 `REPORT_ALLOW_SKIP=1`，
  日志里会留痕；
- `REPORT_JSON=<path>` 输出机器可读报告，渗透管线改读 JSON 而不再正则解析
  `[FAIL] name — detail` 文本（格式一改就静默失效的那种耦合）。

另有两条自我校验：

- **正则有效性断言**：可执行内联脚本那条检查现在额外断言"匹配到的脚本数 > 0"。
  正则写坏时（`\b` 经双层转义变成退格符，本项目犯过两次）会**失败**，
  而不是"零个内联脚本，检查通过"。
- **source map 动态发现**：从首页引用的 bundle 名推导真实 `.map` 路径，
  不再硬编码 `turbopack-0l4z7d8qbcroh.js.map`（框架升级后那条断言会永远通过）。

## 五、对抗测试覆盖了什么（对应安全检查表条款）

| 组 | 攻击面 | 断言 | 对应条款 |
|---|---|---|---|
| A 信息泄露 | 20 个敏感路径、真实产物名推导出的 `.map`、错误回显、路径穿越 | 全部不可达，且错误响应不含堆栈/绝对路径 | 8.2 / 10.2 |
| B 越权访问 | 8 个管理读接口 + 5 个写操作 + 3 种伪造 cookie | 匿名一律 401/403/503；伪造会话不被认成管理员 | 7.2 / 7.3 |
| B 例外 | `/api/admin/session` | 它**应该**对匿名返回 200（客户端靠它区分三种界面），但断言 user=null、admin=false、不泄漏邮箱 | 10.2 |
| C 来源控制 | 7 种恶意作品链接（含 SSRF 探测内网与云元数据端点、后缀伪造） | 一律不返回 201 | 9.3.3c / 9.3.4 |
| D 限流 | 登录入口连打至出现 429、写接口连打 12 次、`Retry-After` 主动打出来验证 | 触发 429 且带 `Retry-After`；写接口不出现 5xx | 8.2b |
| E 输入健壮性 | 畸形 JSON、字段类型错乱、2MB 请求体、异常 slug、不支持的方法 | 一律 4xx，绝不 5xx | 8.2 |
| F 响应安全 | CSP / HSTS / X-Powered-By / 缓存策略 / HTTP 跳转 / 内联脚本 nonce | 安全头齐全、指纹不外泄、管理端不公开缓存 | 8.2 / 10.2 |

## 六、红线（改这套流程时必须守住）

1. **对抗测试只打自己的站点**。`TEST_BASE_URL` 指向非本地时必须设 `ADVERSARIAL_ACK=1`，
   脚本会打印目标并在无确认时拒绝执行 —— 这是防止误把别人的站当靶子。
2. **对抗测试不写业务数据**。C 组只做"应被拒绝"的请求，不会创建活动、不会改数据；
   D 组只触发限流计数。想验证"正向流程"（真发一场活动）请用手工脚本，不要塞进 CI。
3. **凭据永不进仓库，也不进构建产物**。`build` job 用三种模式扫描产物
   （已知凭据形态 / PEM 私钥块 / `.env` 变量名=值），命中就构建失败。
4. **失败不静默**。冒烟/对抗失败时 `deploy/ci.sh` 返回非零，systemd 会把这次运行标成 failed，
   `journalctl -u hangkathon-ci` 或 `/var/log/hangkathon-ci.log` 里能直接看到 FAIL 清单；
   同时飞书与死人开关各发一路。
5. **不要用 `docker system prune`**（历史事故：会删掉运行中的容器与 compose 网络，站点直接 502）。
   清理悬空镜像用 `docker image prune -f`，自检脚本会在超过 15 个时告警。
6. **改 workflow / 门禁前先看成熟开源项目的对应文件**（本项目已参考 shadcn-ui/ui 的
   `code-check.yml`、superagent-ai/skills 的 recon-security、koalaman/shellcheck、
   rhysd/actionlint、healthchecks/healthchecks）；不要凭空设计流程。
7. **Windows 路径分隔符**：扫描类脚本（如 authz-matrix）读到的是 `\`，做 `startsWith("/api/…")`
   之前必须 `replaceAll("\\", "/")` 归一化，否则前缀判断在本地静默失效（CI 是 Linux，发现不了）。
8. **行尾符**：`.gitattributes` 钉死 `*.sh` 为 LF。Windows 上 `core.autocrlf=true` 会把检出
   变成 CRLF，而 Workbench 里用 `sed` 改过、再粘回本地的文件会带着 CRLF 进仓库 ——
   运行时未必炸（bash 把 `\r` 当普通字符吞进变量值），但会让比较静默失败。
9. **`.env` 只能解析，不能 shell source**（2026-10-17 实测事故）。真实经过：
   `FEISHU_ADMINS` 的值里含 `|`，而 `db_env` 当时用 `. "$APP_DIR/.env"` 读配置，
   shell 把整行解析成「赋值 | 命令 | 命令」→ 两条 `command not found` → 退出 127 →
   **每日备份静默中断两天**。危险之处在于报错说的是「line 28」，看着像文件损坏，
   而 timer 显示照常触发、退出码 0、零告警 —— 最终是完整性自检的
   「最新备份已 48 小时未更新」兜住的。
   现在改用 `hk_source_env`（只做 `KEY=VALUE` 解析、**不求值 VALUE**）；
   drift-guard 禁止任何脚本再直接 source `.env`。
   代价是**不支持 `KEY=$(command)` 这类动态值** —— `.env` 里本来也不该有。


## 七、已知边界（写在明面上，别假装覆盖了）

- **不做真实渗透测试**。这套是"回归防护"，证明已知防守还在；不能替代第三方渗透报告
  （安全检查表 8.2d 明确要求，属于采购事项）。Nightly 里那条也是自研管线，同理。
- **不做浏览器端 E2E**。渲染层与交互由人工/浏览器插件验证，CI 里只断言服务端产物。
  未来若要加，建议 Playwright 跑在独立的「夜间」job，不塞进 push 路径。
- **不做并发压测**。限流是功能验证，不是容量验证；真实容量要用 `wrk`/`k6` 单独做。
- **正向路径授权只覆盖了一半**。匿名被拒的断言很全，但"有权限者能进"需要
  `TEST_SESSION_COOKIE`（登录后的会话 cookie）才会执行；未提供时套件会打印一行提示。
  这是当前最大的单点覆盖缺口 —— 一次把鉴权改成"永远拒绝"的改动会让匿名断言全部变绿。
- **冒烟里的响应时间预算是 3000ms**（2C2G 的机器，给得宽松）。它只用来抓明显退化，
  不是性能指标。
- **数据库层测试跑在一次性 schema 上**（drop/create public），不测数据迁移的正确性
  （例如"某列的历史值转换对不对"），只测结构与约束。
