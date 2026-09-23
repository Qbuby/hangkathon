"use client";

import { usePageMotion } from "./motion-scope";
import type { MotionPage } from "./motion";

/** 服务端页面用它挂入场动效：不渲染任何内容，只在客户端跑动画。 */
export default function PageMotion({ page, signature, ready }: { page: MotionPage; signature?: string; ready?: boolean }) {
  usePageMotion(page, { signature, ready });
  return null;
}
