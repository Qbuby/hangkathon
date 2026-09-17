# 杭客松首页升级 — Design QA

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
