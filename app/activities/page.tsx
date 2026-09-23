"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import ActivityBoard from "../activity-board";
import SiteHeader from "../site-header";
import { Button } from "@/components/ui/button";
import { loadActivities, type Activity } from "@/lib/activity";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
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
      <SiteHeader />
      <div className="activities-wrap">
        <ActivityBoard
          activities={[...PUBLISHED_ACTIVITIES, ...created]}
          localCount={created.length}
          action={<Button asChild className="primary-action"><Link href="/create">发起活动 <ArrowUpRight size={19} /></Link></Button>}
        />
      </div>
    </main>
  );
}
