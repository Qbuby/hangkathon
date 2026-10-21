"use client";

import Image from "next/image";
import { BRAND } from "@/lib/brand";
import Link from "next/link";
import SessionMenu from "./session-menu";

/**
 * 全站统一顶栏：logo + 主导航 + 语言入口 + 账号菜单。
 * 首页与所有二级页共用，当前页面的导航项高亮。
 * transparent：首页传入，顶栏保持透明叠在 hero 场景上；二级页使用实底背景。
 */
export default function SiteHeader({ transparent = false }: { transparent?: boolean }) {
  const navItems = [
    { href: "/", label: "首页" },
    { href: "/activities", label: "活动" },
    { href: "/leaderboard", label: "排行榜" },
  ];
  // 两版 wordmark：首页用银色原稿（叠在深色 hero 上，二级页用它会糊）；二级页用深墨绿版，
  // 它在白底上对比度约 5.7，派生方式见 scripts/derive-header-wordmark.py。
  const logoSrc = transparent ? "/brand/hangkathon-logo.png" : "/brand/hangkathon-logo-teal.png";
  const logoHeight = transparent ? 468 : 450;

  return (
    <header
      className={transparent ? "site-header is-transparent" : "site-header"}
      style={transparent ? { background: "transparent", backdropFilter: "none", borderBottomColor: "transparent", mixBlendMode: "lighten" } : undefined}
    >
      <Link href="/" className="wordmark" aria-label="杭客松首页"><Image className="wordmark-image" src={logoSrc} alt={`${BRAND.zh} ${BRAND.en}`} width={1400} height={logoHeight} priority draggable={false} /></Link>
      <nav aria-label="主导航">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href}>{item.label}</Link>
        ))}
      </nav>
      <div className="header-actions">
        <span className="language-control" aria-label="英文版暂未开放" title="英文版暂未开放"><strong>中</strong><span>/ EN</span></span>
        <SessionMenu />
      </div>
    </header>
  );
}
