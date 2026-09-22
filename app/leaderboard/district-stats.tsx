"use client";

import { useEffect, useState } from "react";
import { loadActivities, type Activity } from "@/lib/activity";
import { DEMO_ACTIVITIES } from "@/lib/demo-activities";
import { FACTIONS } from "@/lib/factions";

/** 区的活动数统计：13 个官方区各名下有多少场活动（本机创建 + 演示数据）。区不计入贡献统计。 */
export default function DistrictStats() {
  const [local, setLocal] = useState<Activity[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setLocal(loadActivities().filter((item) => item.visibility === "public")), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const activities = [...local, ...DEMO_ACTIVITIES];

  return (
    <div className="district-stats">
      {FACTIONS.map((district) => {
        const count = activities.filter((activity) => activity.district === district.id).length;
        return (
          <div className="district-stat" key={district.id}>
            <span className="faction-dot" style={{ background: district.color }} />
            <strong>{district.name}</strong>
            <span>{count} 场活动</span>
          </div>
        );
      })}
    </div>
  );
}
