import Link from "next/link";
import { ArrowRight, Box, Cpu, NotebookText, UsersRound } from "lucide-react";
import BridgeScene from "./scene";
import SiteHeader from "./site-header";
import JsonLd from "./json-ld";
import { graph, organizationNode, websiteNode } from "@/lib/seo/schema";

/**
 * 首页的结构化数据在**服务端注入**：这个文件本身是 use client（要跑三维场景与水合），
 * 但 <script type="application/ld+json"> 由 JsonLd 组件在服务端渲染时就写进 HTML。
 * 之前这段数据写死在客户端组件里，靠水合后才出现在 DOM —— 不执行 JS 的爬虫
 * （GPTBot / PerplexityBot 等）读不到，Google 也会推迟处理。
 */
const HOME_JSON_LD = graph([websiteNode(), organizationNode()]);

/**
 * 英雄区下方那四块能力说明。
 *
 * 为什么把 <strong> 换成 <h2>：这四块是首页正文里唯一有信息量的文字，
 * 而原来整页只有 h1、没有 h2 —— 页面结构与内容层次对搜索引擎与 AI 摘要都是空白的。
 * 每块保留一句说明文字（不是只有关键词），这样它们可以直接被摘要引用。
 * 视觉不受影响：.hero-feature strong 的样式规则同时作用于 h2（选择器已覆盖）。
 */
const FEATURES = [
  { Icon: Cpu, title: "算力与数据", note: "探索 AI 计算资源" },
  { Icon: Box, title: "模型与开源", note: "连接全球开源生态" },
  { Icon: NotebookText, title: "真实赛题", note: "面向产业的实际问题" },
  { Icon: UsersRound, title: "共创社区", note: "开发者 · 企业 · 创造者" },
];

export default function Home() {
  return (
    <main id="top">
      <JsonLd data={HOME_JSON_LD} />
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
        {/*
          hero-bottom 是首页正文里唯一的文字内容块，所以它必须既对爬虫可读、也对辅助技术可读。
          原先这里是 div + strong/small，整页只有 h1、没有 h2：页面的内容层次在结构化分析里
          是空的，四个能力点也无法被摘要单独引用。
          现在用 h2 + p 的真实结构（CSS 已同步为 h2/p 选择器）。
          刻意**不加** aria-hidden：加了会把整块内容从辅助技术里抹掉，
          而它本来就是页面的可见正文，不是纯装饰。
        */}
        <div className="hero-bottom">
          {FEATURES.map(({ Icon, title, note }) => (
            <div className="hero-feature" key={title}>
              <Icon />
              <span>
                <h2>{title}</h2>
                <p>{note}</p>
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
