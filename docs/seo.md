# SEO 实现说明（对照 claude-seo 规范）

这份文档记录本站 SEO 的实现依据与边界。参考实现：
[AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo)（v2.4.2，
其 `seo-technical` / `seo-schema` / `seo-sitemap` / `seo-geo` 四组规范）。

检查方式：`TEST_BASE_URL=http://127.0.0.1:3210 node scripts/seo/audit.mjs`
（89 条断言；已接入服务器 `deploy/ci.sh` 的部署后检查与本地 `gates.mjs --with-e2e`）

## 〇、已下线的页面：410 Gone

起因是一个真实反馈（2026-10-13）：在 Google 里仍能搜到
`hangkathon.net/activities/midautumn-poetry`。查证结果是——**这不是一个活着的页面**：

| | 实际状态 |
|---|---|
| 内容 | 2026-09-22 那次上线清理时就删了，生产库里只剩 `guoqing-77` |
| 生产库 | 无该 slug 的任何行 |
| sitemap | 不含该 URL（只有 5 条） |
| `.com`（自托管，canonical 目标） | 404（改前）/ 410（改后），带 `noindex` |
| `.net`（Vercel 部署） | 308 跳到 `.com`，不返回任何内容 |
| 搜索摘要里那句描述 | 站点级兜底文案（`app/about/page.tsx` 与 `lib/seo/schema.ts` 各一份），不是残留的页面内容 |

也就是说：**这是一条陈旧的索引，不是线上还有一页。** 索引的清除在搜索引擎侧，
通常要数天到两周。代码能做的是把"这页永久没了"这个信号表达准确，并让它一直准确。

改动（`middleware.ts` + `lib/seo/retired-slugs.ts` + `lib/seo/retired-page.ts`）：

- 名单里的 slug（`midautumn-poetry` / `shop-ai-assistant` / `city-memory-map`）返回
  **410 Gone**，自带 `noindex`、`x-robots-tag: noindex`、`cache-control: no-store`。
- **只在非跳转域名上生效**：`hangkathon.net` / `www.hangkathon.net` 仍是 308 到主站。
  middleware 里先判 host 再判 slug，顺序反了 `.net` 上会出 410，与"这个域名只做跳转"矛盾。
- 判定只认恰好一层 `/activities/<slug>`（含结尾斜杠、百分号编码、大小写变体）；
  **拼错的地址仍然是 404**。混合两者会让 410 退化成"所有找不到的地址都一样"，
  那还不如直接用 404。

关于 410 与 404 的关系，说清楚边界：**没有实测证据表明 410 比 404 更快被移出索引**；
两者都表达"不该收录"。选 410 的理由是信号精确——对一个确知不会回来的地址，
不该用留了余地的 404 去表达。不要把它当作"加速下线"的手段。

为什么放在 middleware 而不是活动详情页：App Router 的 `notFound()` **只能**产出 404，
没有把它改成 410 的办法；要赶在渲染之前决定状态码，只能在 middleware 这一层。

守卫：`scripts/seo-retired.test.mjs`（6 个用例，含"不该命中"的反例与
"名单不得与已发布列表撞车"的不变量）、`scripts/seo/audit.mjs` 第 3b/3c 组，
以及 `scripts/ci/drift-guard.mjs` 里对 middleware 三个判定点的静态检查——
那条守卫防的是**静默退化**：有人重构 middleware 时删掉 410 分支，线上不会有任何报错，
只是已下线的地址又变回 404，直到下次翻索引才发现。

## 一、结构化数据（JSON-LD）

| 页面 | 节点 | 依据 |
|---|---|---|
| 首页 | `WebSite` + `Organization` | 站点实体与组织实体，`@id` 固定，供其它页引用 |
| 活动看板 | `CollectionPage` + `ItemList` + `BreadcrumbList` | ItemList 把每个活动按序指出，替代"让爬虫猜链接关系" |
| 活动详情 | `Event` + `BreadcrumbList` | Event 必需属性：name / startDate / endDate / location / organizer / offers |
| 关于 | `Organization` + `AboutPage` + `BreadcrumbList` | 组织实体配上 legalName / logo / email / contactPoint |
| 荣誉榜 | `WebPage` + `BreadcrumbList` | 只声明页面身份，**不**把排行榜写进结构化数据（见下） |
| 管理端 / 登录失败页 | 无 | 带 `noindex` |

实现要点：

- **一律 JSON-LD**，`@context` 用 `https://schema.org`
- **URL / 图片必须绝对地址**；日期用 ISO 8601；空属性一律丢弃（`compact`）
- **服务端注入**：`JsonLd` 是服务端组件，标签在首屏 HTML 里就存在。
  不执行 JS 的爬虫（GPTBot / PerplexityBot）读得到；Google 也不会推迟处理。
- **不生成**：`HowTo`（2023-09 移除富结果）、`SpecialAnnouncement`（2025-07 弃用）、
  `FAQPage`（2026-05 起所有站点都不再有富结果）
- **荣誉榜刻意不输出排行榜数据**：结构化数据必须是可核验的事实，而名次与贡献值
  随结算实时变化、且涉及个人收益隐私（用户的明确要求）。写进去既会误导摘要，也越过隐私线。

### 序列化安全（本轮修掉的真实注入面）

`JSON.stringify` **不转义 `<`**，而活动标题/简介/主办方都是用户可填字段。
用受控实验确认过：标题里带 `</script>` 时，页面里会真的多出——

- 一个 `<meta name="robots" content="noindex">`（能让我们自己的页面被 noindex）
- 一个隐藏 `<div>`
- 一条指向任意外站的 `<a>` 链接

（脚本本身被 CSP 的 nonce 挡住，但**标记**是静态的，CSP 管不着。）

修法：`lib/seo/jsonld.ts` 的 `toJsonLdScript()` 把 `<` `>` `&` `\u2028` `\u2029`
转成转义序列。同一个实验也确认了：**CSP 不会拦 `application/ld+json`**
（带不带 nonce 都能被解析）—— 所以转义是唯一防线，不能指望 CSP。

**同一条规则由 `scripts/ci/drift-guard.mjs` 在每次 push 时守着**：
任何页面只要注入了 ld+json 却没走安全序列化就失败。

## 二、技术 SEO

- **渲染**：所有对外内容页都是服务端组件或 `force-dynamic`，正文与 meta 在首个 HTML 里。
  唯一客户端组件是管理端（本来就不该被收录）。
- **canonical**：每个可收录页自指且唯一；`/manage`、`/auth-error` 带 `noindex`；
  已永久下线的地址走 410（见第〇节）。
- **带数据库的部署上，查不到的活动必须 404**：否则任何路径都会拿到
  HTTP 200 + 一句"没有找到这场活动"，状态码撒谎会让爬虫把无限多的垃圾 URL 当成有效页收录。
  无数据库的部署（Vercel 那份）不能这么判——用户自建活动只存在浏览器里，
  服务端查不到是正常的，由客户端接管。
- **robots.txt**：显式声明 AI 搜索类与训练类爬虫（见下）。
- **sitemap**：只含公开已发布的活动；`lastmod` 用库里的真实 `createdAt`；
  **不输出 `priority` / `changefreq`**（Google 明确忽略）；单文件 45,000 条截断
  （协议上限 5 万，留余量），越界时打日志提示需要改造成 sitemapindex。
- **标题/描述**：每页唯一，标题带地域+品类词（百度展示约 30 字）。
- **H 层级**：首页原先整页只有 h1、正文无 h2，现已把英雄区下方四块能力说明改为
  `h2 + p`（CSS 选择器同步），页面结构不再是空的。

## 三、GEO（生成式引擎优化）

**先记一条 Google 官方立场**：从 Google 搜索的角度，为生成式 AI 搜索做优化
**就是** SEO —— 没有独立的"AI 索引"，`llms.txt` 一类文件对 Google 搜索既无帮助也无损害。
所以下面的做法分两类：真影响可见性的（必须做）与零成本的防御性动作（可选做）。

必须做的：

- **内容在服务端渲染**：多数 AI 爬虫不执行 JS
- **实体链接**：Organization 带 `sameAs` / `logo` / `contactPoint`，并被各页 `@id` 引用
- **明确的抓取许可**：逐条声明 AI 爬虫，而不是靠通配符解释

可选做的（零成本、不影响搜索引擎）：

- `/llms.txt`：内容方通用的站点导览，服务于会主动读取它的 AI 工具。
  **不宣称**任何排名或引用收益 —— 公开研究（SE Ranking 30 万域名、OtterlyAI 服务端日志）
  显示它不是主流 AI 搜索的引用杠杆。

### robots.txt 的爬虫分组

最容易搞混的两对，按各自管的**能力**分开声明，不合并成一行：

| 能力 | 对应的爬虫 | 不管这个能力的 |
|---|---|---|
| ChatGPT 搜索能否引用本页 | `OAI-SearchBot` | `GPTBot`（只管训练） |
| Claude 搜索能否引用本页 | `Claude-SearchBot` | `ClaudeBot`（只管训练） |
| Google 搜索 / AI Overviews 收录 | `Googlebot` | `Google-Extended`（只管 Gemini/Vertex 训练与 grounding） |

本站策略：**搜索类与用户触发类全部放行**（活动信息本来就该被发现），
**训练类同样放行**（内容方选择，不是技术必需——这一条写在 robots.ts 的注释里，
避免后来人把它误读成"必须允许"）。

## 四、本轮没做 / 不适用

- **Hreflang**：站点只有 `zh-CN` 一个语言版本（导航上的「中/EN」是占位）。
  等真有英文版再按 `zh-Hans` / `en` 建 hreflang 集合 —— 现在加只会是空声明。
- **Core Web Vitals 实测**：需要真实用户数据（CrUX）或实验室环境跑 Lighthouse。
  服务器侧的量级参考是 TTFB 约 0.1s、首个 HTML 18–30KB，远不到爬虫的 2MB 上限。
  真要做需要在独立环境起 Lighthouse，不适合塞进部署后检查。
- **第三方关键词/外链数据**：需要采购（DataForSEO、Ahrefs 之类）。
- **`FAQPage` 结构化数据**：Google 已全面取消该类富结果，不生成。
