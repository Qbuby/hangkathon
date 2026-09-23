"use client";

import { useLayoutEffect, useRef } from "react";
import { animate, createScope, stagger, utils, type Scope } from "animejs";
import { MOTION, PAGE_ROOTS, REDUCED_QUERY, REVEAL_ITEM, revealPlan, type RevealPlan, type MotionPage } from "./motion";

/**
 * 页面入场动效：按 [data-reveal] 在 DOM 里的顺序错峰淡入上移。
 * 首屏的隐藏初态由 CSS 在 html[data-motion="on"] 下提供（见 motion.css，窗口很短），
 * 这里负责在绘制前设回隐藏并播放动画，所以两条路径都不会闪。
 */

/** 顶层 [data-reveal]：跳过被别的 [data-reveal] 包住的，避免父子重复淡入。 */
function revealTargets(root: Element, mode: "all" | "items"): HTMLElement[] {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  return nodes.filter((node) => {
    if (node.closest("[data-reveal]") !== node) return false;
    if (mode === "items" && node.dataset.reveal !== REVEAL_ITEM) return false;
    return true;
  });
}

function play(nodes: HTMLElement[], plan: RevealPlan | null) {
  if (!plan || !nodes.length) return;
  utils.set(nodes, { opacity: 0, translateY: plan.distance });
  animate(nodes, {
    opacity: 1,
    translateY: 0,
    duration: plan.duration,
    delay: stagger(plan.stagger),
    ease: plan.ease,
  });
}

type MotionOptions = {
  /** 数据签名；变化时只重播 [data-reveal="item"]（筛选、排序、切步骤）。 */
  signature?: string;
  /** 内容是否已经就绪；false 时先不播，等它变 true（详情页、个人主页要先读数据）。 */
  ready?: boolean;
};

/**
 * @param page 页面标识，决定动效作用范围（根选择器见 PAGE_ROOTS）
 */
export function usePageMotion(page: MotionPage, { signature, ready = true }: MotionOptions = {}) {
  const scopeRef = useRef<Scope | null>(null);
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(PAGE_ROOTS[page]);
    if (!root) return;
    const scope = createScope({ root, mediaQueries: { reduced: REDUCED_QUERY } });
    scopeRef.current = scope;
    return () => {
      scope.revert();
      scopeRef.current = null;
    };
  }, [page]);

  // 首次入场：等内容就绪后在绘制前设初态并播放。
  useLayoutEffect(() => {
    if (!ready || mountedRef.current) return;
    const scope = scopeRef.current;
    const root = document.querySelector<HTMLElement>(PAGE_ROOTS[page]);
    if (!scope || !root) return;
    mountedRef.current = true;
    scope.execute(() => {
      play(revealTargets(root, "all"), revealPlan({ reduced: scope.matches.reduced, page }));
    });
  }, [page, ready]);

  // 数据变化：只重播 item 那一档。
  const previous = useRef<string | undefined>(signature);
  useLayoutEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    if (!mountedRef.current) return;
    const scope = scopeRef.current;
    const root = document.querySelector<HTMLElement>(PAGE_ROOTS[page]);
    if (!scope || !root) return;
    // matches 只在 execute 内刷新，所以判定与播放都放进去。
    scope.execute(() => {
      play(revealTargets(root, "items"), revealPlan({ reduced: scope.matches.reduced, page }));
    });
  }, [page, signature]);
}

/** 页面是否处于「减少动效」：给需要自己处理动画的地方用。 */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

/** 单个元素的一次性入场（例如列表里新增的一条）。 */
export function revealOnce(node: HTMLElement) {
  if (prefersReducedMotion()) return;
  utils.set(node, { opacity: 0, translateY: MOTION.distance });
  animate(node, { opacity: 1, translateY: 0, duration: MOTION.duration, ease: MOTION.ease });
}
