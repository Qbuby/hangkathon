"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import ActivityBoard from "../activity-board";
import GlobalEvents from "../global-events";
import SiteHeader from "../site-header";
import { Button } from "@/components/ui/button";
import { listActivities, listGlobalEvents, type ActivityView } from "@/lib/api/data";
import { eventScope, type ExternalEvent } from "@/lib/external-events";

/** 本地赛事板块里外部平台活动的展示上限（数据全量入库，只挑最近的）。 */
const LOCAL_EVENTS_LIMIT = 20;
import { hasServerData } from "@/lib/api/client";
import "./activities.css";

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"local" | "server">("local");
  const [globalEvents, setGlobalEvents] = useState<ExternalEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);

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
    void listGlobalEvents()
      .then((list) => {
        if (!cancelled) setGlobalEvents(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEventsLoaded(true);
      });
    const reload = () => {
      void listActivities().then((list) => setActivities(list)).catch(() => {});
      void listGlobalEvents().then((list) => setGlobalEvents(list)).catch(() => {});
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
          localEvents={globalEvents
            .filter((event) => eventScope(event.source) === "local")
            // 接口已按开始日期升序返回，取最近的 20 场
            .slice(0, LOCAL_EVENTS_LIMIT)}
          mode={mode}
          loaded={loaded}
          action={<Button asChild className="primary-action"><Link href="/create">发起活动 <ArrowUpRight size={19} /></Link></Button>}
        />
        <GlobalEvents events={globalEvents.filter((event) => eventScope(event.source) === "global")} eventsLoaded={eventsLoaded} />
      </div>
    </main>
  );
}
