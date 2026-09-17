# 杭客松首页 Demo

一个用 React 与 Three.js 构建的首页体验。桥体保持固定，鼠标悬停或划过水面产生涟漪，支持暂停和平静水面。包含三个明确标注为演示数据的活动入口与说明弹窗。

## 运行

使用 Node.js 22.13+。安装依赖后运行 `npm run dev`。`npm run build` 生成 Sites 兼容构建。

## 部署

仓库同时支持两个目标，`npm run build` 会按宿主环境自动选择：

- **Vercel**：Vercel 在 Next.js 项目下优先执行 package.json 的 `build` 脚本，而不是 `next build`，所以它会拿到 Vinext 产出的 `dist/`，没有 `.next` 可服务，部署显示 Ready 但全站 404。构建脚本检测到 `VERCEL=1` 时改走标准 `next build`，输出 `.next`。`vercel.json` 也显式声明了 `framework` 与 `buildCommand`，即使后台 Override 被打开也仍然正确。
- **Cloudflare / OpenAI Sites**：`npm run build` 在本地照旧运行 Vinext 构建，输出 `dist/server/wrangler.json`，由 `npm start` 通过 Wrangler 启动。

单独触发某一目标时用 `npm run build:vercel` 或 `npm run build:cloudflare`。

## 视觉来源

用户最新提供的蓝金色杭州参考图（hangzhou-upgrade-reference.png）用于桥体投影材质及局部背景。`public/assets/hangzhou-upgrade-background.png` 为基于同一参考图清除界面与桥体后的背景图。桥为实时三维网格；远景为图片；水面交互为实时着色器。

导航品牌图与浏览器图标来自用户单独提供的「杭客松 Hangkathon」Logo，派生为 `public/brand/` 下的独立透明资源，不再从参考图坐标裁片。

## 范围

没有账号、报名提交、支付或数据库。活动与作品入口为明确标注的演示。详见 `design-qa.md`。
