/* eslint-disable */
// 入场动效引导（app/motion.ts 的 MOTION_BOOT 的静态外置版）：
// CSP nonce 化后内联脚本不再被允许，而这段必须在首帧前同步执行以设置 data-motion，
// 所以放 public 由 <script src> 阻塞加载（同源、tiny）。常量与 app/motion.ts 保持一致，
// scripts/motion.test.mjs 会校验两者不漂移（按代码体逐字符比对）。
(function(){var d=document.documentElement;try{if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.setAttribute("data-motion","on");setTimeout(function(){d.removeAttribute("data-motion");},1400);}catch(e){d.removeAttribute("data-motion");}})();
