"use client";

import { useEffect, useState } from "react";
import ActivityBoard from "../activity-board";
import SiteHeader from "../site-header";
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
      <SiteHeader />
      <div className="activities-wrap">
        <ActivityBoard activities={[...created, ...DEMO_ACTIVITIES]} localCount={created.length} />
      </div>
    </main>
  );
}
