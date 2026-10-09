"use client";

import Link from "next/link";
import { ArrowRight, Box, Cpu, NotebookText, UsersRound } from "lucide-react";
import BridgeScene from "./scene";
import SiteHeader from "./site-header";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");

/** WebSite + Organization 结构化数据：让搜索结果能出站名、图标与品牌信息。 */
const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "杭客松",
      alternateName: "Hangkathon",
      inLanguage: "zh-CN",
      description: "连接 AI 创造者、真实需求与城市活动的杭州 AI 活动平台。",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "杭客松",
      alternateName: "Hangkathon",
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/brand/icon-512.png`,
      description: "杭州智共体人工智能科技有限公司运营的 AI 活动平台。",
    },
  ],
};

export default function Home() {
  return (
    <main id="top">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSON_LD) }}
      />
      <Link className="skip-link" href="/activities">跳转到活动列表</Link>
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
          <div className="hero-feature"><Cpu /><span><strong>算力与数据</strong><small>探索 AI 计算资源</small></span></div>
          <div className="hero-feature"><Box /><span><strong>模型与开源</strong><small>连接全球开源生态</small></span></div>
          <div className="hero-feature"><NotebookText /><span><strong>真实赛题</strong><small>面向产业的实际问题</small></span></div>
          <div className="hero-feature"><UsersRound /><span><strong>共创社区</strong><small>开发者 · 企业 · 创造者</small></span></div>
        </div>
      </section>
    </main>
  );
}
