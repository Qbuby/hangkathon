# 杭客松首页 Demo

一个用 React 与 Three.js 构建的首页体验。桥体保持固定，鼠标悬停或划过水面产生涟漪；键盘空格键泛起涟漪，Home 键使水面平静。活动看板在 `/activities`，预置一场示例活动。

## 核心机制：奖金分发 · 阵营 · 荣誉

规则全文见 [docs/prize-mechanism.md](docs/prize-mechanism.md)。概要：报名后从杭州 13 个县级行政区阵营中选一个（活动中锁定，13 个阵营一视同仁）；正式阶段每天领 ¥100 算力券（邀请 +¥5，封顶 ¥200）；产出 24 小时内按质量审核计入个人与阵营贡献值；有奖金的活动按「阵营占比 × 个人占比」两层比例分发奖池；完赛折算平台贡献值，升级「数字杭州市民」勋章（★1–★5）。当前跑在演示数据上：

- **活动详情页**：阵营贡献环形图（总贡献、各阵营占比、预计奖金）+ 报名弹窗（选阵营、锁定不可改；第一个加入某阵营的人可选担任**数字区长**）。数字区长可复制邀请链接（活动期间任一阶段有效），被邀请者打开链接只能加入数字区长所在阵营或拒绝（接受需登录）；每位受邀加入为数字区长 +50 平台贡献值。数字区长名册仍是演示级（战队数据为空）；邀请事件在有数据库的部署里存服务端，在 Vercel 那份里按浏览器本地记录。
- **排行榜 `/leaderboard`**：平台总贡献值、各阵营贡献占比、数字市民排行榜（顶部导航直达）。
- **个人主页 `/profile`**：登录后显示「数字杭州市民」勋章星级与平台贡献值；「我的报名」有数据库的部署读服务端（按账号），没有数据库的部署读本机记录，两种状态都显示。

## 关于我们

首页底部的 `#about` 区块只有一两句话：杭客松连接什么，以及始终围绕的那个问题。导航里没有「关于我们」入口，首屏的「共创社区」卡片跳到这里。顶部导航为「首页」「活动」「排行榜」（`/leaderboard`）；活动看板的入口是首屏的「探索活动」按钮，「发起活动」在首屏。

## 活动看板

首页 `#activities` 是活动看板，可按四个维度筛选并按三种方式排序：

- **类别**：内容创作 / 工具与效率 / 城市与生活 / 技术探索 / 社区共创
- **奖金**：全部 / 有奖金 / 无奖金
- **形式**：全部 / 线上 / 线下
- **费用**：全部 / 免费 / 收费
- **排序**：最新发布 / 奖金最高 / 即将截止

预置活动在 `lib/published-activities.ts`（「中秋诗会 · AI 写杭州」——全民用 AI 创作与中秋、杭州相关的诗词歌赋）。有数据库的部署里它在首次读取时入库，用户创建的活动也进同一个表；没有数据库的部署里它作为常量参与列表，本机创建的活动一并进入看板。两种情况下筛选、排序与列表渲染都只有一套代码。

点击任意一条活动会跳到 `/activities/[slug]` 活动详情页：介绍、评审维度、奖项、提交形式，以及时间/地点/费用/报名方式等关键信息。报名与作品提交在详情页完成；有数据库的部署里它们写服务端并按账号归属，作品只有本人可见。

## 运行

使用 Node.js 22.13+。安装依赖后运行 `npm run dev`。`npm run build` 生成 Sites 兼容构建。

## 部署

仓库同时支持两个目标，`npm run build` 会按宿主环境自动选择：

- **Vercel**：Vercel 在 Next.js 项目下优先执行 package.json 的 `build` 脚本，而不是 `next build`，所以它会拿到 Vinext 产出的 `dist/`，没有 `.next` 可服务，部署显示 Ready 但全站 404。构建脚本检测到 `VERCEL=1` 时改走标准 `next build`，输出 `.next`。`vercel.json` 也显式声明了 `framework` 与 `buildCommand`，即使后台 Override 被打开也仍然正确。
- **Cloudflare / OpenAI Sites**：`npm run build` 在本地照旧运行 Vinext 构建，输出 `dist/server/wrangler.json`，由 `npm start` 通过 Wrangler 启动。

单独触发某一目标时用 `npm run build:vercel` 或 `npm run build:cloudflare`。

## 发起活动

`/create` 是一条六步创建流程，骨架参照 Kaggle 的 Community Competition 设置（基本信息 → 可见性与准入 → 奖项 → 评审标准 → 时间线 → 发布检查），把 Kaggle 的数据集、评分与排行榜换成本站需要的两个维度：

- **形式**：线上 / 线下（线下必填活动地点）
- **费用**：免费 / 收费（收费必填费用说明）

活动全程在杭客松平台内进行：报名、提交与评审都在站内，创建流程里没有任何要求填写外部网址的字段。提交形式也据此设计为「项目说明 / 代码或文件 / 演示视频 / 交互 Demo / 现场演示」——是站内提交物的类型，不是指向外部仓库的链接。

其余步骤：活动时间（起止日期）、提交与评审（接受的提交形式、评审方式、加权评审维度，权重合计必须为 100%）、奖项（可关闭，开启后填写奖金总额并逐条填写奖项与名额）、公开范围（公开 / 不公开，所有人 / 知道活动代号的人 / 限定邮箱域名）。

基本信息里的「活动类别」和奖项里的「奖金总额」是活动看板的筛选依据，所以要能被筛出来就必须先能填。

基本信息里有一个「活动代号」，是站内指代这场活动的标识名（例如 `ai-creators-autumn`），不是需要访问的网址。

表单结构是声明式的，全部定义在 `lib/activity.ts` 的 `STEPS` 里；创建页只负责渲染与校验，增删字段只改这一个文件。

**数据存在哪里，取决于部署有没有数据库。** 同一份代码两种模式，由 `lib/api/data.ts` 按 `DATABASE_URL` 是否存在切换：

- **自托管那份（有 Postgres）**：活动、报名、作品提交、邀请事件都在服务端，按登录账号归属，换设备也能看到；
  **写操作需要登录**（未登录时按钮会提示先登录）。后端结构见 `db/schema.ts`，运维见 `deploy/README.md`。
- **Vercel 那份（没有数据库）**：创建出的活动保存在浏览器 localStorage（键名 `hangkathon.activities.v1`），
  列表会读出来置顶显示并标注「本机活动仅保存在此设备」，换设备或清理浏览器数据后会消失；
  读取时会做一次字段归一化，旧记录缺字段也不会让列表崩掉。

## 登录

右上角提供 GitHub 与 Google 登录。凭据按环境注入：没有配置时入口仍然显示，但会明确标出「未配置」并说明缺少什么，不会把访问者送进服务商的错误页。

需要的环境变量见 `.env.example`：

| 变量 | 说明 |
| --- | --- |
| `AUTH_SECRET` | **必填**，会话 cookie 的签名密钥，用 `npx auth secret` 生成 |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App 的 Client ID 与 Client Secret |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth 2.0 客户端的客户端 ID 与客户端密钥 |

`AUTH_SECRET` 缺失时 Auth.js 会在 `/api/auth/error` 抛出 `Configuration` 错误，只配服务商凭据是不够的。缺少哪一项会直接显示在登录弹窗和错误页上，不需要去翻服务端日志。

至少配齐一个服务商的凭据加 `AUTH_SECRET`，登录才会启用；只配了其中一家时，另一家的按钮会置灰并标注「未配置」。

### 注册 OAuth 应用

GitHub 在 Settings → Developer settings → OAuth Apps → New OAuth App 创建，Authorization callback URL 填 `https://hangkathon.net/api/auth/callback/github`。

Google 在 Google Cloud Console → API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID（Web 应用）创建，已获授权的重定向 URI 填 `https://hangkathon.net/api/auth/callback/google`。

本地开发要另外注册一组回调地址为 `http://localhost:5175/api/auth/callback/github`（Google 同理）的应用，或者把本地地址一并加进同一个应用的回调列表。

### 在 Vercel 配置

Project → Settings → Environment Variables，把上面几个变量加到 Production；需要预览部署也能登录的话再加到 Preview。加完重新部署一次。

会话仍是签名 cookie（JWT，不落库）。有数据库的部署里，登录身份用于把报名/作品/邀请归属到具体账号（`users` 表按 email upsert）；
没有数据库的部署里，登录状态只用于识别身份，不写入任何存储。前端通过 `GET /api/session` 拿到「是否已配置 / 有哪些服务商 / 当前登录者 / 这个部署有没有数据库」。

## 视觉来源

用户最新提供的蓝金色杭州参考图（hangzhou-upgrade-reference.png）用于桥体投影材质及局部背景。`public/assets/hangzhou-upgrade-background.png` 为基于同一参考图清除界面与桥体后的背景图。桥为实时三维网格；远景为图片；水面交互为实时着色器。

导航品牌图与浏览器图标来自用户单独提供的「杭客松 Hangkathon」Logo，派生为 `public/brand/` 下的独立透明资源，不再从参考图坐标裁片。顶栏用两版：首页顶栏透明、叠在深色 hero 上，用银色原稿 `hangkathon-logo.png`；二级页是白底，用深墨绿版 `hangkathon-logo-teal.png`（由 `scripts/derive-header-wordmark.py` 从 `hangkathon-logo-teal-source.png` 紧裁派生，白底对比度约 5.7）。

## 范围

登录、报名、作品提交、活动创建都已可用；**没有**支付与审核入库流程，所以贡献值与奖金分发仍是机制定义、库里没有已核验记录（`CONTRIBUTIONS` 为空对象）。自托管那份的数据在服务端 Postgres，Vercel 那份在本机 localStorage。详见 `design-qa.md` 与 `deploy/README.md`。
