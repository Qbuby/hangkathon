# 全球赛事抓取（活动页「全球赛事」板块）

活动页底部的「全球赛事」展示近期全球竞赛 / 黑客松 / 创意赛事，数据由宿主机脚本每日抓取、
经 ingest 接口入库、`/api/events` 读取展示。本文记录源清单的实测结论、架构与运维。

## 窗口口径（用户定的）

- **开始日期**落在 `[今天-7天, 今天+90天]` 的才收录；
- 没有开始日期、但**截止日期**在 `[今天, +90天]` 的也收录（Deadline 驱动的目录站），页面显示「截止 x月x日 前报名」；
- 解析不出任何日期的条目一律丢弃；`lib/external-events.ts` 与 `scripts/events/fetch.py` 两端同口径过滤。

## 源清单实测结论（2026-09-25，从大陆服务器实测）

**能自动化的 7 个**（`scripts/events/fetch.py` 里的适配器）：

| 源 | 取数方式 | 说明 |
| --- | --- | --- |
| Topcoder | `GET api.topcoder.com/v6/challenges?status=Active`（公开 JSON） | v5 端点已 404，v6 直接可用；奖金从 prizeSets 求和 |
| MLH | `www.mlh.com/seasons/{年}/events` 服务端渲染 HTML | 卡片链接指 events.mlh.io，日期在卡片文本里 |
| DrivenData | `drivendata.org/competitions/` HTML | 卡片有奖金与结束日期；开始日期多半已过 → 走「截止日期」口径 |
| Contest Watchers | `/category/submit-before-deadline/` HTML | WordPress 服务端渲染，日期/奖金从卡片文本抠 |
| Reedsy | `reedsy.com/resources/writing-contests/`（前 2 页）HTML | 写作比赛目录 |
| XPRIZE | `xprize.org/competitions` HTML | 大奖赛周期以年计，多数没有近期日期，**当前大概率产出 0 条**，保留适配器等新赛事 |
| StudentCompetitions | `studentcompetitions.com/competitions` HTML | 卡片不一定带日期，产出不稳定 |

**做不了的 23 个**（原因实测，不要反复重试）：

| 原因 | 源 |
| --- | --- |
| 反爬 WAF（浏览器头也一样 403 / 人机验证页） | Devpost、Eventbrite（AWS WAF）、HackerEarth、AllEvents、10times、Global Game Jam、FilmFreeway、LensCulture、Architizer、HeroX |
| 纯 SPA 壳，列表数据走私有接口 | Kaggle、Zindi、DoQ（doq.world）、MIT Solve |
| 公开 API 存在但列表路径不可得 | Unstop（`/api/public/competition` 返回 `[]`，参数没破解）、DoraHacks（Nuxt 404）、Devfolio（api.devfolio.co 路径 404） |
| 大陆服务器直连超时（疑似被墙） | Meetup、Luma、AIcrowd |
| 页面上没有可解析的日期 | OpenIDEO（Webflow 落地页）、A' Design（dates 页无年份文本）、Unsigned Only（年度赛，无 deadline 文本） |

被墙的三个源如果将来要用，需要海外代理出口（例如 Cloudflare Worker 中转）；WAF 类源
**不要**尝试伪造浏览器指纹绕过 —— 那是对反爬意愿的正面对抗，风险与维护成本都不划算。

## 架构

```
systemd timer (每天 07:30, deploy/hangkathon-events.timer)
  └─ deploy/events-fetch.sh            # 宿主机，读 .env 的 EVENTS_INGEST_TOKEN
       └─ python3 scripts/events/fetch.py        # stdlib-only，7 个适配器，单源失败不拖垮整轮
            └─ POST /api/events/ingest           # Bearer 令牌，逐条校验（lib/external-events.ts）
                 └─ external_events 表           # (source, external_id) 唯一 upsert，last_seen_at 记新鲜度
                      └─ GET /api/events         # 公开读，窗口过滤 + 排序
                           └─ 活动页「全球赛事」  # app/global-events.tsx，无数据整块不渲染
```

- 抓取跑在**宿主机**（服务器现成 python3.11），不进容器 —— 与抖音取数「纯脚本、不依赖算力」同一条路线。
- 入库口按 `(source, external_id)` upsert：同一赛事每天重抓只更新，不重复插入；`last_seen_at`
  两周没更新（源不再产出）或开始日期过期 30 天的行会被清理。
- localStorage 模式（Vercel 那份）`/api/events` 返回 503，前端 `listGlobalEvents()` 捕获后返回空列表，整块不渲染。

## 取数礼貌

- 每源每天 1–2 个请求（Reedsy 翻 2 页），带自标识 UA（`HangkathonEvents/1.0`），20s 超时，失败重试一次。
- 只抓公开列表页，不登录、不绕反爬、不存个人数据；展示带原文链接回源站。
- 数据仅作聚合展示，报名/规则以主办方页面为准（页面上也这么写）。

## 测试

```sh
node --test scripts/events/events.test.mjs
```

- 每个 adapter 有 `scripts/events/fixtures/` 样本（按实测的页面结构构造），
  `fetch.py --self-check` 离线验证解析器；
- 跨语言契约：node 测试实际 spawn `python3 fetch.py --fixture --no-window` 校验输出契约；
- `normalizeEventInput` / `filterByWindow` 的通过与拒绝路径。

页面结构变了导致某源解析出 0 条时：先 `python3 scripts/events/fetch.py --source <名字>` 看真实输出，
更新对应 fixture 与正则。

## 改动清单（2026-09-25）

- `scripts/events/fetch.py` + `fixtures/`：抓取脚本（7 适配器、窗口过滤、自检、fixture 离线模式）。
- `db/schema.ts` + `drizzle/0002_daily_global_events.sql`：`external_events` 表。
- `lib/external-events.ts`（纯逻辑契约）、`lib/server/external-events.ts`（upsert/查询/清理）。
- `app/api/events/route.ts`（公开读）、`app/api/events/ingest/route.ts`（令牌入库）。
- `lib/api/data.ts` 的 `listGlobalEvents()`、`app/global-events.tsx` + `global-events.css`、活动页挂载。
- `deploy/events-fetch.sh` + `hangkathon-events.{service,timer}`、`deploy/README.md` 运维节。
