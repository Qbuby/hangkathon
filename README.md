# 杭客松首页 Demo

一个用 React 与 Three.js 构建的首页体验。桥体保持固定，鼠标悬停或划过水面产生涟漪；键盘空格键泛起涟漪，Home 键使水面平静。包含三个明确标注为演示数据的活动入口与说明弹窗。

## 运行

使用 Node.js 22.13+。安装依赖后运行 `npm run dev`。`npm run build` 生成 Sites 兼容构建。

## 部署

仓库同时支持两个目标，`npm run build` 会按宿主环境自动选择：

- **Vercel**：Vercel 在 Next.js 项目下优先执行 package.json 的 `build` 脚本，而不是 `next build`，所以它会拿到 Vinext 产出的 `dist/`，没有 `.next` 可服务，部署显示 Ready 但全站 404。构建脚本检测到 `VERCEL=1` 时改走标准 `next build`，输出 `.next`。`vercel.json` 也显式声明了 `framework` 与 `buildCommand`，即使后台 Override 被打开也仍然正确。
- **Cloudflare / OpenAI Sites**：`npm run build` 在本地照旧运行 Vinext 构建，输出 `dist/server/wrangler.json`，由 `npm start` 通过 Wrangler 启动。

单独触发某一目标时用 `npm run build:vercel` 或 `npm run build:cloudflare`。

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

没有数据库：会话是签名 cookie，登录状态只用于识别身份，不写入任何存储。前端通过 `GET /api/session` 拿到「是否已配置 / 有哪些服务商 / 当前登录者」。

## 视觉来源

用户最新提供的蓝金色杭州参考图（hangzhou-upgrade-reference.png）用于桥体投影材质及局部背景。`public/assets/hangzhou-upgrade-background.png` 为基于同一参考图清除界面与桥体后的背景图。桥为实时三维网格；远景为图片；水面交互为实时着色器。

导航品牌图与浏览器图标来自用户单独提供的「杭客松 Hangkathon」Logo，派生为 `public/brand/` 下的独立透明资源，不再从参考图坐标裁片。

## 范围

没有账号、报名提交、支付或数据库。活动与作品入口为明确标注的演示。详见 `design-qa.md`。
