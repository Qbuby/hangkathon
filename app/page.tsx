"use client";

import Link from "next/link";
import { ArrowRight, NotebookText, UsersRound } from "lucide-react";
import BridgeScene from "./scene";
import SiteHeader from "./site-header";

export default function Home() {
  return (
    <main id="top">
      <Link className="skip-link" href="/activities">跳转到活动看板</Link>
      <SiteHeader transparent />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title"><span>世界 <em>AI</em> 上杭州</span></h1>
          <div className="hero-actions">
            <Link className="primary-action" href="/activities">探索活动 <ArrowRight size={20} /></Link>
            <Link className="secondary-action" href="/create">发起活动 <ArrowRight size={19} /></Link>
          </div>
        </div>
        <div className="sculpture-wrap">
          <BridgeScene />
        </div>
        <div className="hero-bottom" aria-hidden="true">
          <div className="hero-feature"><NotebookText /><span><strong>发起活动</strong><small>发布真实挑战</small></span></div>
          <div className="hero-feature"><UsersRound /><span><strong>共创社区</strong><small>开发者 · 企业 · 创造者</small></span></div>
        </div>
      </section>
    </main>
  );
}
