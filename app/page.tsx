"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ArrowRight, X, Cpu, Box, NotebookText, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { formatLabel, loadActivities, pricingLabel, type Activity } from "@/lib/activity";
import BridgeScene from "./scene";
import SessionMenu from "./session-menu";

type Row = {
  type: string;
  title: string;
  name: string;
  description: string;
  tag: string;
  details: string;
  custom?: Activity;
};

const demoRows: Row[] = [
  { type: "AI HANGKATHON", title: "把想法，做成第一个原型。", name: "AI 创造者杭客松", description: "从一个灵感出发，和不同背景的队友一起，把 AI 想法变成可体验的作品。", tag: "组队共创", details: "示例流程：灵感交流 → 自由组队 → 原型共创 → 作品展示。具体时间、地点及报名方式尚未设置。" },
  { type: "REAL-WORLD ACTIVITY", title: "让真实问题，遇见新解法。", name: "真实需求共创", description: "围绕具体使用场景，拆解问题、验证思路，探索 AI 在真实需求中的可能。", tag: "问题驱动", details: "示例流程：理解需求 → 拆解场景 → 方案验证 → 原型反馈。此处没有已发布的真实需求。" },
  { type: "BUILD & SHARE", title: "带上作品，遇见同路人。", name: "作品交流开放日", description: "分享你正在做的东西，交换灵感与反馈，也找到下一次一起动手的人。", tag: "交流分享", details: "示例流程：介绍作品 → 现场体验 → 交流反馈。此处没有已确定的分享嘉宾或活动安排。" },
];

function activityRow(activity: Activity): Row {
  const where = activity.format === "offline" ? `地点：${activity.venue}。` : "线上参与。";
  const criteria = activity.criteria.map((c) => `${c.name} ${c.weight}%`).join("、");
  return {
    type: `${formatLabel(activity)} · ${pricingLabel(activity)}`,
    title: activity.subtitle,
    name: activity.title,
    description: activity.overview || activity.subtitle,
    tag: activity.pricing === "free" ? "免费" : "收费",
    details: `主办方：${activity.host}。时间：${activity.startsAt} 至 ${activity.endsAt}。每队最多 ${activity.maxTeamSize} 人。${where}评审维度：${criteria || "未设置"}。`,
    custom: activity,
  };
}

const info = {
  plaza: { label: "PLAZA", title: "广场，让作品和人在这里相遇。", text: "广场将聚集创造者做出的 AI 原型与作品，也聚集正在找队友的活动。每一个可体验的想法，都值得被看见。", note: "广场为占位内容，目前没有上架作品，也没有公开活动。" },
  compute: { label: "DATA & COMPUTE", title: "数算：算力与数据，在这里汇聚。", text: "数算入口将汇集可用的算力资源、数据集与开源模型，让一个想法不必卡在资源这一步。", note: "数算区为占位内容，目前没有接入任何算力或数据服务。" },
  language: { label: "LANGUAGE", title: "英文版本正在筹备。", text: "当前首页提供中文体验。", note: "此入口为语言切换演示，尚未开放英文内容。" },
  about: { label: "ABOUT HANGKESONG", title: "在杭州，连接想法与行动。", text: "杭客松连接 AI 创造者、企业真实需求和城市里的活动。我们希望让人们找到队友，围绕具体问题，一起把想法做出来。", note: "此网站为首页 Demo，活动内容均为演示数据。" },
};
type Panel = keyof typeof info | number | null;

export default function Home() {
  const [panel, setPanel] = useState<Panel>(null);
  const [created, setCreated] = useState<Activity[]>([]);

  // Activities created on this device live in localStorage until a database exists.
  useEffect(() => {
    const load = () => setCreated(loadActivities().filter((activity) => activity.visibility === "public"));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  const rows = useMemo(
    () => [...created.map(activityRow), ...demoRows].map((row, index) => ({ ...row, number: String(index + 1).padStart(2, "0") })),
    [created],
  );

  const event = typeof panel === "number" ? rows[panel] : null;
  const content = typeof panel === "string" ? info[panel] : null;
  return (
    <main id="top">
      <a className="skip-link" href="#activities">跳转到活动</a>
      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="杭客松首页"><Image className="wordmark-image" src="/brand/hangkathon-logo.png" alt="杭客松 Hangkathon" width={1400} height={468} priority draggable={false} /></a>
        <nav aria-label="主导航">
          <a className="nav-active" href="#activities">AI 活动</a>
          <button onClick={() => setPanel("plaza")}>广场</button>
          <button onClick={() => setPanel("compute")}>数算</button>
        </nav>
        <div className="header-actions"><Link className="header-create" href="/create">发起活动 <ArrowUpRight size={18} /></Link><button className="language-control" onClick={() => setPanel("language")} aria-label="语言，当前为中文"><strong>中</strong><span>/ EN</span></button><SessionMenu /></div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title"><span>世界 <em>AI</em> 上杭州</span></h1>
          <div className="hero-actions">
            <Button asChild className="primary-action"><a href="#activities">探索活动 <ArrowRight size={20} /></a></Button>
            <Button asChild variant="ghost" className="secondary-action"><Link href="/create">发起活动 <ArrowUpRight size={19} /></Link></Button>
          </div>
        </div>
        <div className="sculpture-wrap">
          <BridgeScene />
        </div>
        <div className="hero-bottom">
          <button className="hero-feature" onClick={() => setPanel("compute")}><Cpu /><span><strong>算力与数据</strong><small>探索 AI 计算资源</small></span></button>
          <button className="hero-feature" onClick={() => setPanel("about")}><Box /><span><strong>模型与开源</strong><small>连接全球开源生态</small></span></button>
          <Link className="hero-feature" href="/create"><NotebookText /><span><strong>真实需求</strong><small>面向产业的实际问题</small></span></Link>
          <button className="hero-feature" onClick={() => setPanel("about")}><UsersRound /><span><strong>共创社区</strong><small>开发者 · 企业 · 创造者</small></span></button>
          <a className="scroll-explore" href="#activities"><span><ArrowRight size={22} /></span><strong>了解更多</strong></a>
        </div>
      </section>

      <section id="activities" className="activities" aria-labelledby="activities-title">
        <div className="section-topline"><p className="eyebrow">MEET. BUILD. MAKE IT REAL.</p><span className="demo-label">{created.length > 0 ? "含本机创建 · 未同步到服务器" : "演示数据 · 非真实活动"}</span></div>
        <div className="section-heading"><h2 id="activities-title">下一次创造，从这里开始。</h2><p>找到队友，围绕真实问题，做出自己的作品。</p></div>
        <div className="event-list">
          {rows.map((e, i) => <button className="event-row" key={`${e.number}-${e.name}`} onClick={() => setPanel(i)} aria-label={`查看${e.name}详情`}><span className="event-number">{e.number}</span><div className="event-main"><span className="event-type">{e.type}</span><h3>{e.name}</h3></div><p className="event-caption">{e.title}</p><span className="event-tag">{e.tag}</span><span className="event-arrow"><ArrowUpRight size={20} /></span></button>)}
        </div>
        <p className="data-note">以上内容仅用于展示活动入口，不代表已举办、已开放报名或已有合作方。{created.length > 0 && " 由你在本机创建的活动保存在这台设备的浏览器里，尚未同步到服务器。"}</p>
      </section>

      <footer className="site-footer"><a href="#top" className="footer-brand">杭客松<span>.</span></a><p>世界 AI 上杭州</p><span>首页体验 DEMO</span><a href="#top" aria-label="回到顶部"><ArrowUpRight size={18} /></a></footer>

      <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}>
        <DialogContent className="detail-dialog" showCloseButton={false}>
          <DialogClose asChild><Button variant="ghost" className="dialog-close" aria-label="关闭详情"><X size={20} /></Button></DialogClose>
          <p className="eyebrow">{event ? event.type : content?.label}</p>
          <DialogTitle className="dialog-title">{event ? event.name : content?.title}</DialogTitle>
          <DialogDescription className="dialog-description">{event ? event.description : content?.text}</DialogDescription>
          <div className="dialog-note"><span>{event ? (event.custom ? "本机创建" : "演示数据") : "当前状态"}</span><p>{event ? (event.custom ? `${event.details} 这场活动保存在这台设备的浏览器里，尚未同步到服务器，也没有真实的报名入口。` : `${event.details} 当前仅展示示例内容，未开放报名。`) : content?.note}</p></div>
          <DialogClose asChild><Button className="dialog-done">返回首页体验 <ArrowRight size={16} /></Button></DialogClose>
        </DialogContent>
      </Dialog>
    </main>
  );
}
