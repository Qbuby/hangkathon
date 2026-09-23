"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import ActivityBoard from "../activity-board";
import SiteHeader from "../site-header";
import { Button } from "@/components/ui/button";
import { listActivities, type ActivityView } from "@/lib/api/data";
import { hasServerData } from "@/lib/api/client";
import "./activities.css";

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"local" | "server">("local");

  // 有数据库的部署走 /api/activities；没有数据库的部署（Vercel）回落到本机记录。
  useEffect(() => {
    let cancelled = false;
    void hasServerData().then((server) => {
      if (!cancelled) setMode(server ? "server" : "local");
    });
    void listActivities()
      .then((list) => {
        if (!cancelled) setActivities(list);
      })
      .catch(() => {
        if (!cancelled) setActivities([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    const reload = () => {
      void listActivities().then((list) => setActivities(list)).catch(() => {});
    };
    window.addEventListener("focus", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", reload);
    };
  }, []);

  return (
    <main className="activities-page">
      <SiteHeader />
      <div className="activities-wrap">
        <ActivityBoard
          activities={activities}
          mode={mode}
          loaded={loaded}
          action={<Button asChild className="primary-action"><Link href="/create">发起活动 <ArrowUpRight size={19} /></Link></Button>}
        />
      </div>
    </main>
  );
}
