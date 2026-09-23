"use client";

import Image from "next/image";
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
  // 两版 wordmark 同尺寸同 alpha：银色原稿是给深色 hero 画的，压在白底上只有 1.4 的
  // 对比度，所以二级页用深色版（派生方式见 scripts/derive-dark-wordmark.py）。
  const logoSrc = transparent ? "/brand/hangkathon-logo.png" : "/brand/hangkathon-logo-dark.png";

  return (
    <header
      className={transparent ? "site-header is-transparent" : "site-header"}
      style={transparent ? { background: "transparent", backdropFilter: "none", borderBottomColor: "transparent", mixBlendMode: "lighten" } : undefined}
    >
      <Link href="/" className="wordmark" aria-label="杭客松首页"><Image className="wordmark-image" src={logoSrc} alt="杭客松 Hangkathon" width={1400} height={468} priority draggable={false} /></Link>
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
