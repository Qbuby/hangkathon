"use client";

import { useEffect, useState } from "react";

type SessionState = {
  user: { name: string | null; email: string | null } | null;
};

/** 榜单下方登录用户自己的条目：真实起点 0 贡献值，进入前十即可上榜。 */
export default function YourEntry() {
  const [session, setSession] = useState<SessionState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as SessionState;
        if (!cancelled) setSession(data);
      } catch {
        /* 未登录态保持隐藏 */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const user = session?.user ?? null;
  if (!user) return null;

  return (
    <div className="lb-you">
      <span className="lb-you-tag">你</span>
      <div className="lb-you-main">
        <strong>{user.name ?? user.email}</strong>
        <span>平台贡献值 0 · 完成活动后开始累计</span>
      </div>
      <span className="lb-you-state">未进入前十</span>
    </div>
  );
}
