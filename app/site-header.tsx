"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import SessionMenu from "./session-menu";

const info = {
  language: { label: "LANGUAGE", title: "英文版本正在筹备。", text: "当前首页提供中文体验。", note: "此入口为语言切换演示，尚未开放英文内容。" },
};
type Panel = keyof typeof info | null;

/**
 * 全站统一顶栏：logo + 主导航 + 语言切换 + 账号菜单。
 * 首页与所有二级页共用，当前页面的导航项高亮。
 */
export default function SiteHeader() {
  const [panel, setPanel] = useState<Panel>(null);
  const content = panel ? info[panel] : null;

  const navItems = [
    { href: "/", label: "首页" },
    { href: "/activities", label: "活动" },
    { href: "/leaderboard", label: "算力榜" },
  ];

  return (
    <header className="site-header">
      <Link href="/" className="wordmark" aria-label="杭客松首页"><Image className="wordmark-image" src="/brand/hangkathon-logo.png" alt="杭客松 Hangkathon" width={1400} height={468} priority draggable={false} /></Link>
      <nav aria-label="主导航">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>{item.label}</Link>
        ))}
      </nav>
      <div className="header-actions"><button className="language-control" onClick={() => setPanel("language")} aria-label="语言，当前为中文"><strong>中</strong><span>/ EN</span></button><SessionMenu /></div>
      <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}>
        <DialogContent className="detail-dialog" showCloseButton={false}>
          <DialogClose asChild><Button variant="ghost" className="dialog-close" aria-label="关闭详情"><X size={20} /></Button></DialogClose>
          <p className="eyebrow">{content?.label}</p>
          <DialogTitle className="dialog-title">{content?.title}</DialogTitle>
          <DialogDescription className="dialog-description">{content?.text}</DialogDescription>
          <div className="dialog-note"><span>当前状态</span><p>{content?.note}</p></div>
          <DialogClose asChild><Button className="dialog-done">返回 <ArrowRight size={16} /></Button></DialogClose>
        </DialogContent>
      </Dialog>
    </header>
  );
}
