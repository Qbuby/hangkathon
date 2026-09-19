"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ArrowRight, X, Cpu, Box, NotebookText, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { loadActivities, type Activity } from "@/lib/activity";
import { DEMO_ACTIVITIES } from "@/lib/demo-activities";
import AboutSection from "./about-section";
import ActivityBoard from "./activity-board";
import BridgeScene from "./scene";
import SessionMenu from "./session-menu";

const info = {
  compute: { label: "DATA & COMPUTE", title: "数算：算力与数据，在这里汇聚。", text: "数算入口将汇集可用的算力资源、数据集与开源模型，让一个想法不必卡在资源这一步。", note: "数算区为占位内容，目前没有接入任何算力或数据服务。" },
  language: { label: "LANGUAGE", title: "英文版本正在筹备。", text: "当前首页提供中文体验。", note: "此入口为语言切换演示，尚未开放英文内容。" },
};
type Panel = keyof typeof info | null;

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

  const boardActivities = useMemo(() => [...created, ...DEMO_ACTIVITIES], [created]);
  const content = panel ? info[panel] : null;

  return (
    <main id="top">
      <a className="skip-link" href="#activities">跳转到活动看板</a>
      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="杭客松首页"><Image className="wordmark-image" src="/brand/hangkathon-logo.png" alt="杭客松 Hangkathon" width={1400} height={468} priority draggable={false} /></a>
        <nav aria-label="主导航">
          <a href="#top" className="nav-home">首页</a>
          <Link href="/leaderboard">算力榜</Link>
        </nav>
        <div className="header-actions"><button className="language-control" onClick={() => setPanel("language")} aria-label="语言，当前为中文"><strong>中</strong><span>/ EN</span></button><SessionMenu /></div>
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
          <button className="hero-feature" onClick={() => setPanel("compute")}><Box /><span><strong>模型与开源</strong><small>连接全球开源生态</small></span></button>
          <Link className="hero-feature" href="/create"><NotebookText /><span><strong>真实需求</strong><small>面向产业的实际问题</small></span></Link>
          <a className="hero-feature" href="#about"><UsersRound /><span><strong>共创社区</strong><small>开发者 · 企业 · 创造者</small></span></a>
        </div>
      </section>

      <ActivityBoard activities={boardActivities} localCount={created.length} />

      <AboutSection />

      <footer className="site-footer"><a href="#top" className="footer-brand">杭客松<span>.</span></a><p>世界 AI 上杭州</p><span>首页体验 DEMO</span><a href="#top" aria-label="回到顶部"><ArrowUpRight size={18} /></a></footer>

      <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}>
        <DialogContent className="detail-dialog" showCloseButton={false}>
          <DialogClose asChild><Button variant="ghost" className="dialog-close" aria-label="关闭详情"><X size={20} /></Button></DialogClose>
          <p className="eyebrow">{content?.label}</p>
          <DialogTitle className="dialog-title">{content?.title}</DialogTitle>
          <DialogDescription className="dialog-description">{content?.text}</DialogDescription>
          <div className="dialog-note"><span>当前状态</span><p>{content?.note}</p></div>
          <DialogClose asChild><Button className="dialog-done">返回首页体验 <ArrowRight size={16} /></Button></DialogClose>
        </DialogContent>
      </Dialog>
    </main>
  );
}
