# 杭客松小程序设计规范（5 页共用）

- 版本：1.0
- 日期：2026-10-23
- 适用页面：`activities` / `activity-detail` / `leaderboard` / `profile` / `create`
- 基线 manifest：`/d/program/hangkathon/.workflow-artifacts/baseline/manifest.json`
- 基线截图：同目录，每页只取第 0、1 张，共 10 张

## 0. 证据口径（先读这一节）

本规范的尺寸、颜色、字号全部来自 baseline 的 **computed styles**（`manifest.entries[].styles`），没有重新抓页面，也没有联网。

已读的 10 张截图（每页仅 0、1 两张）：

| 页面 | 截图 |
| --- | --- |
| activities | `activities-0.png`、`activities-1.png` |
| activity-detail | `activities-guoqing-77-0.png`、`activities-guoqing-77-1.png` |
| leaderboard | `leaderboard-0.png`、`leaderboard-1.png` |
| profile | `profile-0.png`、`profile-1.png` |
| create | `create-0.png`、`create-1.png` |

测量方式与结果：

- 10 张 PNG 均为 **780 × 1688**（PIL 读取结果），对应 **390 × 844 CSS px @2x**。
- manifest 中 `HTML` / `BODY` 的 `width` 均为 `390px`（`manifest.json:28`、`manifest.json:46`），确认设计视口是 390px，不是 375px。
- manifest 每条 style 的字段只有：`tagName / className / color / backgroundColor / fontSize / fontWeight / lineHeight / letterSpacing / padding / margin / borderRadius / boxShadow / display / position / width / height`。
- **manifest 没有 `border` 字段**：所有边框颜色取自仓库 CSS（`app/globals.css`、`app/board.css` 等），文中会逐条标注。
- **渐变不会写进 `backgroundColor`**（记录为 `rgba(0,0,0,0)`）：渐变起止色取自仓库 CSS，文中会逐条标注。
- 页面条目在 manifest 中的行号范围：activities `4–7214`、activity-detail `7215–9421`、leaderboard `9422–11844`、profile `11845–12305`、create `12306–12768`。

> 一句话结论：基线是「390px 宽的白底浅蓝体系 + 深墨蓝正文 + 单一亮蓝主色 + 金色奖励点缀」，5 页共用同一套顶栏（profile 例外，用二级页顶栏）、同一套 6%/24px 间距、同一套 12/16/20/40px 圆角档位。

---

## 1. 换算约定（390px → rpx）

### 1.1 倍数

微信小程序规定 **750rpx = 屏幕宽度**。基线设计宽度是 **390px**，所以：

```
1 CSS px = 750 / 390 rpx = 1.923076923… rpx = 25/13 rpx
rpx = px × 750 ÷ 390
```

- **不要用 ×2。** ×2 是「750/375」的算法，用在 390 宽基线上会整体放大约 4%。
- 仓库现有注释 `miniprogram/pages/activities/activities.wxss:235` 写的「rpx = px×2」是按 375 宽算的，本规范明确废止该算法。
- 百分比与 rpx 在 390 宽下可互换：`6% × 750 = 45rpx`，所以 6% 边距统一落成 `45rpx`。
- 页面全宽：`390px → 750rpx`。
- 内容宽（左右各 6%）：`343.219px → 660rpx`。
- 看板内宽（6% 外层 + 20.578px 内层）：`302.062px → 581rpx`。

### 1.2 取整规则

1. 先按 `px × 750 / 390` 算出精确值。
2. **四舍五入到整数 rpx（half-up）**，不保留小数。
3. 小于 `0.5rpx` 的值：如果是可见的字距/描边，抬到 `1rpx`；如果是纯装饰可省略的，落成 `0`。
4. 行高优先写**无单位倍数**（`line-height: 1.5` 等），和网页完全一致；需要写死 rpx 时按同一公式取整。
5. 组件内部用 `box-sizing: border-box`，避免「宽度 + padding + border」被 rpx 取整放大。

常用换算（可直接抄）：

| 网页值 | 精确 rpx | 落库 rpx |
| --- | --- | --- |
| 1px | 1.923 | **1（hairline 例外，见 1.3）** |
| 2px | 3.846 | 4 |
| 6px | 11.538 | 12 |
| 9px | 17.308 | 17 |
| 12px | 23.077 | 23 |
| 14px | 26.923 | 27 |
| 16px | 30.769 | 31 |
| 18px | 34.615 | 35 |
| 19.5px | 37.500 | 38 |
| 20px | 38.462 | 38 |
| 24px | 46.154 | 46 |
| 26px | 50.000 | 50 |
| 30px | 57.692 | 58 |
| 34px | 65.385 | 65 |
| 40px | 76.923 | 77 |
| 42px | 80.769 | 81 |
| 45.5px | 87.500 | 88 |
| 48px | 92.308 | 92 |
| 50px | 96.154 | 96 |
| 56px | 107.692 | 108 |
| 64px | 123.077 | 123 |
| 116px | 223.077 | 223 |
| 132px | 253.846 | 254 |
| 140px | 269.231 | 269 |
| 172px | 330.769 | 331 |
| 343.219px | 660.037 | 660 |
| 390px | 750.000 | 750 |

### 1.3 1px 边框怎么处理

**结论：网页所有 `1px solid` 边框，在小程序里一律写 `1rpx solid`，不要写 `2rpx`。**

原因：

- `1rpx` 在 2x 屏上约等于 1 个物理像素，正好是「发丝线」的视觉意图；`2rpx` 会变成约 2 个物理像素，边框明显变粗。
- 小程序对 `0.5px` 支持不稳定，禁止使用 `0.5px` / `transform: scaleY(.5)` 之类的假发丝线。
- 网页的 1px 边框在 390 宽下名义上是 1.923rpx；但边框属于「视觉发丝」而非「等比布局」，所以**边框和分隔线走 1rpx 例外**，其余尺寸仍按 1.923 倍换算。

具体写法：

```css
/* 卡片描边 */
border: 1rpx solid #DCE7F2;

/* 分隔线 */
height: 1rpx;
background: #E3EDF6;

/* 顶栏底线：1rpx 实线 + 1rpx 高光阴影 */
border-bottom: 1rpx solid #E3EDF6;
box-shadow: 0 1rpx 0 #F2F7FC;

/* 输入框聚焦环（网页 3px） */
box-shadow: 0 0 0 6rpx rgba(27, 156, 252, 0.12);

/* 选中 chip 的 1px 主色边 */
border: 1rpx solid #1B9CFC;
```

如果确实需要「更粗的分隔」（网页 2px 以上）：2px → `4rpx`，3px → `6rpx`，按 1.923 倍正常取整。

### 1.4 行高倍数对照

基线里所有行高都能还原成固定倍数，建议直接写倍数：

| 场景 | 网页字号/行高 | 倍数 |
| --- | --- | --- |
| 正文 | 14 / 21 | 1.5 |
| 长段落 | 13.5 / 23.625 | 1.75 |
| 详情长文 | 14.5 / 29.725 | 2.05 |
| 标题 H1 | 24 / 36 | 1.5 |
| 详情 H1 | 24 / 34.8 | 1.45 |
| 小标题 H2 | 20 / 30 | 1.5 |
| 详情 H2 | 18 / 27 | 1.5 |
| 卡片标题 | 15.5 / 23.25 | 1.5 |
| eyebrow | 11 / 17.6 | 1.6 |
| eyebrow 蓝 | 10 / 15 | 1.5 |
| 元信息 | 12.5 / 18.75 | 1.5 |
| 顶栏导航 | 13 / 19.5 | 1.5 |
| 按钮 | 14 / 20 | 1.43（落 38rpx） |

---

## 2. 设计令牌表

### 2.1 颜色

「网页值 → 小程序值」；颜色没有 rpx 换算，单位为色值。

| 令牌 | 网页值 | 小程序值 | 用途 | 证据 |
| --- | --- | --- | --- | --- |
| 主色 `primary` | `#1b9cfc` / `rgb(27,156,252)` | `#1B9CFC` | 选中描边、图标、主色强调 | `manifest.json:5758`（eyebrow 色）、`manifest.json:12588`（gate 图标色）；`app/globals.css:4` |
| 主色深 `primary-dark` | `rgb(11,111,168)` | `#0B6FA8` | 链接文字、选中 chip 文字、CTA 文字 | `manifest.json:430`、`manifest.json:1042`、`manifest.json:10082` |
| 主色浅底 `primary-soft` | `rgb(227,244,255)` | `#E3F4FF` | 选中 chip 底、头像底 | `manifest.json:431`、`manifest.json:539`、`manifest.json:10083` |
| 深色底 `dark` | `#0b2748` | `#0B2748` | 深色首屏/深色页脚底（本 5 页正文区不用） | `app/globals.css:40`、`miniprogram/app.json:13`；**manifest 的 10 张截图与 styles 中 0 次出现，故标注为仓库来源** |
| 正文 `ink` | `rgb(23,39,58)` | `#17273A` | 标题、正文主色 | `manifest.json:34`、`manifest.json:358` |
| 正文次级 `body` | `rgb(66,86,107)` | `#42566B` | 详情正文、事实表 dd | `manifest.json:5290`、`manifest.json:7659` |
| 次要文字 `muted` | `rgb(124,147,168)` | `#7C93A8` | 副文案、日期、说明 | `manifest.json:376`、`manifest.json:844` |
| 三级文字 `muted-2` | `rgb(143,166,187)` | `#8FA6BB` | 标签、表头、字段名 | `manifest.json:5254`、`manifest.json:8775` |
| 元信息 `muted-3` | `rgb(159,178,196)` | `#9FB2C4` | 场次、页脚、很浅的辅助字 | `manifest.json:682`、`manifest.json:1024` |
| 边框 `border` | `#dce7f2` | `#DCE7F2` | 卡片/按钮/chip 描边 | **manifest 无 border 字段**；`app/globals.css:4`、`app/board.css:23`、`app/leaderboard/leaderboard.css:7` |
| 分隔线 `divider` | `#e3edf6` | `#E3EDF6` | 区块分隔、步骤卡描边、进度条底 | `app/globals.css:10`（header 底线）、`app/activities/[slug]/detail.css:217`；截图 `activities-0.png` 顶栏下缘采样 `rgb(227,237,246)` |
| 卡片底 `card` | `#ffffff` | `#FFFFFF` | 卡片、输入框、按钮底 | `manifest.json:35`、`manifest.json:9795` |
| 浅面板 `panel` | `rgb(248,251,254)` | `#F8FBFE` | 筛选面板、步骤卡、规则框 | `manifest.json:5237`、`manifest.json:7750` |
| 金色 `gold` | `rgb(201,149,42)` | `#C9952A` | 奖金、奖励、荣誉数字 | `manifest.json:970`、`manifest.json:8073` |
| 金色浅底 `gold-soft` | `#fdf8ec` | `#FDF8EC` | 金色标签底、邀请框底 | `app/activities/[slug]/detail.css:94`（manifest 未采集） |
| 危险 `danger` | `#e5484d` | `#E5484D` | 表单错误、危险操作 | `app/globals.css:4`（`--destructive`）、`app/create/create.css:33`；**manifest 中 0 次出现** |
| 页面底渐变 | `linear-gradient(180deg,#ffffff 0%,#f4f9fe 45%,#eef5fc 100%)` | 同值 | 详情/排行/个人/发起页底色 | `app/activities/[slug]/detail.css:3`、`app/create/create.css:3`；截图底部采样 `#F4F9FE` |
| 顶栏底 | `rgba(255,255,255,0.9)` + `blur(12px)` | `rgba(255,255,255,0.94)` + 可选 `blur(23rpx)` | 固定顶栏 | `manifest.json:71`；`app/globals.css:10`、`app/globals.css:54` |
| 主按钮渐变 | `linear-gradient(92deg,#3ec2f7,#1b9cfc)` | 同值 | 发起活动/登录/返回首页 | `app/globals.css:40`（`.primary-action`）；manifest 的 `backgroundColor` 为透明，渐变不写入该字段 |

补充：

- `#0B2748` 是仓库里深色首屏的底色，也是当前小程序 `navigationBarBackgroundColor`；本规范的新顶栏是白底，所以这个深色只保留给深色内容区块，**不要拿它做新顶栏背景**。
- 截图里详情页的大海报是内容图片（黑底橙门），不是 UI 深色底令牌。

### 2.2 字号 / 字重 / 字距 / 行高

格式：`网页 字号/字重/行高/字距 → 小程序 字号/字重/行高/字距`。字距在 1rpx 以下的按 1.3 节抬到 1rpx。

| 角色 | 网页值 | 小程序 rpx 值 | 用途 | 证据 |
| --- | --- | --- | --- | --- |
| 正文 `body` | 14px / 400 / 21px / 0 | **27rpx / 400 / 40rpx（1.5）/ 0** | 页面副文案、普通段落 | `manifest.json:374–389`（board-sub） |
| 正文长段落 | 13.5px / 400 / 23.625px / 0 | **26rpx / 400 / 45rpx（1.75）/ 0** | 活动简介、详情说明 | `manifest.json:913–930`（feed-intro） |
| 详情长文 | 14.5px / 400 / 29.725px / 0 | **28rpx / 400 / 57rpx（2.05）/ 0** | 「你要做什么」正文 | `manifest.json:7656–7673`（detail-text） |
| 标题 H1 | 24px / 600 / 36px / 1px | **46rpx / 600 / 69rpx（1.5）/ 2rpx** | 本地赛事、排行榜、个人主页 | `manifest.json:356–363`、`manifest.json:12016–12033` |
| 标题 H1·hero | 26px / 600 / 39px / 1px | **50rpx / 600 / 75rpx（1.5）/ 2rpx** | 排行榜/发起页大标题 | `manifest.json:9719–9736` |
| 标题 H1·detail | 24px / 600 / 34.8px / 1px | **46rpx / 600 / 67rpx（1.45）/ 2rpx** | 活动详情标题 | `manifest.json:7494–7511` |
| 小标题 H2 | 20px / 600 / 30px / 1px | **38rpx / 600 / 58rpx（1.5）/ 2rpx** | 分区标题（我的荣誉/各区统计等） | `manifest.json:10043–10060` |
| 小标题 H2·detail | 18px / 600 / 27px / 1px | **35rpx / 600 / 52rpx（1.5）/ 2rpx** | 详情页分区标题 | `manifest.json:8233–8240` |
| 卡片标题 | 15.5px / 650 / 23.25px / 0.3px | **30rpx / 650 / 45rpx（1.5）/ 1rpx** | 活动流条目标题 | `manifest.json:823–840` |
| Eyebrow | 11px / 400 / 17.6px / 2.7px | **21rpx / 400 / 34rpx（1.6）/ 5rpx** | LOCAL EVENTS / LEADERBOARD / HONOR | `manifest.json:338–345`、`manifest.json:9701–9718` |
| Eyebrow·蓝 | 10px / 400 / 15px / 2px | **19rpx / 400 / 29rpx（1.5）/ 4rpx** | DETAIL 区块小标 | `manifest.json:7620–7637` |
| 元信息 | 12.5px / 400 / 18.75px / 0 | **24rpx / 400 / 36rpx（1.5）/ 0** | 主办方、奖金、场次 | `manifest.json:967–984` |
| 辅助标签 | 12px / 400 / 18px / 1px | **23rpx / 400 / 35rpx（1.5）/ 2rpx** | 筛选组标签、统计卡说明 | `manifest.json:9827–9844` |
| 顶栏导航 | 13px / 400 / 19.5px / 1px | **25rpx / 400 / 38rpx（1.5）/ 2rpx** | 首页/活动/排行榜 | `manifest.json:103–120` |
| 按钮 | 14px / 600 / 20px / 1px | **27rpx / 600 / 38rpx（1.43）/ 2rpx** | CTA 药丸按钮 | `manifest.json:572–587` |
| 日期块·月 | 9.5px / 400 / 14.25px / 1px | **18rpx / 400 / 27rpx（1.5）/ 2rpx** | 10月 | `manifest.json:1201–1218` |
| 日期块·日 | 17px / 650 / 17px / 0 | **33rpx / 650 / 33rpx（1.0）/ 0** | 1 / 20 | `manifest.json:1221–1239` |

说明：

- 文档根字号 16px/400/24px（`manifest.json:34`、`manifest.json:36`）只是浏览器继承值，**不要把它当正文令牌**；实际正文落在 13.5–14.5px。
- 650 字重是网页可变字体的取值；小程序字体不一定有 650，落库可写 `font-weight: 600`，但**字距和字号必须保持本表值**。

### 2.3 圆角档位

| 档位 | 网页值 | 小程序值 | 用途 | 证据 |
| --- | --- | --- | --- | --- |
| xs | 6px | **12rpx** | 顶部状态小 chip | `manifest.json:11962–11979` |
| sm | 9px | **17rpx** | 日期方块、日期输入 | `manifest.json:1183–1200`、`manifest.json:5611–5628` |
| md | 12px | **23rpx** | 活动流条目、步骤卡、区统计行、登录按钮 | `manifest.json:715–732`、`manifest.json:10241–10258`、`manifest.json:12070–12087` |
| lg | 14px | **27rpx** | 我的荣誉卡、海报 | `manifest.json:10061–10078`；`app/activities/[slug]/detail.css:22` |
| xl | 16px | **31rpx** | 统计卡、事实卡、报名卡、筛选面板 | `manifest.json:9791–9808`、`manifest.json:8754–8771`、`manifest.json:5233–5250` |
| 2xl | 20px | **38rpx** | 发起页门禁卡、chip | `manifest.json:12567–12584`、`manifest.json:5720–5735` |
| pill | 40px | **77rpx** | 主 CTA 药丸 | `manifest.json:572–587`、`manifest.json:12106–12123` |
| circle | 50% | **50%** | 头像、日期圆点、步骤序号 | `manifest.json:10079–10096`、`manifest.json:536–551` |

### 2.4 阴影档位

| 档位 | 网页值 | 小程序值 | 用途 | 证据 |
| --- | --- | --- | --- | --- |
| hairline | `0 1px 0 #f2f7fc` | **`0 1rpx 0 #F2F7FC`**（发丝例外） | 顶栏第二层高光 | `manifest.json:79` |
| s | `0 1px 4px rgba(23,58,102,.05)` | **`0 2rpx 8rpx rgba(23,58,102,.05)`** | 登录按钮 | `manifest.json:12082` |
| m | `0 2px 10px rgba(23,58,102,.05)` | **`0 4rpx 19rpx rgba(23,58,102,.05)`** | 统计卡、事实卡、报名卡 | `manifest.json:9803`、`manifest.json:8766`、`manifest.json:9288` |
| active | `0 1px 6px rgba(27,156,252,.12)` | **`0 2rpx 12rpx rgba(27,156,252,.12)`** | 选中 chip | `manifest.json:5281` |
| cta | `0 4px 16px rgba(27,156,252,.2)` | **`0 8rpx 31rpx rgba(27,156,252,.2)`** | 主 CTA 发光 | `manifest.json:583` |
| gate | `0 18px 50px rgba(18,54,92,.07)` | **`0 35rpx 96rpx rgba(18,54,92,.07)`** | 发起页门禁卡 | `manifest.json:12579` |
| poster | `0 10px 34px rgba(12,42,80,.16)` | **`0 19rpx 65rpx rgba(12,42,80,.16)`** | 详情海报 | `app/activities/[slug]/detail.css:22`（manifest 未采集 img） |

### 2.5 间距 / 骨架尺寸

| 令牌 | 网页值 | 小程序值 | 说明 |
| --- | --- | --- | --- |
| 页边距 | 6% = 23.3906px | **45rpx** | 5 页统一左右留白 |
| 卡片内边距 | 24px | **46rpx** | 事实卡、报名卡、一般白卡 |
| 卡片间距 | 14px | **27rpx** | 统计卡、事实表行 |
| 区块内边距 | 28px | **54rpx** | leaderboard 的 `lb-section` 上边距 |
| 顶栏总高 | 116px | **223rpx**（不含状态栏） | 4 个使用全站顶栏的页面 |
| 顶栏第一行 | 50px | **96rpx** | logo 行 |
| 顶栏第二行 | 45.5px | **88rpx** | 导航行 |
| 内容宽 | 343.219px | **660rpx** | 6% 单层内容 |
| 看板内宽 | 302.062px | **581rpx** | activities 的 board/筛选面板 |
| 主按钮高 | 42px | **81rpx** | CTA 药丸 |
| 登录按钮高 | 56px | **108rpx** | provider-button |
| 顶部让位 | activities 132px / detail 172px / leaderboard 116px / create 116px / profile 64px | **254rpx / 331rpx / 223rpx / 223rpx / 123rpx** | 见 4.4 |

---

## 3. 五个页面结构清单

以下「从上到下」按基线截图（0、1 两张）排列；尺寸同时给 px 与 rpx。

### 3.1 activities（活动看板）

依据：`activities-0.png`、`activities-1.png`；`manifest.json:5–7214`。

1. **固定全站顶栏**：高 116px → **223rpx**（不含状态栏）；两行结构（见第 4 节）。
2. **内容包裹层**：`padding: 132px 6% 80px` → **254rpx 45rpx 154rpx**（`manifest.json:265–281`）。132px 里含 116px 顶栏让位，实际顶栏下留 16px → 31rpx。
3. **看板 section**：`padding: 52px 20.578px 44px` → **100rpx 40rpx 85rpx**；宽 343.219px → **660rpx**（`manifest.json:283–300`）。
4. **看板头部（board-head）**，底距 36px → **69rpx**（`manifest.json:301–318`）：
   - eyebrow `LOCAL EVENTS`：21rpx / 400 / 34rpx / 5rpx，色 `#5F7F9E`（`manifest.json:338–345`）。
   - H2 `本地赛事`：46rpx / 600 / 69rpx / 2rpx，上距 12px → 23rpx（`manifest.json:356–363`）。
   - 副文案：27rpx / 400 / 40rpx，上距 10px → 19rpx，色 `#7C93A8`（`manifest.json:374–389`）。
   - 四步流程：上距 18px → 35rpx；序号圈 22×22px → **42×42rpx**；标签 25rpx/600；箭头左右 8px → 15rpx（`manifest.json:392–407`、`manifest.json:536–551`、`app/board.css:8–12`）。
   - `发起活动` CTA：140×42px → **269×81rpx**；圆角 40px → **77rpx**；字号 27rpx/600；渐变 `#3EC2F7 → #1B9CFC`；阴影 cta（`manifest.json:572–587`）。
5. **筛选面板（board-side）**：宽 302.062px → **581rpx**；`padding: 18px 16px` → **35rpx 31rpx**；圆角 16px → **31rpx**；底色 `#F8FBFE`；组间距 20px → 38rpx（`manifest.json:5233–5250`）。
   - 组标签：12px / 400 / 18px / 2px → **23rpx / 400 / 35rpx / 4rpx**，色 `#8FA6BB`（`manifest.json:5251–5268`）。
   - chip：高 30px → **58rpx**；左右 13px → **25rpx**；圆角 20px → **38rpx**；字号 12px → **23rpx**；未选中白底 `#FFFFFF` + 1rpx `#DCE7F2`；选中 `#E3F4FF` 底、`#0B6FA8` 字、1rpx `#1B9CFC` 边、600 字重、active 阴影（`manifest.json:5269–5304`、`app/board.css:23–25`）。
   - 日期输入：高 30px → 58rpx；圆角 9px → 17rpx；字号 12px → 23rpx（`manifest.json:5611–5628`）。
   - 结果计数行：上距 14px → 27rpx；上边 1rpx `#E8F0F8`；13px → 25rpx，色 `#7C93A8`（`manifest.json:5737–5754`）。
6. **分组 1「已结束」**：组头 H3 20px/650/30px/1px → **38rpx/650/58rpx/2rpx**；场次 12px → 23rpx `#9FB2C4`；组头底距 6px → 12rpx（`manifest.json:643–678`）。
   - **信息流条目不使用卡片**（无边框、无底色）：`padding: 14px 0 24px` → **27rpx 0 46rpx**（`manifest.json:715–732`）。
   - 左日期块：48×48px → **92×92rpx**；圆角 9px → **17rpx**；本地活动渐变 `linear-gradient(145deg,#54cfc4,#1f9e8a)`，创作类 `#5fc8ff → #2a8de8`（`manifest.json:1183–1200`、`app/board.css:53`、`app/board.css:62`）。月 18rpx/27rpx，日 33rpx/650/33rpx。
   - 标题：30rpx/650/45rpx/1rpx（`manifest.json:823–840`）。
   - 时间行：25rpx/38rpx，色 `#7C93A8`，上距 7px → 13rpx（`manifest.json:841–859`）。
   - 地点行：25rpx/38rpx，色 `#66809A`，上距 14px → 27rpx；分隔点 `#C4D3E0`（`manifest.json:860–898`）。
   - 简介：26rpx/45rpx，色 `#5B6B7D`，上距 9px → 17rpx（`manifest.json:913–930`）。
   - 元信息行：24rpx/36rpx，色 `#9FB2C4`，上距 12px → 23rpx；奖金 24rpx/600 `#C9952A`；`查看详情 →` 24rpx/600 `#0B6FA8`，右对齐（`manifest.json:949–1056`）。
7. **分组 2「国内平台活动」**：结构同分组 1；组间间距 46px → **88rpx**（`app/board.css:39`）。
8. **页脚**：12px/18px → **23rpx/35rpx**；`padding: 14px 6% 18px` → **27rpx 45rpx 35rpx**；链接 `#8FA6BB`（`manifest.json:7159–7212` 的 3 个 `icp-footer-link`、`app/globals.css:60–62`；activities 采集里只有链接，没有 FOOTER 容器，容器尺寸取 detail/leaderboard 的 `manifest.json:9350–9364`）。

### 3.2 activity-detail（活动详情）

依据：`activities-guoqing-77-0.png`、`activities-guoqing-77-1.png`；`manifest.json:7216–9421`。

1. **固定全站顶栏**：223rpx（同 3.1）。
2. **Hero**：`padding: 172px 6% 26px` → **331rpx 45rpx 50rpx**；底部 1rpx `#E2ECF6` 分隔（`manifest.json:7476–7493`、`app/activities/[slug]/detail.css:12`）。
   - H1：46rpx/600/67rpx/2rpx（`manifest.json:7494–7511`）。
   - 副标题：26rpx/49rpx，上距 14px → 27rpx（`manifest.json:7512–7528`）。
   - 主办方/联系方式：24rpx/36rpx/1rpx，色 `#7C93A8`，上距分别 16px → 31rpx、8px → 15rpx（`manifest.json:7530–7565`）。
3. **移动端单列骨架**：`padding: 32px 6% 56px` → **62rpx 45rpx 108rpx**；**顺序必须是「关键信息 → 报名卡 → 海报 → 正文 sections」**（`app/activities/[slug]/detail.css:116–119` 的 `grid-template-areas:"side" "poster" "main"`；`manifest.json:7566–7601`）。
4. **关键信息卡（detail-facts）**：白底；`padding: 24px` → **46rpx**；圆角 16px → **31rpx**；阴影 m（`manifest.json:8754–8771`）。
   - 卡标题「关键信息」：13px / 500 / 19.5px / 2px → **25rpx / 500 / 38rpx / 4rpx**，色 `#8FA6BB`（`manifest.json:8772–8789`）。
   - 字段行：dt 25rpx `#8FA6BB`，dd 25rpx `#42566B`，行高 19.5px → 38rpx；每行约 43px → **84rpx**；字段之间 13px → 25rpx（`manifest.json:8809–8845`）。
   - 移动端字段改为上下两行、dd 左对齐（`app/activities/[slug]/detail.css:132–133`）。
5. **报名卡（detail-join）**：白底；padding 24px → 46rpx；圆角 16px → 31rpx；阴影 m（`manifest.json:9276–9293`）。
   - 标题「想参加这场活动？」：15px / 600 / 22.5px / 1px → **29rpx / 600 / 43rpx / 2rpx**（`manifest.json:9294–9311`）。
   - 主按钮：全宽 42px 高 → **81rpx**；圆角 40px → **77rpx**；字号 27rpx/600；渐变 + cta 阴影（`manifest.json:9312–9329`）。
   - 说明文字：12px / 22.2px → **23rpx / 43rpx**，色 `#8FA6BB`（`manifest.json:9330–9347`）。
6. **海报**：移动端 `width: min(360px, 100%)` → **最大 692rpx**；居中；圆角 14px → **27rpx**；1rpx `#E2ECF6` 边；poster 阴影（`app/activities/[slug]/detail.css:21–22`、`detail.css:119`）。
7. **正文 sections**（`detail-main`，区块间距 36px → **69rpx**）：
   - 每个 section：eyebrow 19rpx/29rpx/4rpx `#0AA2E0`；H2 35rpx/600/52rpx/2rpx；标题下距 16px → 31rpx（`manifest.json:7620–7637`、`manifest.json:8233–8240`、`app/activities/[slug]/detail.css:23`）。
   - 「你要做什么」正文：28rpx/57rpx/2.05（`manifest.json:7656–7673`）。
   - 「怎么参加」四步：移动端 **1 列**；卡片 `#F8FBFE` + 1rpx `#E3EDF6` + 12px → **23rpx** 圆角 + `padding: 14px 16px` → **27rpx 31rpx**；序号圈 42rpx；粗体 27rpx/650；说明 24rpx/41rpx，左缩进 31px → **60rpx**（`manifest.json:7746–7799`、`app/activities/[slug]/detail.css:216–221`）。
   - 「能获得什么」奖项行：`padding: 15px 0` → **29rpx 0**；底边 1rpx `#EEF3F8`；名称 26rpx/600；金色数量 24rpx（`manifest.json:8034–8087`）。
   - 「评审维度」：条目名 26rpx/600，金色占比 24rpx；进度条高 6px → **12rpx**，圆角 3px → **6rpx**，底 `#E3EDF6`（`manifest.json:8358–8375`）。
   - 「作品展示」chips：高 32px → **62rpx**；圆角 20px → **38rpx**；左右 15px → **29rpx**；字号 13px → **25rpx**（`manifest.json:8610–8645`）。
8. **页脚**：同 3.1（`manifest.json:9349–9420`：FOOTER 在 `9350`，高 69.7656px，`9364`）。

### 3.3 leaderboard（排行榜）

依据：`leaderboard-0.png`、`leaderboard-1.png`；`manifest.json:9423–11844`。

1. **固定全站顶栏**：223rpx。
2. **Hero（lb-hero）**：`padding: 116px 6% 26px` → **223rpx 45rpx 50rpx**；底部 1rpx `#E2ECF6`（`manifest.json:9683–9700`、`app/leaderboard/leaderboard.css:3`）。
   - eyebrow `LEADERBOARD`：21rpx/34rpx/5rpx（`manifest.json:9701–9718`）。
   - H1 `排行榜`：50rpx/600/75rpx/2rpx（`manifest.json:9719–9736`）。
   - 副文案：27rpx/51rpx（1.9），色 `#7C93A8`，上距 14px → 27rpx（`manifest.json:9737–9754`）。
3. **统计卡 2×2**：`margin-top: 28px` → **54rpx**；列间距 14px → **27rpx**；移动端 2 列（`manifest.json:9773–9790`、`app/leaderboard/leaderboard.css:46`）。
   - 每卡：164.6×89px → 宽 **317rpx**、最小高 **171rpx**；`padding: 16px` → **31rpx**；圆角 16px → **31rpx**；白底；阴影 m（`manifest.json:9791–9808`）。
   - 数字：20px/600/30px/0.5px → **38rpx/600/58rpx/1rpx**；标签：12px/18px/1px → **23rpx/35rpx/2rpx** `#8FA6BB`（`manifest.json:9809–9844`）。
4. **分区骨架（lb-section）**：`padding: 28px 6% 6px` → **54rpx 45rpx 12rpx**（`manifest.json:10007–10024`）。
   - 每个分区：eyebrow 19rpx/29rpx/4rpx `#0AA2E0`；H2 38rpx/600/58rpx/2rpx，下距 18px → **35rpx**（`manifest.json:10025–10060`）。
5. **「我的荣誉」**：
   - 卡片 `lb-me`：`padding: 16px` → **31rpx**；圆角 14px → **27rpx**；白底；阴影 m（`manifest.json:10061–10078`）。
   - 头像「你」：40×40px → **77×77rpx** 圆；`#E3F4FF` 底；`#0B6FA8` 字；600（`manifest.json:10079–10096`）。
   - 主文案 16px/600 → **31rpx/600**；说明 12px/18px → **23rpx/35rpx** `#8FA6BB`（`manifest.json:10097–10132`）。
6. **「各区统计」**：说明 13.5px/24.975px → **26rpx/48rpx**，色 `#66809A`（`app/leaderboard/leaderboard.css:75`）。
   - 区行：白底；`padding: 11px 14px` → **21rpx 27rpx**；圆角 12px → **23rpx**；高 43.5px → **84rpx**；行间距 10px → **19rpx**（`manifest.json:10241–10258`、`app/leaderboard/leaderboard.css:61–62`）。
   - 圆点 10px → **19rpx**；区名 13px/600 → **25rpx/600**；场次 13px → **25rpx** `#8FA6BB`（`manifest.json:10259–10300`）。
7. **「战队荣誉」**：说明 + 战队面板（donut 图 + 列表）；移动端纵向堆叠；列表表头 12px → 23rpx `#8FA6BB`，行文字 13.5px → 26rpx（`app/leaderboard/page.tsx:85–111`、`app/activities/[slug]/detail.css:71–82`）。
8. **「个人的贡献」**：
   - 说明：26rpx/48rpx `#66809A`。
   - 规则框：`#F8FBFE` 底；1rpx 虚线 `#C7D8E8`；圆角 12px → **23rpx**；`padding: 12px 18px` → **23rpx 35rpx**；正文 25rpx；summary 25rpx/600 `#0B6FA8`（`manifest.json:11627–11644`）。
   - 表格：白底；圆角 16px → **31rpx**；`padding: 6px 16px` → **12rpx 31rpx**；阴影 m；表头 12.5px/18.75px/1.5px → **24rpx/36rpx/3rpx** `#8FA6BB`（`manifest.json:11663–11680`、`app/leaderboard/leaderboard.css:21–24`）。
9. **页脚**：同 3.1（`manifest.json:11771–11842`：FOOTER 在 `11773`）。

### 3.4 profile（个人主页）

依据：`profile-0.png`、`profile-1.png`；`manifest.json:11846–12305`。**该页没有全站 logo 顶栏**，用的是二级页顶栏 `detail-top`。

1. **二级页顶栏 `detail-top`（不是固定定位，在文档流里）**：高 64px → **123rpx**；`padding: 18px 6%` → **35rpx 45rpx**；底部 1rpx `#E2ECF6`（`manifest.json:11908–11925`、`app/activities/[slug]/detail.css:4`）。
   - 左返回：14px → **27rpx**，色 `#0AA2E0`；左箭头 17px（`manifest.json:11926–11943`）。
   - 中标题「个人主页」：15px / 22.5px / 2px → **29rpx / 43rpx / 4rpx**（`manifest.json:11944–11961`）。
   - 右状态 chip：10px / 15px → **19rpx / 29rpx**；`padding: 5px 7px` → **10rpx 13rpx**；圆角 6px → **12rpx**；底 `#F6FAFD`；色 `#7C93A8`（`manifest.json:11962–11979`）。
2. **未登录主卡（profile-card）**：`max-width: 520px` → **1000rpx**；`margin: 44px auto` → **85rpx auto**；左右 6% → **45rpx**；纵向 gap 16px → **31rpx**（`manifest.json:11980–11997`、`app/profile/profile.css:37`）。
   - eyebrow `HONOR · 数字杭州市民`：21rpx/34rpx/5rpx `#5F7F9E`（`manifest.json:11998–12015`）。
   - H1「登录后查看你的勋章」：46rpx/600/69rpx/2rpx（`manifest.json:12016–12033`）。
   - 说明：26rpx/49rpx（1.9），色 `#7C93A8`（`manifest.json:12034–12051`）。
   - 微信登录按钮：56px 高 → **108rpx**；圆角 12px → **23rpx**；左右 20px → **38rpx**；字号 16px/24px/1px → **31rpx/46rpx/2rpx**；白底 + 1rpx `#DCE7F2` + s 阴影；图标 18px 左右（`manifest.json:12070–12087`、`app/globals.css:10`）。
   - 「返回首页」CTA：140×42px → **269×81rpx**；圆角 77rpx；字号 27rpx/600；渐变 + cta 阴影（`manifest.json:12106–12123`）。
3. **登录前状态**：主卡下方还有 `profile-body profile-joins-only`，`padding: 26px 6% 48px` → **50rpx 45rpx 92rpx**（`manifest.json:12125–12142`、`app/profile/profile.css:4`）。
4. **「我的报名」区块**：
   - eyebrow `ACTIVITIES`：19rpx/29rpx/4rpx `#0AA2E0`（`manifest.json:12160–12177`）。
   - H2「我的报名」：38rpx/600/58rpx/2rpx，下距 16px → **31rpx**（`manifest.json:12178–12195`）。
   - 空态文案：13px/24.05px → **25rpx/46rpx** `#8FA6BB`；`去活动看板看看` 链接 25rpx `#0AA2E0`（`manifest.json:12196–12231`）。
5. **页脚**：`padding: 14px 6% 18px` → **27rpx 45rpx 35rpx**；12px/18px → **23rpx/35rpx**；链接 `#8FA6BB`（`manifest.json:12232–12302`：FOOTER 在 `12234`）。
6. **登录后变体（基线截图未覆盖，尺寸取自仓库 CSS）**：`medal-card` 白底、`padding: 34px` → **65rpx**、圆角 16px → **31rpx**、阴影 m；H1 26px → **50rpx**；星级 26px；贡献值 32px/600 → **62rpx**；进度条 6px → **12rpx**（`app/profile/profile.css:7–23`）。

### 3.5 create（发起活动）

依据：`create-0.png`、`create-1.png`；`manifest.json:12307–12766`。基线为**未登录门禁态**。

1. **固定全站顶栏**：223rpx（同 3.1）。
2. **门禁卡（agent-gate）**：`margin: 116px 6% 48px` → **223rpx 45rpx 92rpx**（相对页面顶部；116px 正好等于顶栏高度，所以卡片顶边紧贴顶栏底边）；`padding: 34px 22px` → **65rpx 42rpx**；圆角 20px → **38rpx**；白底；gate 阴影（`manifest.json:12567–12584`、`app/create/create.css:118`）。
3. **图标**：64×64px → **123×123rpx** 圆；底 `#E8F5FF`；图标色 `#1B9CFC`（`manifest.json:12585–12602`）。
4. **H1「先登录，再发起活动」**：26px / **400** / 39px / 1px → **50rpx / 400 / 75rpx / 2rpx**；色 `#0F2F4D`。注意基线的字重是 **400**（不是 600），截图里也是常规字重（`manifest.json:12603–12620`）。
5. **说明文字**：14.5px / 27.55px → **28rpx / 53rpx**；色 `#4D6B87`；水平居中（`manifest.json:12621–12638`、`app/create/create.css:120`）。
6. **登录按钮**：provider-list 上距 6px → **12rpx**；按钮全宽（卡内 297.219px → **572rpx**）；56px 高 → **108rpx**；圆角 12px → **23rpx**；白底 + 1rpx `#DCE7F2` + s 阴影；字号 31rpx/46rpx/2rpx（`manifest.json:12639–12674`、`app/globals.css:10`）。
7. **页脚**：同 3.1（`manifest.json:12693–12764`：FOOTER 在 `12695`）。
8. **登录后变体（基线未覆盖）**：三栏表单骨架 `262px / 1fr / 300px`（`app/create/create.css:5`）；小程序只保留单列表单，步骤条改为横向滚动（`app/create/create.css:100–114`），不要复刻三栏。

---

## 4. 顶栏规范

### 4.1 网页 header 的两行结构（390px 基线）

网页在 ≤760px 时是 **grid 两行**，`position: fixed`，总高 **116px**：

```
┌──────────────────────────────────────────────┐
│  [logo 50px 高]              中 / EN   👤 登录 │  ← 第 1 行，高 50px
│  首页      活动      排行榜                    │  ← 第 2 行，高 45.5px
├──────────────────────────────────────────────┤  ← 1px #E3EDF6 + 1px #F2F7FC
```

实测值（manifest + 仓库 CSS 对齐后）：

| 项 | 网页值 | 小程序值 | 证据 |
| --- | --- | --- | --- |
| 顶栏高度 | 116px | **223rpx**（不含状态栏） | `manifest.json:66–84` |
| 固定定位 | `fixed; top:0; left:0; right:0` | 同 | `manifest.json:81` |
| 左右内边距 | 6% = 23.3906px | **45rpx** | `manifest.json:76`、`app/globals.css:54` |
| 上内边距 | 14px | **27rpx** | `manifest.json:76` |
| 底色 | `rgba(255,255,255,.9)` + `blur(12px)` | `rgba(255,255,255,.94)` + 可选 `blur(23rpx)` | `manifest.json:71`、`app/globals.css:10` |
| 第一行 | logo + 中/EN + 账号 | 见 4.3 的平台改写 | `app/globals.css:54`、`manifest.json:158–263` |
| logo 高 | 50px | **96rpx** | `app/globals.css:54` |
| 第一行右侧容器 | 宽 126.031px，`padding-top: 11px`，gap 18px | 见 4.3 | `manifest.json:158–173`、`app/globals.css:54` |
| 语言「中 / EN」 | 12px/18px/1px；「中」700；「/ EN」`#8FA8BF` | **23rpx/35rpx/2rpx**；700 / 400 | `manifest.json:175–229` |
| 账号「👤 登录」 | 13px/19.5px/1px；图标 26px 圆 | **25rpx/38rpx/2rpx**；图标 **50rpx** 圆 | `manifest.json:230–264`、`app/globals.css:54` |
| 第二行 nav | 宽 343.219px，高 45.5px，gap 34px | 宽 **660rpx**，高 **88rpx**，gap **65rpx** | `manifest.json:85–101`、`app/globals.css:54` |
| nav 文字 | 13px/19.5px/1px，色 `#35506B` | **25rpx/38rpx/2rpx**，`#35506B` | `manifest.json:103–120` |
| nav 内边距 | 13px 0 | **25rpx 0** | `manifest.json:112` |
| 底部分隔 | `border-bottom:1px #E3EDF6` + `box-shadow:0 1px 0 #F2F7FC` | **1rpx #E3EDF6 + 0 1rpx 0 #F2F7FC** | `app/globals.css:10`、`manifest.json:79` |

**选中态说明（重要）**：基线采集到的 3 个导航链接颜色完全相同（`#35506B`），manifest 里没有 `is-active` / `aria-current` 样式，仓库 CSS 也没有导航选中态规则。也就是说，**网页基线本身没有可抄的选中态**。小程序需要新增一个约定：当前页用 `#0B6FA8` + `font-weight: 600` 标示（与选中 chip 的文字语言一致）。这是本规范新增，不是基线实测，落地时请在组件注释里注明。

### 4.2 页面顶部让位

网页的顶部内边距已经包含 fixed header 的 116px：

| 页面 | 网页顶部值 | 相对顶栏 | 小程序内容顶部偏移 |
| --- | --- | --- | --- |
| activities | 132px | 116 + 16 | `statusBarRpx + 254rpx` |
| activity-detail | 172px | 116 + 56 | `statusBarRpx + 331rpx` |
| leaderboard | 116px | 正好贴住 | `statusBarRpx + 223rpx` |
| create | 116px（gate margin-top） | 正好贴住 | `statusBarRpx + 223rpx` |
| profile | 0（detail-top 自身在文档流，64px 高） | 无全站顶栏 | `statusBarRpx + 0`，随后渲染 123rpx 的 detail-top |

### 4.3 小程序自定义导航栏实现要点

#### 4.3.1 配置

`app.json` 的 `window`：

```json
{
  "window": {
    "navigationStyle": "custom",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#eef5fc",
    "backgroundTextStyle": "dark"
  }
}
```

- `navigationStyle: "custom"`：去掉原生导航栏（含标题、返回箭头、原生底栏区域）。
- `navigationBarTextStyle: "black"`：只控制状态栏文字黑白；白底顶栏必须用黑色状态栏字。**这不是标题**。
- **删除** `navigationBarTitleText`、`navigationBarBackgroundColor`（`miniprogram/app.json:13–15` 的当前值要移除）。
- 页面级 `.json` 里也不要再出现 `navigationBarTitleText`。

#### 4.3.2 尺寸计算（纯 rpx，不落 px）

```js
// components/site-header/site-header.js
const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const menu = wx.getMenuButtonBoundingClientRect();
const k = 750 / info.windowWidth;                  // rpx per px

const statusBarRpx = Math.round(info.statusBarHeight * k);
const capsuleRpx = Math.round(menu.width * k);     // 胶囊占位宽度
const capsuleGapRpx = 16;                          // 胶囊右侧额外留白

this.setData({ statusBarRpx, capsuleRpx, capsuleGapRpx });
```

- 顶栏总高（含状态栏）= `statusBarRpx + 223rpx`。
- 第一行 `96rpx`（50px），第二行 `88rpx`（45.5px），上内边距 `27rpx`（14px），三者合计 211rpx；在 223rpx 内保留 12rpx 底部余量。
- **胶囊避让**：微信右上角胶囊在 390 宽设备上约占 87px（167rpx）宽，网页第一行的「中/EN + 登录」整体宽 126px，放不下。平台安全做法：
  - 第一行右侧：`中 / EN` 紧贴胶囊左侧，再加 `capsuleRpx + 16rpx` 的占位；
  - 「👤 登录」移到第二行最右侧（`margin-left:auto`），与 3 个导航项同一水平线；
  - 不缩小字号来硬塞，也不把登录藏进胶囊下方。
- 这是平台约束下的等价布局，元素、字号、颜色与网页一致，仅账号的所在行改变。

#### 4.3.3 结构与样式

```html
<!-- components/site-header/site-header.wxml -->
<view class="site-header" style="padding-top:{{statusBarRpx}}rpx">
  <view class="site-header-inner">
    <view class="row row-top">
      <image class="wordmark" src="/assets/brand/hangkathon-logo-teal.png" mode="aspectFit" />
      <view class="lang"><text class="lang-on">中</text><text class="lang-off">/ EN</text></view>
      <view class="capsule-hold" style="width:{{capsuleRpx + capsuleGapRpx}}rpx"></view>
    </view>

    <view class="row row-nav">
      <view class="nav-item {{current === 'home' ? 'is-current' : ''}}" bindtap="goHome">首页</view>
      <view class="nav-item {{current === 'activities' ? 'is-current' : ''}}" bindtap="goActivities">活动</view>
      <view class="nav-item {{current === 'leaderboard' ? 'is-current' : ''}}" bindtap="goLeaderboard">排行榜</view>
      <view class="account" bindtap="goProfile">登录</view>
    </view>
  </view>
</view>
```

```css
/* components/site-header/site-header.wxss */
.site-header {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.94);
  /* 可选：支持 backdrop-filter 的机型再加，不支持时保持上面的实色 */
  backdrop-filter: blur(23rpx);
  border-bottom: 1rpx solid #E3EDF6;
  box-shadow: 0 1rpx 0 #F2F7FC;
  box-sizing: border-box;
}

.site-header-inner {
  height: 223rpx;
  padding: 27rpx 45rpx 0;
  box-sizing: border-box;
}

.row {
  display: flex;
  align-items: center;
}

.row-top {
  height: 96rpx;
  align-items: flex-start;
  justify-content: space-between;
}

.wordmark {
  width: 298rpx;   /* 1400×450 的 logo 在 96rpx 高时约 299rpx 宽 */
  height: 96rpx;
  flex: none;
}

.lang {
  margin-top: 21rpx;   /* 11px */
  font-size: 23rpx;
  line-height: 35rpx;
  letter-spacing: 2rpx;
  color: #35506B;
  white-space: nowrap;
}

.lang-on { font-weight: 700; }
.lang-off { font-weight: 400; color: #8FA8BF; }

.row-nav {
  height: 88rpx;
  gap: 65rpx;
  margin-top: 0;
}

.nav-item {
  font-size: 25rpx;
  line-height: 38rpx;
  letter-spacing: 2rpx;
  color: #35506B;
  padding: 25rpx 0;
}

/* 本规范新增的选中态；基线网页没有该样式 */
.nav-item.is-current {
  color: #0B6FA8;
  font-weight: 600;
}

.account {
  margin-left: auto;
  font-size: 25rpx;
  line-height: 38rpx;
  letter-spacing: 2rpx;
  color: #35506B;
  padding: 25rpx 0;
}
```

#### 4.3.4 页面接入

- 四个使用全站顶栏的页面在根节点设置：

```html
<view class="page" style="padding-top:{{statusBarRpx + 254}}rpx">
```

其中 `254` 按 4.2 表替换：activities 254、detail 331、leaderboard 223、create 223。
- profile 不引入 `<site-header>`，根节点 `padding-top: {{statusBarRpx}}rpx`，随后渲染 123rpx 的 `detail-top`（返回首页 / 个人主页 / 状态 chip）。
- 自定义顶栏用普通 `view` 实现；页面里若出现 `map`、`video`、`canvas` 等原生组件，需要改用 `cover-view` 包裹顶栏，否则会被原生组件盖住。
- 下拉刷新沿用页面 JSON 的 `enablePullDownRefresh`；若原生刷新指示器被固定顶栏遮挡，改用页面内 `scroll-view` 的 `refresher`，**不要为此恢复原生导航栏**。

#### 4.3.5 路由（因为没有 tabBar）

- 顶栏三个导航项是「同级页」：用 `wx.redirectTo`，避免页面栈无限增长。
- `首页`：当前小程序 5 页没有独立首页；在补首页之前，`首页` 与 `活动` 都指向 `pages/activities/activities`，但高亮只给 `活动`。若后续新增首页，再把 `首页` 指向新页面。
- `活动条目` → `pages/activity-detail/activity-detail`：`wx.navigateTo`。
- `发起活动` → `pages/create/create`：`wx.navigateTo`。
- `profile` 的「返回首页」→ `wx.redirectTo` 到 activities。
- **不要**使用 `wx.switchTab`（没有 tabBar 时不可用）。

---

## 5. 明确不要做的事

### 5.1 不要原生 tabBar

- **删除** `miniprogram/app.json:18–28` 的整个 `tabBar` 配置（当前 3 项：活动/排行榜/我的）。
- 不要用 `wx.switchTab`；不要用 `tabBar.custom` 再包一层；不要在小程序底部画一条仿 tabBar。
- 网页的导航形态是**顶栏第二行**（首页/活动/排行榜），小程序保持这一形态；个人主页通过顶栏「登录/账号」进入，不做底部第四个 tab。
- 当前 `app.json:18` 的 `tabBar` 与本规范冲突，落地时必须移除。

### 5.2 不要默认导航栏标题

- 删除 `app.json` 的 `navigationBarTitleText`（当前 `miniprogram/app.json:14` 为「杭客松」）。
- 删除 5 个页面 JSON 的 `navigationBarTitleText`（当前 `activities.json:2`、`activity-detail.json:2`、`leaderboard.json:2`、`profile.json:2`、`create.json:2` 全部存在）。
- 不要调用 `wx.setNavigationBarTitle`。
- 页面标题只能由页面内容里的 H1 承担：
  - activities：`本地赛事`
  - activity-detail：活动标题
  - leaderboard：`排行榜`
  - profile：`登录后查看你的勋章`（登录后为账号名/勋章标题）
  - create：`先登录，再发起活动`
- 不要为了「看起来有标题」再画一条 44px 的原生高度条；自定义顶栏就是唯一顶栏。

### 5.3 不要 px 单位

- WXSS、WXML 的 `style`、JS 拼出的样式字符串里**一律不写 `px`**；全部用 `rpx`（百分比/`vh` 只在明确需要时用）。
- 现有 `miniprogram/pages/activities/activities.wxss:235` 的注释「rpx = px×2」是错误算法，替换为 `×750/390`；代码本身已是 rpx，不需要改数值逻辑，但数值要按本规范重算（例如 58px 应为 112rpx，而不是 116rpx）。
- 系统 API 返回的 `statusBarHeight`、`menuButton` 宽高、`windowWidth` 单位是 px，允许在 JS 里接收，但必须**立刻乘 `750/windowWidth` 转成 rpx 再进入样式**（见 4.3.2）；不要把这些 px 直接拼进 `style`。
- 1px 边框统一改 `1rpx`（见 1.3）；不要保留 `0.5px`、`1px`、`2px`。
- 可以用 `1rpx`、`2rpx`、`4rpx`、`6rpx` 表达加粗线，但不要用 `px`。

### 5.4 其他不要做

- 不要把网页的桌面三栏布局搬进小程序：详情页在移动端是「关键信息 → 报名 → 海报 → 正文」单列；发起页是三栏，但小程序只保留单列表单。
- 不要给信息流条目加白卡、描边、阴影：网页 activities 的 feed-item 是**开放列表行**，`background` 为透明、`box-shadow: none`（`manifest.json:715–732`）。
- 不要把 16px 浏览器默认字号当正文；正文是 13.5–14.5px 档（见 2.2）。
- 不要把金色当主色大面积使用；金色只用于奖金/奖励/荣誉数字（`#C9952A`）。
- 不要在浅色页面用深色 `#0B2748` 顶栏；新顶栏是白底黑字（状态栏黑色）。

---

## 6. 落地核对（当前仓库 vs 本规范）

以下为 2026-10-23 在本仓库实际执行的 grep 结果，供改造前对照；这些是**现状**，不是规范要求：

| 检查 | 命令 | 当前结果 | 规范要求 |
| --- | --- | --- | --- |
| 原生 tabBar | `grep -n '"tabBar"' miniprogram/app.json` | 命中 `miniprogram/app.json:18` | 必须删除 |
| 默认导航标题 | `grep -rn 'navigationBarTitleText' miniprogram/pages/*/*.json` | 7 处命中（activities/detail/leaderboard/profile/create/submit/manage） | 5 个目标页必须删除 |
| 自定义导航 | `grep -rn 'navigationStyle' miniprogram` | 无命中 | 必须加 `"navigationStyle": "custom"` |
| px 单位 | `grep -rn '[0-9]px' miniprogram --include=*.wxss` | 仅 `activities.wxss:235` 注释命中，无样式代码命中 | 保持 0 处，且改掉 ×2 注释 |
| 设计令牌 | `miniprogram/app.wxss:6–14` | 已有 `--hk-primary/--hk-primary-dark/--hk-foreground/--hk-muted/--hk-border/--hk-bg/--hk-card/--hk-gold` | 保留并补齐 2.1 的 `--hk-*` |

> 注意：`app.wxss` 现有令牌值（`#1b9cfc`、`#0b6fa8`、`#17273a`、`#7c93a8`、`#dce7f2`、`#eef5fc`、`#ffffff`、`#c9952a`）与 manifest/仓库 CSS 一致，可以直接保留；缺的是 panel、divider、muted-2、muted-3、danger、dark 等令牌。

---

## 7. 逐页验收清单（pageChecks）

> 每条都必须能在真机/开发者工具里逐项核对；尺寸单位均为 rpx（除标注 px 的网页对照值）。

### activities（7 条）

1. 顶栏是自定义双行、固定定位，总高为 `状态栏 + 223rpx`；第一行 logo 96rpx、`中 / EN` 23rpx；第二行 3 个导航 25rpx、间距 65rpx；底部 1rpx `#E3EDF6` + `0 1rpx 0 #F2F7FC`；没有原生标题。
2. 内容顶部留白 `状态栏 + 254rpx`、左右 45rpx；看板内边距 100/40/85rpx；内容宽 581rpx。
3. 标题区顺序为 eyebrow 21rpx → H2 46rpx/600 → 副文案 27rpx/1.5 → 四步流程（序号圈 42rpx）→ CTA 269×81rpx/圆角 77rpx。
4. 筛选面板为 `#F8FBFE`、圆角 31rpx、padding 35/31rpx；组标签 23rpx/字距 4rpx；chip 高 58rpx、圆角 38rpx、字号 23rpx；选中态为 `#E3F4FF` 底 + `#0B6FA8` 字 + 1rpx `#1B9CFC` 边。
5. 信息流条目没有卡片底/边框/阴影；条目 padding 27rpx 0 46rpx；日期块 92×92rpx/圆角 17rpx；标题 30rpx/650/1.5；when 25rpx/38rpx `#7C93A8`；intro 26rpx/45rpx `#5B6B7D`；meta 24rpx/36rpx。
6. 分组标题 38rpx/650/58rpx + 场次 23rpx `#9FB2C4`；组间 88rpx；奖金用 `#C9952A`，`查看详情` 用 `#0B6FA8`。
7. 页脚 23rpx/35rpx，padding 27/45/35rpx，链接 `#8FA6BB`。

### activity-detail（7 条）

1. 顶栏同 activities；hero 顶部为 `状态栏 + 331rpx`，左右 45rpx，底部 50rpx；hero 下缘 1rpx `#E2ECF6`。
2. H1 46rpx/600/67rpx/2rpx；副标题 26rpx/49rpx；主办方/联系方式 24rpx/36rpx/1rpx `#7C93A8`。
3. 移动端顺序必须是「关键信息卡 → 报名卡 → 海报 → 正文 sections」；不得三栏并排。
4. 关键信息卡白底、padding 46rpx、圆角 31rpx、阴影 m；卡标题 25rpx/500/4rpx `#8FA6BB`；字段行最小高 84rpx，dt `#8FA6BB`、dd `#42566B`，字号 25rpx。
5. 报名卡白底、padding 46rpx、圆角 31rpx；标题 29rpx/600/2rpx；主按钮全宽 81rpx 高、圆角 77rpx、字号 27rpx/600；说明 23rpx/43rpx。
6. 正文 section 间距 69rpx；eyebrow 19rpx/29rpx/4rpx `#0AA2E0`；H2 35rpx/600/52rpx/2rpx；正文 28rpx/57rpx；四步卡单列、`#F8FBFE`、圆角 23rpx、padding 27/31rpx、序号圈 42rpx。
7. 奖项行 padding 29rpx 0、底线 1rpx `#EEF3F8`；评审条 12rpx 高/圆角 6rpx/`#E3EDF6`；chips 62rpx 高/圆角 38rpx/字号 25rpx；海报最大宽 692rpx、圆角 27rpx、poster 阴影。

### leaderboard（7 条）

1. 顶栏同 activities；hero 顶部 `状态栏 + 223rpx`、底部 50rpx、下缘 1rpx `#E2ECF6`。
2. Hero 顺序：eyebrow 21/34/5 → H1 50rpx/600/75rpx/2rpx → 副文案 27rpx/51rpx `#7C93A8` → 2×2 统计。
3. 统计卡 2 列、gap 27rpx、margin-top 54rpx；白底、padding 31rpx、圆角 31rpx、阴影 m；数字 38rpx/600/58rpx/1rpx；标签 23rpx/35rpx/2rpx `#8FA6BB`。
4. 每个 section padding 54/45/12rpx；eyebrow 19rpx/29rpx/4rpx `#0AA2E0`；H2 38rpx/600/58rpx/2rpx、下距 35rpx。
5. 「我的荣誉」卡 padding 31rpx、圆角 27rpx、阴影 m；头像 77rpx 圆（`#E3F4FF`/`#0B6FA8`）；主文案 31rpx/600；说明 23rpx/35rpx `#8FA6BB`。
6. 区统计行白底、padding 21/27rpx、圆角 23rpx、高 84rpx；圆点 19rpx；区名 25rpx/600；场次 25rpx `#8FA6BB`；行间距 19rpx。
7. 规则框 `#F8FBFE` + 1rpx 虚线 `#C7D8E8` + 圆角 23rpx + padding 23/35rpx；表格白底、圆角 31rpx、padding 12/31rpx；表头 24rpx/36rpx/3rpx `#8FA6BB`。

### profile（7 条）

1. 该页不使用全站双行顶栏，使用 `detail-top`：紧贴状态栏下、高 123rpx、padding 35/45rpx、底部 1rpx `#E2ECF6`。
2. `detail-top` 左返回 27rpx `#0AA2E0`；标题 29rpx/43rpx/4rpx；右侧状态 chip 19rpx/29rpx、padding 10/13rpx、圆角 12rpx、底 `#F6FAFD`。
3. 未登录主卡最大宽 1000rpx、上下 85rpx、左右 45rpx、gap 31rpx；eyebrow 21/34/5；H1 46rpx/600/69rpx/2rpx；说明 26rpx/49rpx `#7C93A8`。
4. 微信登录按钮高 108rpx、圆角 23rpx、padding 0 38rpx、字号 31rpx/46rpx/2rpx、白底 + 1rpx `#DCE7F2` + 阴影 s。
5. 「返回首页」CTA 269×81rpx、圆角 77rpx、字号 27rpx/600、渐变 `#3EC2F7 → #1B9CFC`、阴影 cta。
6. 「我的报名」区块 padding 50/45/92rpx；eyebrow ACTIVITIES 19rpx/29rpx/4rpx 蓝；H2 38rpx/600/58rpx/2rpx；空态 25rpx/46rpx `#8FA6BB`，链接 `#0AA2E0`。
7. 页脚 23rpx/35rpx；页面底为白→`#F4F9FE`→`#EEF5FC` 纵向渐变；整页没有原生导航标题。

### create（6 条）

1. 顶栏为固定双行 header（`状态栏 + 223rpx`）；门禁卡顶边紧贴顶栏底边，没有额外空隙。
2. 门禁卡左右 45rpx、下 92rpx、padding 65/42rpx、圆角 38rpx、白底、gate 阴影。
3. 图标 123rpx 圆、底 `#E8F5FF`、图标色 `#1B9CFC`。
4. H1 为 50rpx / **400** / 75rpx / 2rpx，色 `#0F2F4D`（不要用 600）；说明 28rpx/53rpx `#4D6B87`。
5. 登录按钮全宽、108rpx 高、圆角 23rpx、字号 31rpx/46rpx/2rpx；按钮组上距 12rpx。
6. 页脚 23rpx/35rpx，padding 27/45/35rpx；页面无原生导航标题，也无底部 tabBar。

---

## 8. 参考

- 基线 manifest：`/d/program/hangkathon/.workflow-artifacts/baseline/manifest.json`
- 仓库样式：
  - `app/globals.css:4`（design tokens）、`app/globals.css:10`（site-header）、`app/globals.css:40`（primary-action / hero）、`app/globals.css:54`（≤760px header/media）、`app/globals.css:60–62`（ICP footer）
  - `app/board.css`（activities 信息流、筛选面板）
  - `app/activities/[slug]/detail.css`（详情页骨架）
  - `app/leaderboard/leaderboard.css`（排行榜）
  - `app/profile/profile.css`（个人主页）
  - `app/create/create.css`（发起页门禁/表单）
- 当前小程序：`miniprogram/app.json`、`miniprogram/app.wxss`、`miniprogram/pages/*/*.json`
