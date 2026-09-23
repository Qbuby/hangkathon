"use client";

import { useEffect, useState } from "react";
import { listActivities, type ActivityView } from "@/lib/api/data";
import { FACTIONS } from "@/lib/factions";

/** 区的活动数统计：13 个官方区各名下有多少场活动。区不计入贡献统计。 */
export default function DistrictStats() {
  const [activities, setActivities] = useState<ActivityView[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listActivities()
      .then((list) => {
        if (!cancelled) setActivities(list.filter((item) => item.visibility === "public"));
      })
      .catch(() => {
        if (!cancelled) setActivities([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
