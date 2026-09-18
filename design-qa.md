# 杭客松首页升级 — Design QA

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
