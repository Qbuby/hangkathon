"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ActivityBoard from "../activity-board";
import { loadActivities, type Activity } from "@/lib/activity";
import { DEMO_ACTIVITIES } from "@/lib/demo-activities";
import "./activities.css";

export default function ActivitiesPage() {
  const [created, setCreated] = useState<Activity[]>([]);

  // Activities created on this device live in localStorage until a database exists.
  useEffect(() => {
    const load = () => setCreated(loadActivities().filter((activity) => activity.visibility === "public"));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  return (
    <main className="activities-page">
      <header className="detail-top">
        <Link className="detail-back" href="/"><ArrowLeft size={17} /> 返回首页</Link>
        <span className="detail-top-title">活动看板</span>
        <span className="detail-top-note">杭客松</span>
      </header>
      <div className="activities-wrap">
        <ActivityBoard activities={[...created, ...DEMO_ACTIVITIES]} localCount={created.length} />
      </div>
    </main>
  );
}
