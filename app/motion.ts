/**
 * 全站入场动效的统一参数与计划。首页不参与（已有 Three.js 场景在跑）。
 * 这里只放常量与纯函数，动画本身在 motion-scope.tsx 里跑，方便单测。
 */

export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** 中等强度、全站一致：单条 420ms、错峰 55ms、位移 12px。 */
export const MOTION = {
  duration: 420,
  stagger: 55,
  distance: 12,
  ease: "out(3)",
  /**
   * CSS 隐藏初态只在这个窗口内生效。窗口一过就无条件放开，
   * 所以挂载之后才渲染出来的内容（筛选结果、详情页区块、创建成功页）
   * 绝不会被永久藏住。
   */
  windowMs: 1400,
} as const;

export type MotionPage = "board" | "detail" | "leaderboard" | "profile" | "create" | "manage" | "auth-error";

/** 每页的根选择器：动效只在该根内查找 [data-reveal]，不越界到别的页面区块。 */
export const PAGE_ROOTS: Record<MotionPage, string> = {
  board: ".activities-page",
  detail: ".detail-page",
  leaderboard: ".lb-page",
  profile: ".profile-page",
  create: ".create-page",
  manage: ".manage-page",
  "auth-error": ".auth-error",
};

export type RevealPlan = {
  root: string;
  duration: number;
  stagger: number;
  distance: number;
  ease: string;
};

/** 入场计划：reduced-motion 时返回 null，一个动画都不产生。 */
export function revealPlan({ reduced, page }: { reduced: boolean; page: MotionPage }): RevealPlan | null {
  if (reduced) return null;
  const root = PAGE_ROOTS[page];
  if (!root) return null;
  return {
    root,
    duration: MOTION.duration,
    stagger: MOTION.stagger,
    distance: MOTION.distance,
    ease: MOTION.ease,
  };
}

/** [data-reveal] 的值：block 只在页面挂载时播，item 在数据变化时重播。 */
export const REVEAL_BLOCK = "block";
export const REVEAL_ITEM = "item";

/**
 * 顶部内联脚本（在应用 JS 之前执行）：
 * 只有 JS 可用且用户没要求减少动效时，才打开隐藏初态的开关；
 * 开关在 MOTION.windowMs 后无条件摘掉，避免任何内容被永久隐藏。
 */
export const MOTION_BOOT = [
  "(function(){",
  "var d=document.documentElement;",
  "try{",
  `if(window.matchMedia&&window.matchMedia(${JSON.stringify(REDUCED_QUERY)}).matches)return;`,
  'd.setAttribute("data-motion","on");',
  `setTimeout(function(){d.removeAttribute("data-motion");},${MOTION.windowMs});`,
  '}catch(e){d.removeAttribute("data-motion");}',
  "})();",
].join("");
