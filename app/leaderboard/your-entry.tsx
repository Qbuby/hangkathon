"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { honorLevel } from "@/lib/contribution";

type SessionState = {
  user: { name: string | null; email: string | null } | null;
};

/**
 * 「我的荣誉」面板：未登录时告诉用户这里将来是什么；已登录展示当前
 * 贡献值与数字市民星级。贡献数据源接入前按 0 展示（与榜单口径一致）。
 */
export default function YourEntry() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as SessionState;
        if (!cancelled) setSession(data);
      } catch {
        /* 未登录态保持隐藏 */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  const user = session?.user ?? null;
  if (!user) {
    return (
      <div className="lb-me">
        <span className="lb-you-tag" aria-hidden="true">你</span>
        <div className="lb-you-main">
          <strong>登录后，这里就是你的荣誉面板</strong>
          <span>报名一场活动、完成一件作品，荣誉就会开始积累。</span>
        </div>
        <Link className="lb-me-cta" href="/activities">去看看活动</Link>
      </div>
    );
  }

  // 贡献结算数据源（CONTRIBUTIONS）接入前，个人荣誉按 0 起步展示
  const level = honorLevel(0);
  return (
    <div className="lb-me">
      <span className="lb-you-tag" aria-hidden="true">你</span>
      <div className="lb-you-main">
        <strong>{user.name ?? user.email}</strong>
        <span>贡献值 0 · {level.title}{"★".repeat(level.stars)}</span>
        {level.next && (
          <>
            <div className="lb-me-progress" aria-hidden="true"><i style={{ width: `${level.progress}%` }} /></div>
            <span className="lb-me-next">再积 {level.next.min.toLocaleString("zh-CN")} 贡献值，升到「{level.next.title}」</span>
          </>
        )}
      </div>
      <span className="lb-you-state">暂无排名</span>
    </div>
  );
}
