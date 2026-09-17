# 杭客松首页 Demo

一个用 React 与 Three.js 构建的首页体验。桥体保持固定，鼠标悬停或划过水面产生涟漪，支持暂停和平静水面。包含三个明确标注为演示数据的活动入口与说明弹窗。

## 运行

使用 Node.js 22.13+。安装依赖后运行 `npm run dev`。`npm run build` 生成 Sites 兼容构建。

## 视觉来源

用户最新提供的蓝金色杭州参考图（hangzhou-upgrade-reference.png）用于桥体投影材质、标志及局部背景。`public/assets/hangzhou-upgrade-background.png` 为基于同一参考图清除界面与桥体后的背景图。桥为实时三维网格；远景为图片；水面交互为实时着色器。

## 范围

没有账号、报名提交、支付或数据库。活动、挑战与作品入口为明确标注的演示。详见 `design-qa.md`。
