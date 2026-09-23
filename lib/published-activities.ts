import type { Activity } from "./activity";

/** 已发布的杭客松活动。 */
export const PUBLISHED_ACTIVITIES: Activity[] = [
  {
    id: "midautumn_poetry",
    slug: "midautumn-poetry",
    title: "中秋诗会 · AI 写杭州",
    subtitle: "",
    overview:
      "柳永写“钱塘自古繁华”，白居易写“最忆是杭州”，苏轼写“淡妆浓抹总相宜”。这个中秋，借助AI，向千年名家发起挑战——用你的诗、词、歌、赋，写出属于今天杭州的千古名篇。",
    host: "杭客松",
    contact: "hangkathon@proton.me",
    district: "xihu",
    format: "online",
    venue: "",
    pricing: "free",
    fee: "",
    category: "creation",
    prizePool: 30000,
    startsAt: "2026-09-20",
    endsAt: "2026-10-06",
    submissionTypes: ["writeup", "video"],
    judging: "both",
    criteria: [
      { name: "文本质量", weight: 40 },
      { name: "杭州意象", weight: 30 },
      { name: "创意与完成度", weight: 30 },
    ],
    awardsEnabled: true,
    awards: [
      { name: "最佳诗词", slots: 3, reward: "各 5000 元" },
      { name: "最佳创意", slots: 2, reward: "各 3000 元" },
      { name: "人气奖", slots: 5, reward: "各 1000 元" },
    ],
    visibility: "public",
    joinPolicy: "anyone",
    emailDomain: "",
    createdAt: "2026-09-18T02:00:00.000Z",
  },
];
