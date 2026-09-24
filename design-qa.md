# 杭客松首页升级 — Design QA

## 二级页 wordmark 换成深墨绿新稿 — 2026-09-24

- The user supplied a new artwork and asked for it on every non-homepage page. The file is 1536 × 1024 RGBA with a **fully transparent** plate (the white I first saw was the composite), holding a dark-teal lockup — typography and outlines in `#002020` over a pale-mint gradient bridge — plus a water reflection below the mark.
- Added `scripts/derive-header-wordmark.py`, which stores the supplied plate as `public/brand/hangkathon-logo-teal-source.png` and derives the header wordmark `public/brand/hangkathon-logo-teal.png`: it zeroes the alpha=1 compression halo, crops just above the reflection, and resizes through premultiplied alpha with the colour untouched (the artwork is already dark ink, so the luminance remap that produced the old navy twin would have been wrong).
- **The reflection was the one real judgement call.** Measured on the mark's column band, alpha holds ~240 down to the water line at y≈745 then decays 224 → 196 → 154 → 96 into the mirror below, and the text block ends at y≈728 — so the reflection is a half-height copy of the mark. Three crops were rendered at the real 68px header height side by side: the current navy twin (203 × 68), the new artwork without the reflection (212 × 68), and with it (170 × 68, leaving the mark about 34px). The middle one wins on legibility, and its 3.11 ratio sits close enough to the old 2.99 that the header does not move. The comparison variant is written to the OS temp dir, not into the repo.
- Verified: the derived file is 1400 × 450, median composited colour `(63,112,87)` at a **5.71** contrast ratio against white (the silver original it replaces sat at 1.42, and the navy twin at 4.52); it renders 212 × 68 in the header, within 4% of the previous width, so nothing shifts. The homepage keeps the silver original over the hero, unchanged. ESLint 0/0, tsc clean, both build targets passed.

## 阿里云自托管部署与 CI — 2026-09-24

- 在用户那台轻量应用服务器（cn-shanghai，Alibaba Cloud Linux 3，2C2G/40G）上做了一份**独立于 Vercel** 的部署：`Dockerfile` 多阶段构建出 Next.js standalone，`docker-compose.yml` 以 `3210:3000` 暴露、`restart: unless-stopped`、带容器级健康检查。`next.config.ts` 只在 `DOCKER_BUILD=1` 时开 `output: "standalone"`，所以 Vercel 与 Cloudflare 两个构建目标完全不受影响。该机器上原本跑着宝塔面板(21077)、nginx(80/888)、PostgreSQL(5432)，部署只占用 3210。
- 仓库是私有的，服务器无法 clone，所以首次源码是用云助手分片上传的（`/opt/hk-src` 26 个 16KB 分片 + sha256 校验后解包），`public/` 下 6 个未随包上传的大图从线上 hangkathon.net 抓回。之后改成 git 检出 + CI，这条一次性路径只保留在 `deploy/README.md` 里备查。
- **CI**：`deploy/ci.sh` 由 `hangkathon-ci.timer` 每 3 分钟调用一次 —— `git fetch origin main`，SHA 未变则静默退出，变了才 `reset --hard` + `docker compose up -d --build` + 等 `127.0.0.1:3210` 健康检查通过，并写 `/var/log/hangkathon-ci.log`。认证用**只读 deploy key**（私钥只在服务器 `/root/.ssh/hangkathon_deploy`，公钥 id 164224058 加在 GitHub 仓库 Settings → Deploy keys）。
- 验证：容器 `healthy`、重启次数 0；8 条路由与静态资源从公网全部 200；`prefers-reduced-motion`、动效层、日期筛选、改名后的活动标题在部署实例上逐一核对过。CI 用一个本地裸仓库冒充 origin 做过整链路干跑（fetch → 比对 → reset → 重建 → 健康检查全部走通，日志写入 `已部署 9fd369b —— 健康检查通过`），跑完 origin 自动恢复为 GitHub；随后用真实 GitHub 推送验证自动更新。

## 全站入场动效（除首页）— 2026-09-23

- The user asked for anime.js (juliangarnier/anime) to drive interaction and entrance motion. Installed `animejs@^4.5.0` (MIT, ESM+CJS, tree-shakeable subpaths) and added one motion layer instead of per-page animation code: `app/motion.ts` (constants + pure `revealPlan`), `app/motion-scope.tsx` (`usePageMotion`, built on anime's `createScope` with a `mediaQueries` reduced-motion flag), `app/motion.css`, and `app/motion-mount.tsx` for the two server pages. Elements opt in with `data-reveal="block"` (mount only) or `data-reveal="item"` (also replayed when a data signature changes). The homepage is deliberately excluded — it already runs the Three.js scene.
- No-flash, never-stuck design: a small inline script in the root layout sets `html[data-motion="on"]` before paint (only when the user has not asked for reduced motion), CSS hides `[data-reveal]` only while that attribute is present, and the attribute is dropped unconditionally after `MOTION.windowMs` (1400ms). JS-disabled content and anything rendered after mount therefore can never be hidden — this fixed a flaw in the first draft, where content appearing after mount (detail sections, filter results, the create success screen) would have stayed invisible forever.
- Verified: entrance sampling shows `/activities` cascading h2 → feed item → sidebar row (each 0→1 in ~420ms, ending at exactly 1.00), `/activities/[slug]` cascading tags → h1 → sections → facts, a filter change replaying only the items pass (group head → 3 items → count line), a step change on `/create` replaying only the form panel while the sticky preview card stays at 1.00, and the 展开更多 toggle animating height 49→98px with opacity 0.55→1 then clearing its inline height/overflow without navigating. The sticky filter panel still pins at y132 at scroll 900/2000 with the motion layer active, and after every pass all six non-home pages report zero `[data-reveal]` elements below opacity 1. Reduced motion was checked in-browser by faking `matchMedia` before a client-side navigation: the new page's 16 marked elements received zero inline styles, i.e. nothing animated. SSR HTML carries the markers but no inline `opacity:0`.
- `scripts/motion.test.mjs` (node:test + ts.transpileModule, same pattern as the existing script tests) asserts that reduced motion yields no plan, that every page has a distinct root, that parameters stay inside the agreed medium band, and that the boot script always releases the hidden state. ESLint 0/0, tsc clean, both builds passed.

## 看板筛选面板加日期区间 — 2026-09-23

- The user asked for a calendar filter so activities can be narrowed to a date range. The panel gained a 日期 row with two native `<input type="date">` fields (same control the create form already uses) separated by 至, and the range filters by **overlap**: an activity stays when its end is not before the start bound and its start is not after the end bound, with each bound optional and missing dates falling back to whichever date the record has. 清除筛选 clears the range too, and the range counts as one active filter for the 清除筛选 affordance. Each input also carries `min`/`max` against the other so the picker cannot build an inverted range.
- Verified: 起始日期 2026-10-01 keeps the activity (共 1 场), 2026-10-10 gives 共 0 场 with the empty state, 结束日期 2026-09-01 gives 共 0 场, the 2026-09-25 → 2026-10-02 range keeps it, and 清除筛选 returns 共 1 场 with both fields emptied; setting 起始日期 stamps `min` on the 结束日期 input.
- Layout note: a native date input has an intrinsic width of ~121px, so two of them only fit side by side in the 300px panel. Below 1500px the panel narrows to 272px and the two fields stack vertically instead (1440/1200 measured 226px each); at 1920 the row is horizontal with 114px fields and both dates render in full. No horizontal overflow at 1920/1440/1200/420. ESLint 0/0, both builds passed.

## 活动看板筛选排序移到信息流右侧 — 2026-09-23

- The user asked for the category filter and sort controls to move to the right of the activity feed. The board body is now two columns: the feed keeps its 820px measure on the left, and a filter panel (类别 / 奖金 / 形式 / 费用 / 排序, plus 共 N 场 with 清除筛选) sits against the right edge of the content column, sticky 132px from the viewport top so it clears the 116px fixed header. Filter rows went from label-left/chips-right to label-above-chips to fit the 300px column, and the panel takes a very light `#f8fbfe` plate so the right column reads as a control surface rather than floating chips.
- Verified: at 1920 the feed is 820 wide at x217 and the panel 300 wide at x1403, flush with the content right edge and top-aligned with the first group; the panel pins at y132 while the feed scrolls under it (checked at scroll 700 and 1600 against nine injected test activities, then the injected rows were cleared); clicking 技术探索 yields 共 0 场 with the empty state and 清除筛选 restores 共 1 场 with the item back; the panel goes full-width above the feed at 1180 and below, and the 1500 breakpoint trims the panel to 272px so mid-size laptops keep a 695–803px feed; no horizontal overflow at 1440/1300/1180/1100/900/420. ESLint 0/0, both builds passed.

## 二级页 wordmark 换深色版 — 2026-09-23

- The user reported the header logo was hard to tell apart from the white background on the secondary pages. Measured cause: `public/brand/hangkathon-logo.png` is silver artwork drawn for the dark hero — 26% of its opaque pixels are literally `#f8f8f8`, and its median opaque colour composites to `(205,218,232)` over white, a 1.42 contrast ratio against the 3.0 graphics minimum. An earlier attempt had darkened it with a CSS `invert(1) brightness(.62) sepia(.18) hue-rotate(160deg)` filter; that reached 17.4 but flattened the artwork's tonal range, and when the filter was later dropped the contrast problem returned.
- Added `scripts/derive-dark-wordmark.py`, which reads the shipped wordmark and writes `public/brand/hangkathon-logo-dark.png`. Alpha is copied verbatim so the two files are pixel-identical in geometry, and RGB is ramped from `#071a30` to `#8aa6c0` by WCAG relative luminance, so the bright strokes survive as slate-blue highlights instead of being crushed. `app/site-header.tsx` picks the file from its `transparent` prop: the homepage keeps the silver original over the hero, every other route gets the dark twin.
- Verified: derived file is 1400 × 468 with a byte-identical alpha channel; measured in the rendered page (alpha composited over the white header, 154,306 opaque pixels) the median is `(100,124,148)` at 4.33 contrast versus 1.42 before, p10 2.67 / p90 11.8; the logo box is x113 y24 203 × 68 on both `/` and `/activities`, so swapping files causes no layout shift; `/` still requests `hangkathon-logo.png` while `/activities`, `/activities/midautumn-poetry`, `/leaderboard` and `/create` request the dark file. ESLint 0/0, both builds passed.

## 创建表单与展示同步移除组队概念 — 2026-09-20

- The user noted the create form still asked for team settings, which the faction-competition mechanism made obsolete. Removed `maxTeamSize`/`openTeam` from the `Activity` type, the schedule step (now「活动时间」, two date fields only), `initialDraft`, `toActivity`, and `normalize` (old localStorage records with those fields are silently dropped on read). Demo activities stripped; 看板卡片 and 详情页 关键信息 lost their 队伍/组队 rows (facts now 时间/地点/奖金/费用/报名/活动代号); the create preview card lost its 队伍 row; the online-format hint reworded away from 组队. Unused `Users` icon imports removed. README's create-flow section updated.
- Verified: create form shows 6 steps with step 3 = 活动时间 (2 date inputs, no 单队最多人数/自由组队 anywhere on the page); board cards and detail facts carry no team wording; ESLint 0/0, tsc clean, both builds passed.

## 移除「十区/两县/一市」分组标签，阵营一视同仁 — 2026-09-20

- The user ruled that the 十区/两县/一市 classification is common knowledge needing no special callout, and all factions must be treated equally. All group labels were removed worldwide: the join dialog is back to a flat 13-button grid (3 columns desktop / 2 mobile); the leaderboard faction list is a flat 13 rows sorted purely by points (zero-contribution factions dimmed at the bottom); the detail page faction list is flat data-only. Copy switched from 十区两县一市 phrasing to 「杭州 13 个县级行政区」; the stats tile now reads 阵营 13 个. `FACTION_GROUPS`, `FactionType`, and the group CSS (`.faction-group`, `.faction-group-label`, `.join-faction-grid`) were deleted; `docs/prize-mechanism.md` and README list the 13 divisions flat with 「一视同仁」 stated.
- Verified: leaderboard shows 13 flat rows (拱墅 3,740 first → 建德 0 last, 4 zero rows dimmed) with zero group labels; join dialog has 13 radios, no labels, neutral description; detail list flat; grep confirms no 十区/两县/一市 string anywhere in app/, lib/, docs, README; no overflow at 390. ESLint 0/0, tsc clean, both builds passed.

## 全局统一：阵营列表一律按十区/两县/一市分组 — 2026-09-20

- The user pointed out the 算力榜 faction list was still flat while the join dialog was grouped; asked for global consistency. Now every faction listing follows the same structure with a shared `.faction-group` / `.faction-group-label` style (detail.css, renamed from the dialog-scoped label class).
- `/leaderboard` 阵营贡献 shows **all 13 factions** in three groups (十区 10 / 两县 2 / 一市 1), sorted by points within each group; factions with no contribution render 0 · 0.0% with a dimmed `.is-zero` row and an empty bar. The stats tile changed from 上榜阵营 9 个 to 阵营 13 个（十区两县一市）. The donut still plots only non-zero slices.
- Activity detail 阵营贡献 list: same grouping, showing only factions with data for that activity (group labels appear only when the group has rows) — keeps per-activity lists compact.
- Verified: leaderboard groups render 10/2/1 with zeros dimmed and ordered last within groups (钱塘/临安/淳安/建德 at 0); midautumn detail shows one group (十区 · 市辖区) with its 5 data rows; no horizontal overflow at 390 on either page; ESLint 0/0, tsc clean, both builds passed.

## 阵营分组：十区 / 两县 / 一市 — 2026-09-20

- The user confirmed the faction scope: all 13 county-level divisions of Hangzhou (十区两县一市). The list already matched exactly; this pass makes the structure visible. `lib/factions.ts` gained `FactionType` ("district" | "county" | "city") and `FACTION_GROUPS` labels; the join dialog now renders three labeled groups — 十区 · 市辖区 (10), 两县 (2), 一市 · 县级市 (1) — desktop 5-column grids per group, mobile 2-column. Faction ids/colors unchanged, so joins, leaders, demo data and invite links are unaffected.
- Wording synced: `docs/prize-mechanism.md` 阵营选择 step and README summary now say 十区两县一市 instead of 13 个区县.
- Verified: dialog shows the three labels with counts 10/2/1 and 13 radios; picking 桐庐县 enables 确认报名; mobile 390 dialog has no overflow; no join data left in storage after testing. ESLint 0/0, tsc clean, both builds passed.

## 邀请链接携带区长身份，受邀方不会再看到「担任区长」选项 — 2026-09-19

- User report: account A claimed 西湖区 leadership in shop-ai-assistant, invited account B; B refused then free-signed-up and the dialog still offered 担任西湖区区长. Root cause: leader records live in localStorage per browser with no backend — B's browser (a second browser/incognito; same-browser would have shown A's 已报名 join instead) simply had no record of A's claim, so 西湖区 looked leaderless.
- Fix within the no-backend constraint: the invite link itself is authoritative evidence of leadership (minted from the leader's panel). On opening `?invite={faction}&by={name}`, the page calls `noteInviteLeader()` which writes a `hangkathon.knownleaders.v1` roster entry for that activity+faction — kept even if the invite is refused. `getLeaders()` now merges three sources in priority order: DEMO_LEADERS seeds → invite-derived known leaders → local claims. First implementation passed a raw string instead of a LeaderRecord into the merge, rendering 「现任区长 · （…）」 with an empty name — caught in self-test and fixed by mapping entries to `{name, since:""}`.
- Verified end-to-end simulating B's fresh browser: cleared joins/leaders/knownleaders → opened `?invite=xihu&by=my_account_A` (roster written at load) → refused → free join dialog on 西湖区 shows 「现任区长 · my_account_A（该阵营区长区长已有人担任）」 with the claim checkbox hidden, while 上城区 (genuinely leaderless) still offers the claim. Regression: seeded 西湖区 note and the full claim flow (checkbox → confirm → chip + invite link) unchanged. Test records cleaned.
- Remaining honest limitation, documented in README: without a backend, leadership is only visible to browsers that have seen the claim (local) or an invite link (known-roster). True cross-device leader state needs the server-side store planned with the database.

## 区长机制：首位加入者可当区长 + 邀请链接 — 2026-09-19

- Spec from the user: the first user to join a faction may optionally claim 区长 (faction leader); the leader shares an invite link valid at any stage during the activity; an invitee can only join the leader's faction or refuse, and accepting requires login; each successful invited join pays the leader a contribution bonus. Implemented as: `JoinRecord` gains `leader?`/`invitedBy?`; new leaders store `hangkathon.leaders.v1` with `getLeaders()/saveLeader()` and `DEMO_LEADERS` seeds (midautumn 西湖区=lakeside_verses, shop 拱墅区=shopkeeper_hz, city-memory 西湖区=broken_bridge) so both the 现任区长 (no checkbox) and 担任区长 (checkbox) states are demonstrable; `LEADER_INVITE_BONUS = 50`.
- Join dialog: picking a seeded faction shows 「现任区长 · {name}」 with no leader option; picking an open faction shows a gold 「担任{区}区长」 checkbox with the invite-bonus hint. Confirming with the claim writes both stores; the joined sidebar then shows a 区长 chip, the invite link (`/activities/{slug}?invite={factionId}&by={name}`, with a copy button using clipboard API + execCommand fallback), and the +50/invitee note; invitees see 「由 {name} 的邀请链接加入」.
- Invite banner parses `?invite=&by=` on mount (no useSearchParams, keeping SSG): title/summary + 加入该阵营/拒绝 buttons. Accepting checks `/api/session`; without a user it swaps to a login gate with provider buttons (signIn callbackUrl = current invite URL) — and a 拒绝邀请 escape hatch, added after testing showed the first version trapped the user in the gate. Refusing dismisses the banner; normal free-choice signup remains. Docs updated (`docs/prize-mechanism.md` 区长与邀请 section + +50 row in the honor table); profile 我的报名 rows show a 区长 chip.
- Verified on the production build: banner on `/activities/city-memory-map?invite=xihu&by=lakeside_verses` renders and refuses cleanly; accept → login gate with 2 disabled providers + refuse; midautumn dialog shows seeded leader for 西湖区 and the claim checkbox for 上城区; claim → confirm → leader chip + invite link + `leaders.v1` written (`shangcheng: 本机市民`); reload persists; profile shows the 区长 chip; copy button reaches 已复制 via fallback; 390px mobile has no overflow on banner or leader panel. Demo-activity invitee joins cannot complete locally (login unconfigured) — path shares saveJoin with the tested normal join plus invitedBy. Test records cleaned afterwards.

## Leaderboard shows usernames + your entry — 2026-09-19

- The user directed that the 市民贡献榜 should display 用户名 (usernames), not the fictional Hangzhou poetic nicknames. All 31 demo member records in `lib/contribution.ts` were renamed to username-style handles (osmanthus_lane, binjiang_ferry, code_osmanthus, …), consistent per citizen across activities, so aggregation and the top-10 ranking stay unchanged.
- New client `app/leaderboard/your-entry.tsx`: below the table, a signed-in visitor sees their real username in a dashed 「你」 row (平台贡献值 0 · 未进入前十) fed by `/api/session`; hidden when signed out. Verified locally: 10 handle rows, No.1 osmanthus_lane, YourEntry absent without session, no horizontal overflow.
- Previous entry's 桂花巷-style names remain in history below; live data now uses handles.

## 核心机制落地 — 2026-09-19

- Mechanism defined in full at `docs/prize-mechanism.md`: join → faction lock (13 Hangzhou districts) → daily ¥100 compute voucher (+¥5 per invite, cap ¥200) → 24h quality review (优100/良60/合格30/未通过0, max 3 valid submissions/day) → faction contribution = sum of member points → prize split two-layer proportional (faction share × personal share; named awards become honorary titles) → settlement bonuses (organizer 10%, top10% +200, top30% +100, champion faction +150, runner-up +80, finisher +50) → 数字杭州市民 medal ★1–★5 at 0/500/2,000/6,000/15,000 platform points, never downgrades.
- New `lib/factions.ts` (13 districts with shared colors) and `lib/contribution.ts` (MECHANISM constants, demo contribution data for the three demo activities, factionShares/platformTotals/honorLevel, join records in localStorage `hangkathon.joins.v1`). `app/donut.tsx` is a hand-rolled SVG donut — no chart library added.
- Activity detail page gained a 阵营贡献 section (donut + per-faction points/share/estimated prize; no-prize activities show no money column) and a working join flow: 报名参加 opens a dialog with a 13-district radiogroup + lock warning; after confirming, the sidebar shows 已报名 + faction badge + voucher rules and the join button disappears entirely — faction cannot be re-picked even after reload (verified: 0 join buttons remain, localStorage holds the record).
- `/leaderboard` (nav 算力榜 is now a real Link): platform total 15,090 · 3 activities · 23 citizens · 9 factions, faction donut + share bars, citizen ranking with No.1–3 highlights. `/profile`: signed-out login card (providers marked 未配置 locally), signed-in 数字杭州市民 medal card starting at ★1/0 points + demo citizen comparison + 我的报名 local records (shown in both login states — join records are device data, not account data). Session dialog signed-in state gained a 查看个人主页 link.
- Verified in browser (production build): leaderboard donut programmatically exact (9 segments, shares match list, center 15,090); detail donut 4,700 with 西湖区 ¥9,702 = 30,000 × 32.3%; join flow on desktop and 390px mobile (dialog 2-column, 340px wide); after joining two activities /profile listed both with faction colors; no horizontal overflow on /, /leaderboard, /activities/[slug], /profile at 390. Visual pass on the faction section via image analysis (donut complete, list aligned, no issues). Test join records cleaned from localStorage afterwards.
- ESLint 0/0 (one react-hooks/immutability fix in donut.tsx: accumulate offsets without reassigning render-scope variables), `tsc --noEmit` clean, both build targets succeeded; /leaderboard and /profile prerendered static.

## Nav placeholder renamed 算盘 → 算力榜 — 2026-09-19

- One-line change in `app/page.tsx`: the disabled nav placeholder button now reads「算力榜」(still 灰字, `aria-disabled`, title 筹备中, no destination). No CSS or behavioral change — same `.nav-pending` class.
- README updated to describe the current nav. Older entries below keep the 算盘 wording as history.

## Nav 首页 entry + board create button removed — 2026-09-18

- The user asked for two changes: add a「首页」item to the top nav (only「算盘」felt too sparse), and remove the 发起活动 button at the top-right of the activity board.
- `app/page.tsx`: nav now has `<a className="nav-home" href="#top">首页</a>` before the disabled 算盘 placeholder. `app/activity-board.tsx`: the `.board-create` Link to `/create` was deleted; 发起活动 now appears only in the hero (and on /create itself). Dead CSS removed: `.board-create` base+hover rules in `app/board.css`; `app/board.css` `.board-head-actions` still holds the demo label alone. New `.site-header nav .nav-home{color:#fff}` in `app/globals.css`.
- Homepage HTML smoke test on the production build: 发起活动 count = 1 (hero only), `board-create` absent, `nav-home` + 算盘 present.
- Browser-verified at 1440 and 390: nav reads 首页 ｜ 算盘; clicking 首页 returns scroll to top (`scrollY` 0); board head shows only the demo label; no horizontal overflow at mobile width.
- ESLint 0/0, `tsc --noEmit` clean after a `VERCEL=1 npm run build` regenerated stale `.next/types`, both build targets succeeded.

## Header dedup: 算盘 placeholder, duplicate board entries removed — 2026-09-18

- The user pointed out two duplicate clusters on the homepage: the header carried 发起活动 twice (nav link + right pill, both to `/create`), and the activity board had four entry points (nav AI 活动, hero 探索活动, hero-bottom 了解更多, skip-link — three of them the same `#activities` anchor).
- Per the user's choices: the nav item 发起活动 became 算盘 — a disabled placeholder button (灰字, `aria-disabled`, title 筹备中) with no destination, dialog, or second-level page yet; the redundant `.header-create` pill was deleted; nav「AI 活动」was removed in favor of keeping the hero「探索活动」button; hero-bottom「了解更多」was removed as a third `#activities` duplicate.
- Header now reads: Logo ｜ 算盘（筹备中）｜ 中/EN · 登录. Homepage 发起活动 labels dropped from 5 to 2 (hero + board head); board entries are the skip-link and hero 探索活动.
- Dead CSS removed with the controls: `.header-create` (base/≤1400/≤760), `.scroll-explore` (all bands, keeping the `.hero-feature+ .hero-feature:before` half of the shared divider rule), and the now-unused `.nav-active` rule. `.hero-bottom` desktop grid lost the `auto` column that only existed for 了解更多; `.header-actions` base gap shrank 66→28px; new `.site-header nav .nav-pending` styles the placeholder. `.primary-action` CSS kept — create/detail pages still use it.
- Browser-verified on the production build at 1440 / 1024 / 768 / 390: nav contains exactly one disabled 算盘 button; clicking it changes nothing (path stays `/`, no dialog); 探索活动 still jumps to `#activities`; hero and board 发起活动 still href `/create`; 了解更多 absent; language + session controls intact; no horizontal overflow at any width. Homepage HTML shows 发起活动 ×2 and no `header-create` / nav AI 活动 / 了解更多 strings.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed, both build targets succeeded.
- Not touched in this pass (user deferred): hero-bottom 算力与数据/模型与开源 opening the same compute dialog, 真实需求 linking to `/create`, footer brand + arrow both targeting `#top`, the dead-end 中/EN dialog.

final result: passed

## Mobile hero background shows the full image — 2026-09-18

- The hero background was `center/cover` on every viewport. On phones that scaled the 1672×941 artwork up to fill an ~850 px-tall hero, so only a narrow vertical slice of it was visible. The ≤760 px rule now sets `background-size: contain` with `background-position: center`: the image shrinks to fit the hero width and the whole picture stays visible, uncropped. Desktop keeps `cover` unchanged.
- Verified from computed styles in the production build at 390×844 and 375×812: `background-size: contain`, painted image 375×211 / 360×203, both fully inside the hero box, original aspect ratio preserved. At 1440×900 the rule does not apply — still `cover`.
- A 16:9 image inside a tall phone hero necessarily leaves solid `#0b2748` bands above and below the artwork; that is the honest trade-off of not cropping. The bands match the image's deep-blue base.
- ESLint passed with zero errors or warnings, the Vercel build succeeded.

final result: passed

## Activity detail pages behind the board cards — 2026-09-18

- Clicking an activity card on the board now goes to `/activities/[slug]`, a second-level page for that activity. The three demo pages (`midautumn-poetry` / `shop-ai-assistant` / `city-memory-map`) are prerendered with `generateStaticParams`; activities created on this device resolve from localStorage after mount, so the same route serves both sources.
- The detail page reuses the `/create` secondary-page skeleton: back bar, hero with category/format/pricing/visibility tags, then sections for 活动介绍 / 评审维度 (weight bars) / 奖项 / 提交形式, plus a sticky sidebar with 关键信息 (time, venue, team, prize, fee, team policy, join policy, 活动代号) and a join panel. The 报名参加 button is disabled on purpose — registration does not exist yet — and the note under it says plainly whether the activity is fictional demo data or a local record that never left this browser.
- Unknown slugs get a dedicated not-found state that explains local activities only exist on the device that created them, with a link back to the board.
- Browser-verified on the production build: card click → `/activities/midautumn-poetry` with correct title, four sections, eight fact rows, criteria weights (40/30/30) and three awards; back link returns to `/#activities`; `/activities/no-such-activity` shows the not-found state; a planted localStorage activity rendered with the 本机创建 label, its venue/fee/prize, and appeared as a fourth card on the board (共 4 场) linking to its own page.
- Responsive: at 390 px the sidebar (facts + join) moves above the long sections (`order: -1`) and nothing overflows; at 1440 px the sidebar sits to the right of the main column. Verified numerically in the browser at both widths.
- The creation flow's success screen now links to `/activities/[slug]` of the activity just published, plus 回到活动看板. That href uses the same verified Link pattern as the board cards; the full six-step form was not re-walked end to end this time.
- ESLint passed with zero errors or warnings (`set-state-in-effect` on the detail page resolved the same way `scene.tsx` does — deferred via timeout callback), `tsc --noEmit` passed, and both build targets succeeded. The Vercel build lists the three demo detail routes as SSG.

final result: passed

## 关于我们 shortened to a sentence or two — 2026-09-18

- The homepage about section was too long. It now keeps only the eyebrow, the heading 关于我们, and two sentences: what 杭客松 connects (AI 创造者 / 真实需求 / 城市场景) and the question the platform keeps asking. The three principle cards, the three evaluating forces, the blockquote and the demo note were removed; `about.css` shrank to match.
- The `#about` anchor still works: the 共创社区 hero card sets `location.hash` to `#about`, and the old long copy no longer appears anywhere in the page text.
- Verified in the production build at 1440 px and 390 px: no horizontal overflow, section height 249 px on mobile with the 44/40 px padding from the ≤760 px media query.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed, and both build targets succeeded (Vercel `next build` and the Vinext/Cloudflare build).

final result: passed

## About section moves to the page — 2026-09-18

- 关于我们 left the navigation and became a section at the bottom of the homepage, so the nav is now AI 活动 / 发起活动 only. The content is drawn from `杭客松世界观与结构定义 1.0` rather than invented: the one-line definition of 杭客松, three principles (身份不是入口 / AI 不是产品，是人的新能力 / 比赛负责点火，不负责判决), the three evaluating forces (全民 / 行家 / 场景方), and the recurring core question.
- Dropping to two nav items broke the mobile header: the row used `justify-content: space-between`, which pushed the two links to opposite edges with a large gap between them. It now uses `flex-start` with a 34 px gap. Verified at 390 px.
- Layout re-checked at 1440 / 1024 / 768 / 390 px: no logo/nav/CTA/session overlap and no horizontal overflow at any width.
- The 共创社区 hero card previously opened a dialog; it now anchors to `#about`. Clicking it sets `location.hash` to `#about` and lands the section 36 px below the viewport top, inside the `scroll-padding-top: 36px` the page already sets.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed, and the Vercel build succeeded.

final result: passed

## Activity board replaces the activity list — 2026-09-18

- The homepage list became a filterable board: 类别 / 奖金 / 形式 / 费用 as filters and 最新发布 / 奖金最高 / 即将截止 as sorts. The header navigation lost 数算 and now reads AI 活动 / 发起活动 / 关于我们.
- The three demo activities were rewritten as full `Activity` records in `lib/demo-activities.ts`, identical in shape to user-created ones, so filtering, sorting and card rendering run one code path for both. The first is 中秋诗会 · 用 AI 写杭州 — 全民用 AI 创作与中秋、杭州相关的诗词歌赋.
- Filtering and sorting were exercised in the browser rather than assumed: 有奖金 → 2, 无奖金 → 1, 线下 → 1, 收费 → 1, 内容创作 → 1, 奖金最高 → ¥50,000 first, 即将截止 → earliest deadline first, 清除筛选 → back to 3 with the reset control disappearing.
- The board's filters need data to filter on, so the creation flow gained the matching fields: 活动类别 (radio, five options) on the basics step and 奖金总额 on the awards step. A created 社区共创 activity with ¥8,000 was verified end to end — stored correctly, appeared on the board, and was the only card returned by the 社区共创 filter.
- Responsive: 3 columns at 1440, 2 at 1050, 1 at 768 and 390, with no horizontal overflow at any of them.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed, and the Vercel build succeeded with `/` and `/create` static.

final result: passed

## The identifier field renamed again — 2026-09-18

- `活动地址` still read as "type a URL here", so the field is now `活动代号` with the help text 给这场活动起一个代号，站内用它来指代这场活动。 It is an in-platform identifier, not a destination.
- The preview card also stopped presenting it as a path: it rendered `/{slug}`, which is exactly what made the field look like a URL. It now shows the bare value under the `活动代号` row.
- The two access options that referenced it followed: 不公开 now reads 不在活动列表中展示，只有拿到代号的人能找到, and the restricted join policy reads 知道活动代号的人.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed, and the Vercel build succeeded.

final result: passed

## Activities stay on-platform — 2026-09-18

- The creation flow no longer asks for anything that points off-site. The `线上入口` url field was removed entirely (including the `url` field type and its validator), so an online activity is simply an activity run on 杭客松 rather than a redirect to a meeting link.
- The submission-type options were reworded for the same reason: `代码仓库` → `代码或文件`, `在线 Demo` → `交互 Demo`, `说明文档` → `项目说明`. The old labels implied a hosted external repository or site; the new ones describe what a participant submits inside the platform.
- Wording followed the change: the format step now states 活动在杭客松平台内进行，不需要跳转到其他网站, the submission step says participants submit on 杭客松 without filling in external links, `链接地址` became `活动地址`, and the unlisted/link-only options now say 持有活动地址的人.
- Legacy stored records are normalized on read instead of trusted. This was not theoretical: an activity created before the change was still in localStorage carrying the removed `onlineUrl` key, and `activityRow` mapped `activity.criteria` unguarded, so any older or partial record could have crashed the list. A planted record missing `criteria`, `awards` and `slug`, plus a non-activity object, now renders without error and the detail dialog falls back to `评审维度：未设置`.
- Re-verified end to end after the change: 线上 selected shows only 参与形式 and 参与费用 with zero `input[type="url"]` on the page, the new submission labels render, and the created record stores with no `onlineUrl` key.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed, and the Vercel build still reports `/` and `/create` static with the three API/auth routes dynamic.

final result: passed

## Activity creation flow — 2026-09-16

- `/create` is a six-step wizard modelled on Kaggle's Community Competition setup, with Kaggle's dataset/scoring/leaderboard sections replaced by the two axes this site needs: 线上/线下 and 免费/收费. The step list is declarative (`STEPS` in `lib/activity.ts`); the page only renders and validates it.
- The whole flow was walked end to end in the browser and every value landed in storage correctly: conditional fields swapped when 线下 → 线上 and 免费 → 收费, the date-order check blocked a deadline earlier than the start date, the criteria repeater added and removed rows while keeping a live weight total, and the weight check blocked advancing at 110% with `权重合计需要是 100%，当前是 110%`.
- A real defect surfaced during that walkthrough: slugifying a Chinese title left only `ai`, producing a useless URL. Auto-fill now only applies when the ASCII result is at least three characters; otherwise the field stays empty and the required-field validation asks for one, with the help text saying so.
- The form labels were also not associated with their inputs. `Label` now renders a real `<label for>` for text, textarea, date, number and url fields, verified by reading `input.labels[0]` for all five fields on step one.
- The created activity appears at the top of the homepage list with its `线上 · 收费` type line and `收费` tag, the section label switches to `含本机创建 · 未同步到服务器`, and its detail dialog shows the real host, dates, team size and online entry with a `本机创建` note instead of the demo-data note.
- Responsive: at 1240 px the preview column drops, at 900 px the step nav becomes a horizontal scroller, and `documentElement.scrollWidth` never exceeds the viewport at 1240, 900 or 390 px.
- Storage is `localStorage` under `hangkathon.activities.v1`; nothing is sent to a server and the UI says so on the list, in the dialog and on the success screen.
- ESLint passed with zero errors or warnings. The Vercel build reports `/` and `/create` static with the three API/auth routes dynamic.

final result: passed

## Sign-in failure modes made explicit — 2026-09-16

- A deployment with `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` but no `AUTH_SECRET` sent the visitor to Auth.js's bare "Server error / Check the server logs" page. Two defects behind that were fixed.
- The provider buttons were disabled only by the per-provider flag, so GitHub stayed clickable while the dialog simultaneously said login was not configured. They are now disabled unless the whole configuration is ready.
- `/api/session` reports `secret` separately from the provider flags, and the dialog names the missing piece instead of a generic sentence. Verified against a local server started with GitHub credentials and no `AUTH_SECRET`: both buttons disabled, and the note reads `登录尚未启用：部署环境还缺少 AUTH_SECRET（会话签名密钥）。`
- Auth.js now routes failures to `/auth-error`, which states the error code in Chinese and lists which credentials the running deployment is missing. Verified at `/auth-error?error=Configuration` with no `AUTH_SECRET`: `当前部署缺少 AUTH_SECRET。在部署环境补上并重新部署后即可登录。`
- With `AUTH_SECRET` plus GitHub credentials, `/api/session` reports `configured: true` and the dialog enables GitHub while leaving Google disabled and marked `未配置`. Partial configuration is usable, which is the intended behaviour.
- ESLint passed with zero errors or warnings. The Vercel build reports `/` static plus `/api/auth/[...nextauth]`, `/api/session` and `/auth-error` dynamic; `tsc --noEmit` passed against the fresh build.

final result: passed

## GitHub and Google sign-in entry — 2026-09-16

- The header now carries a sign-in entry at the far right of `.header-actions`, after the language control. Signed out it reads `登录` with a user icon; signed in it shows an initials avatar and the account name. It opens a dialog matching the existing panel style, listing GitHub and Google.
- Auth is Auth.js v5 (`next-auth@5.0.0-beta.32`) with JWT sessions, so no database is needed. `app/api/auth/[...nextauth]/route.ts` serves the OAuth flow and `GET /api/session` reports whether OAuth is configured, which providers are usable, and who is signed in. The home page stays statically prerendered; only the two API routes are dynamic.
- Credentials are read from the environment and each provider joins the config only when both its id and secret are present. With no environment set, the dialog disables both buttons, marks them `未配置`, and explains that `AUTH_SECRET` plus provider credentials are required — verified against the local dev server, which has no credentials.
- With placeholder credentials the GitHub flow was followed into a real redirect: `https://github.com/login?...` carrying `client_id`, `code_challenge` with `code_challenge_method=S256`, `redirect_uri=http://localhost:4301/api/auth/callback/github` and `scope=read:user user:email`. GitHub then showed its own sign-in page, which is the expected end state for a client id that does not exist.
- Google could not be followed the same way in this environment: Auth.js performs OIDC discovery against `accounts.google.com`, and this sandbox blocks outbound requests from local processes to that host (`curl` to both `accounts.google.com` and `google.com` returns no response). The provider is registered and `/api/auth/providers` reports the correct callback URL, but the authorize redirect was not observed and is not claimed as verified.
- Layout checked at 1440, 1024, 768 and 390 px: no logo/navigation/action overlap and no horizontal overflow. The entry shows its text label at 1440 and 390, and collapses to a 36 px circular icon button at 1024 and 768 where the header runs out of room.
- ESLint passed with zero errors or warnings, and both build targets completed: the Vercel `next build` reports `/` as static with the two API routes dynamic, and the Vinext build still emits `dist/server/wrangler.json`.

final result: passed

## Hackathon vocabulary retired — 2026-09-16

- 黑客松 is no longer a concept in this project; 杭客松 replaces it everywhere. Demo activity 01 became `AI 创造者杭客松` with the type label `AI HANGKATHON`, and the QA log below no longer quotes the retired word when describing the removed sculpture caption.
- A repository-wide search for 黑客松 / HACKATHON / Hackathon across source, docs and config now returns nothing. The two PNGs under `docs/` were captured before this pass and still show the old sculpture caption in their pixels; they are left in place because `design-qa.md` cites them as historical evidence.
- ESLint passed with zero errors or warnings, `tsc --noEmit` passed against a freshly generated `.next`, and both build targets (Vercel `next build` and the local Vinext build) completed successfully.

final result: passed

## Top navigation relabelled — 2026-09-16

- The three header navigation items are now `AI 活动`, `广场` and `数算`, replacing `活动`, `作品` and `关于我们`.
- Because 广场 and 数算 are new section names, the dialogs behind them were rewritten to match rather than left describing the old labels: the works panel became the `PLAZA` panel, and a new `DATA & COMPUTE` panel was added for 数算. The 算力与数据 hero feature now opens 数算 instead of the about panel, so the card and the navigation agree.
- `关于我们` no longer has a navigation entry. The `ABOUT HANGKESONG` panel is still reachable from the 模型与开源 and 共创社区 hero features.
- Browser verification: the header renders all three labels with the active underline on `AI 活动` at 1440, 1024, 768 and 390 px. No logo/navigation/CTA overlap and no horizontal overflow at any of those widths. Clicking 广场 and 数算 opened the rewritten panels, and Escape closed them.
- ESLint passed with zero errors or warnings. `npx tsc --noEmit` initially reported `AppRoutes`/`LayoutRoutes`/`ParamMap` missing from `.next/types/routes.js`; that was a stale generated artifact from an earlier build, and a fresh `next build` followed by the same `tsc` invocation passed cleanly. It was not a source error.

final result: passed

## Hero copy and scene control removal — 2026-09-16

- Removed the four hero overlays the user flagged: the `AI 创造者共创平台 · 杭州` eyebrow, the `连接算力、开源模型与真实场景。` subtitle, the right-hand `更多的人 / 更好的 AI / 更真实的世界` sculpture caption with its English city-and-event line, and the `轻触水面，泛起涟漪` scene toolbar together with its pause and calm-water buttons.
- The 22 CSS rules that existed only for those elements were deleted from `app/globals.css` (hero eyebrow/subtitle, sculpture-label and its children, scene-toolbar/drag-hint/scene-buttons/scene-control/reset-control, plus their tablet and mobile overrides and the trailing pointer-events patch). `.eyebrow` itself stays: the dialog and the activities section still use it.
- `BridgeScene` no longer takes props. `paused`/`onPause`/`reset`/`onState` existed to drive the removed buttons, and `onState` had no remaining consumer, so the component now owns its own pause state. The `prefers-reduced-motion` self-pause is unchanged apart from no longer reporting upward; it was code-inspected rather than re-run in a browser with the media feature forced.
- Water interaction still works after the rewiring: six pointer moves across the water produced six ripple events (`canvas.dataset.ripples` 0 → 6), the scene reported `ready` with 16,206 triangles, and no `.scene-message` error appeared.
- ESLint passed with zero errors or warnings. TypeScript passed with `--noEmit --incremental false`.
- Desktop 1440 × 900 and mobile 390 × 844 both re-checked: the headline and the two actions are the only hero copy left, the Three.js bridge still renders, and mobile shows no horizontal overflow (`scrollWidth` 375 against a 390 viewport).

final result: passed

## Brand artwork swap and activity vocabulary pass — 2026-09-16

- The header wordmark was replaced with the newly supplied silver "杭客松 / Hangkathon" artwork. The source PNG was already alpha-keyed but carried faint cut-out speckles and colour fringing from the original white plate, so the derivative pipeline zeroed sub-22 alpha, pulled low-alpha chroma toward luminance, and resized through premultiplied alpha. `public/brand/hangkathon-logo.png` is 1400 × 468, ratio 2.991.
- The square mark, `favicon.ico` (16/32/48/64/128/256), `apple-touch-icon.png`, and `icon-192/512.png` were regenerated from the same artwork. The mark keeps the complete base lens: the 杭客松 / Hangkathon lockup and the `g` descender were masked out rather than cropped, so no flat cut edge appears on the lens.
- `.wordmark` is now height-driven (`height: 68px` desktop / `60px` tablet / `50px` mobile, image `height: 100%; width: auto`). The previous fixed 210 × 68 box rendered the old 2.43-ratio artwork correctly but stretched this 2.99-ratio artwork horizontally by 3.2%. Measured render is now 203 × 68, ratio 2.991 against a natural 2.991.
- Hero headline changed from "在杭州，把 AI 想法做出来。" to "世界 AI 上杭州" (single line, `AI` retaining the cyan emphasis). Rendered 476 × 79 at 1440 px and 334 × 44 at 390 px; `layout.tsx` metadata title, footer tagline, and README were updated to match.
- Activity vocabulary unified: the separate 活动 / 挑战 entries are gone. Navigation is 活动 / 作品 / 关于我们; the header call to action and the hero secondary action are both 发起活动; the dialog panel key, its label (`CHALLENGES` → `ACTIVITIES`), and its copy were rewritten. Demo activity 02 was renamed from "真实需求挑战" to "真实需求共创" with its type relabelled `REAL-WORLD CHALLENGE` → `REAL-WORLD ACTIVITY`, and the hero feature "真实赛题" became "真实需求" so no third synonym survives. The internal CSS class `header-challenge` was renamed `header-create`.
- ESLint passed with zero errors or warnings. TypeScript passed with `--noEmit --incremental false`. The production build completed successfully with its pre-existing Vinext advisories (client chunk over 500 kB, route classification unknown).
- Browser verification on the local dev server: desktop 1440 × 900, tablet 768 × 900 and 1024 × 900, mobile 390 × 844. The logo is transparent with no plate or rectangle, the headline fits on one line, `documentElement.scrollWidth` never exceeds the viewport, and logo/navigation/CTA boxes do not overlap at any checked width. The 发起活动 header button opened the rewritten `ACTIVITIES` dialog, and Escape closed it with `body` overflow returning to `visible`.

final result: passed

## Migration and brand refresh verification — 2026-09-16

- The handed-off source was migrated into the `Qbuby/hangkathon` repository without generated dependencies, build output, environment files, or local Wrangler/Vinext state.
- The header now uses the user-supplied `public/brand/hangkathon-logo.png` as a standalone transparent asset instead of cropping the full scene reference. `hangzhou-upgrade-reference.png` and `hangzhou-upgrade-background.png` remain unchanged for Three.js bridge and background rendering.
- Brand derivatives include the retained source artwork, a navigation logo, square mark, multi-size favicon, Apple Touch Icon, and 192/512 px icons.
- ESLint passed with zero errors or warnings. TypeScript passed with `--noEmit --incremental false`. The production build completed successfully; Vinext emitted its existing advisory that a client chunk exceeds 500 kB and that some route classification remains unknown.
- Desktop 1440 × 900, tablet 768 × 900, and mobile 390 × 844 visual checks passed: the new logo is transparent and legible, the Three.js bridge is visible, and no logo/navigation overlap or horizontal overflow was observed.
- The semantic browser snapshot confirmed the WebGL canvas reached its ready state and exposed pause/reset controls, all three demo activity buttons, and explicit demo-data labeling. In-app automation could not click the responsive page controls within its short timeout budget, so this migration did not independently re-run the historical dialog/Escape and pause/reset interaction assertions below.

final result: passed

## Evidence and state

- Source visual truth: `public/assets/hangzhou-upgrade-reference.png`.
- Final desktop: `docs/hangkesong-upgrade-desktop-final.png`.
- Final mobile: `docs/hangkesong-upgrade-mobile.png`.
- Source 1672 × 941 pixels; desktop CSS viewport 1672 × 941, DPR 1, screenshot same dimensions. Mobile viewport and screenshot 390 × 844, DPR 1.
- Route `/`, top state, Chinese, no dialog, calm water; scrollY explicitly verified as 0 for both final captures.
- Reference and final desktop/mobile images opened together in the same comparison input. Earlier scrolled captures were rejected and replaced.
- Full-resolution title, logo, CTA, bridge edges, lanterns, and bottom feature row were legible in this comparison, so separate zoom crops were not necessary.

## Findings and comparison history

1. Initial desktop comparison: [P2] logo background rectangle; [P2] title/CTA roughly 30px too low; [P2] reconstructed sky too blue. Fixed header blending, headline inline metrics/margins, navigation alignment, and clean-plate color correction. Post-fix desktop evidence is the final screenshot above; no logo rectangle or obsolete CTA survives.
2. Initial mobile check: [P1] original bridge fragment revealed by the desktop arch-hole restoration mask behind the scaled mobile bridge. Fixed by disabling that restoration on mobile. Final mobile shows one complete fixed bridge.
3. Water hit-area check: [P2] transparent toolbar gap intercepted pointer events. Fixed toolbar pointer behavior while keeping its controls interactive; mobile water click then produced 3 ripple events. Added text shadow to mobile feature copy over the sun reflection.
4. Final comparison: no actionable P0/P1/P2 findings within the requested homepage Demo scope. Remaining minor differences are listed below.

## Required fidelity surfaces

- Typography: editable two-line Chinese heading, blue AI emphasis, matching hierarchy and approximate weights; PingFang SC/system fallback. Navigation, CTA and subtitle sizes and vertical rhythm reviewed against reference. Exact raster font glyphs are not asserted.
- Layout: full-bleed desktop scene, headline left, bridge across center, scene copy right, features at bottom. Mobile uses a two-row header and two-column features; no horizontal overflow at 390px. Buttons remain above the canvas.
- Colors: blue/gold palette from the supplied artwork; original reference material retained on bridge; reconstructed areas corrected toward original palette. DOM controls use coordinated white/cyan/navy tokens.
- Images: supplied logo and bridge material are real source assets. Background plate removes original UI and bridge. Bridge is a closed, indexed Three.js mesh with depth, not a flat screenshot substituted for geometry. Four bridge annotations use source-textured transparent patches. Water displacement runs in a real-time shader. Distant city, mountains and lanterns are image scenery.
- Copy: main title/subtitle follow new reference. The unsupported “第一城” superlative was replaced with neutral “AI 创造者共创平台 · 杭州”; no partners, prizes, attendance or historical events are invented. Three activities remain explicitly demo data. English, challenge submission and works remain clearly explained placeholders.

## Functional verification

- Desktop WebGL scene ready, 16,206 triangles; mobile first load ready, 6,982 triangles, 30fps/DPR1.25 quality cap.
- Pointer movement on desktop water produced ripples while bridge rotation remained fixed. Pause held the render frame at 61 across separate observations; continue and clear-water controls work.
- Mobile water click produced ripples; viewport documentWidth equals 390 with no horizontal overflow. Real-device touch was not separately tested; shared pointer handler supports touch and preserves vertical scrolling.
- Explore Activities scrolls to the section. Challenge and demo activity dialogs open; close button and Escape work. English control opens its explicit unavailable-state explanation.
- Browser error log was empty on final desktop and mobile checks.
- TypeScript and production build passed.

## Follow-up polish / limits

- [P3] Inpainted cloud shapes, very fine bridge-edge alignment, and font rendering retain small differences from the raster reference; this is not a claim of literal pixel identity.
- [P3] Library icons closely match source motifs; their individual stroke paths are not identical.
- Scenery/reflections use supplied photography-style artwork; the water is a shader effect rather than full fluid simulation.
- Existing site access was discovered as public (revision 2) before this edit. This upgrade preserves that audience; no access mutation is performed.

## Implementation checklist

- [x] New artwork and logo integrated
- [x] Fixed real Three.js bridge
- [x] Water hover/click ripples and pause/reset
- [x] Desktop/mobile browser checks
- [x] Source-versus-render comparison and correction loop
- [x] Demo/placeholder labeling
- [x] Type and production-build checks
