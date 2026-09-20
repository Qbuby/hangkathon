"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, X, Cpu, Box, NotebookText, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import BridgeScene from "./scene";
import SiteHeader from "./site-header";

const info = {
  compute: { label: "DATA & COMPUTE", title: "数算：算力与数据，在这里汇聚。", text: "数算入口将汇集可用的算力资源、数据集与开源模型，让一个想法不必卡在资源这一步。", note: "数算区为占位内容，目前没有接入任何算力或数据服务。" },
};
type Panel = keyof typeof info | null;

export default function Home() {
  const [panel, setPanel] = useState<Panel>(null);
  const content = panel ? info[panel] : null;

  return (
    <main id="top">
      <Link className="skip-link" href="/activities">跳转到活动看板</Link>
      <SiteHeader />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title"><span>世界 <em>AI</em> 上杭州</span></h1>
          <div className="hero-actions">
            <Button asChild className="primary-action"><Link href="/activities">探索活动 <ArrowRight size={20} /></Link></Button>
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
          <Link className="hero-feature" href="/activities"><UsersRound /><span><strong>共创社区</strong><small>开发者 · 企业 · 创造者</small></span></Link>
        </div>
      </section>

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
