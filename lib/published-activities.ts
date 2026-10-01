import type { Activity } from "./activity";

/** 已发布的杭客松活动。 */
export const PUBLISHED_ACTIVITIES: Activity[] = [
  {
    id: "guoqing_77",
    slug: "guoqing-77",
    title: "我 AI 中国 · 2026 国庆 AI 短视频创作大赛",
    subtitle: "77 周年，49 新生",
    overview:
      "你要做的事：用 AI 创作一部致敬新中国 77 周年的短视频，主题「我 AI 中国」。活动全程 7 天（10 月 1 日—10 月 7 日），活动期间提交作品，就有机会赢得最高 7749 万算力的奖励。77 年，山河为新；用你的镜头与想象力，把这段新生的故事讲给未来听。10 月下旬在杭州举行颁奖典礼，获奖者将受邀到场。",
    host: "杭客松",
    contact: "hangkathon@proton.me",
    district: "other",
    format: "online",
    venue: "",
    pricing: "free",
    fee: "",
    category: "creation",
    prizePool: 0,
    startsAt: "2026-10-01",
    endsAt: "2026-10-07",
    submissionTypes: ["video"],
    judging: "both",
    criteria: [
      { name: "主题契合", weight: 30 },
      { name: "创意与叙事", weight: 40 },
      { name: "视听完成度", weight: 30 },
    ],
    awardsEnabled: true,
    awards: [
      { name: "最高奖励", slots: 1, reward: "7749 万算力" },
      { name: "优秀作品", slots: 7, reward: "算力奖励" },
      { name: "获奖者", slots: 0, reward: "受邀出席 10 月下旬杭州颁奖典礼" },
    ],
    visibility: "public",
    joinPolicy: "anyone",
    emailDomain: "",
    image: "/assets/guoqing-77-poster.jpg",
    createdAt: "2026-10-01T02:00:00.000Z",
  },
];
