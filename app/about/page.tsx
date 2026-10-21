import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import AboutSection from "../about-section";
import PageMotion from "../motion-mount";
import SiteHeader from "../site-header";
import JsonLd from "../json-ld";
import { FACTIONS } from "@/lib/factions";
import { BRAND } from "@/lib/brand";
import { breadcrumbNode, graph, organizationNode, webpageNode } from "@/lib/seo/schema";
import "../activities/[slug]/detail.css";
import "../about.css";

/**
 * 关于页：给搜索引擎一个能抓到实质文字的落地页。
 * 首页是零滚动的单屏 hero，可抓文本只有一百多字，长尾词很难有排名；
 * 这里把「杭客松是什么、能为谁解决什么、怎么参与」写清楚，覆盖
 * 「杭州 AI 活动」「AI 大赛」「开发者活动」这类真实搜索词。
 */
const DESCRIPTION =
  "杭客松是杭州的 AI 活动与赛事平台，连接开发者、企业与创作者：发布 AI 大赛与开发者活动，支持在线报名参赛、作品提交与荣誉榜。";

export const metadata: Metadata = {
  title: "关于杭客松 · 杭州 AI 活动与赛事平台",
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    title: "关于杭客松 · 杭州 AI 活动与赛事平台",
    description: "连接 AI 创造者、真实需求与城市活动。",
    url: "/about",
  },
};

/**
 * 关于页是最适合承载组织实体的页面 —— Organization 只在这里与首页出现，
 * 且这里能给它配上完整属性（legalName / logo / email / contactPoint）。
 * 搜索引擎与 AI 摘要读到"这家平台是谁、怎么联系"，通常在关于页取信。
 */
const ABOUT_JSON_LD = graph([
  organizationNode(),
  webpageNode({
    path: "/about",
    name: "关于杭客松",
    description: DESCRIPTION,
    type: "AboutPage",
  }),
  breadcrumbNode([
    { name: "首页", path: "/" },
    { name: "关于杭客松", path: "/about" },
  ]),
]);

const CAPABILITIES = [
  {
    title: "发起活动",
    body: "主办方可以在线创建 AI 大赛、训练营或开发者活动，设定赛题、评审规则与奖金，提交审核通过后对外公开。",
  },
  {
    title: "报名参赛",
    body: "参与者以个人身份报名，查看赛题要求与截止时间，报名后即可按活动要求提交作品。",
  },
  {
    title: "提交作品",
    body: "作品以公开链接形式提交，平台抓取作品的公开互动数据，用于活动评审与颁奖统计。",
  },
  {
    title: "荣誉榜",
    body: "按区统计活动数量与贡献值，公开个人与战队的贡献排行，让城市 AI 共创的进度可见。",
  },
];

export default function AboutPage() {
  return (
    <main className="detail-page about-page">
      <JsonLd data={ABOUT_JSON_LD} />
      <SiteHeader />
      {/* 关于页复用 detail 的动效根（.detail-page），动效只会在这页的 [data-reveal] 上生效 */}
      <PageMotion page="detail" />
      <header className="detail-hero" data-reveal="block">
        <Link className="detail-back" href="/"><ArrowLeft size={17} /> 返回首页</Link>
        <p className="detail-eyebrow" data-reveal="block">ABOUT {BRAND.upper}</p>
        <h1 data-reveal="block">关于杭客松</h1>
        <p className="detail-sub" data-reveal="block">
          杭客松是杭州的 AI 活动与赛事平台。我们把散落在城市里的 AI 大赛、开发者活动与技术社区汇到一处，
          让企业能更快找到能落地的 AI 场景，让开发者与创作者能更容易找到真实需求、找到同伴、找到作品被看见的舞台。
        </p>
      </header>

      <div className="about-content">
        <section className="about-block" aria-label="平台能做什么" data-reveal="block">
          <h2>平台能做什么</h2>
          <div className="about-cap-grid">
            {CAPABILITIES.map((item) => (
              <article key={item.title} className="about-cap">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-block" aria-label="覆盖范围" data-reveal="block">
          <h2>覆盖范围</h2>
          <p>
            活动按杭州各区归属，覆盖 {FACTIONS.map((item) => item.name).join("、")} 等区域，
            线上与线下活动都支持。活动面向开发者、企业与创作者三类人群，
            从 AI 短视频创作大赛到模型与开源的技术分享，再到城市生活场景的共创工作坊。
          </p>
        </section>

        <section className="about-block" aria-label="怎么参与" data-reveal="block">
          <h2>怎么参与</h2>
          <p>
            想参加：在活动看板找到感兴趣的活动，用微信扫码登录后即可报名与提交作品。
            想主办：进入发起活动页面填写活动信息，提交后由平台审核，通过即在活动看板公开。
          </p>
          <p className="about-actions">
            <Link className="primary-action" href="/activities">去看活动 <ArrowRight size={17} /></Link>
            <Link className="secondary-action" href="/create">发起活动 <ArrowRight size={17} /></Link>
          </p>
        </section>
      </div>

      <AboutSection />
    </main>
  );
}