/**
 * 人工精选赛事（curated）：不由抓取脚本产出，直接写在代码里、随部署同步入库。
 *
 * 为什么单独一条通道：`external_events` 里的自动抓取内容必须遵守「开始日期在 ±窗口内」
 * 的规则，否则表会被长期赛事塞满；但用户点名要收录的活动（例如迪拜的 AI Agent 锦标赛）
 * 往往周期长达半年，按抓取窗口会被直接过滤掉。把它们标成 source='curated' 之后：
 *   · 公开列表只按「是否已结束」判断，不看 90 天窗口（lib/server/external-events.ts）；
 *   · 清理任务按 source 豁免，不会被「两周没再见到」删掉；
 *   · ingest 接口**不接受** curated —— 这个来源只能由代码产生，外部无法伪造。
 *
 * 维护方式：改这个文件 → 提交 → CI 部署后新进程首次读取活动页时幂等 upsert。
 * `hidden` 字段不会被覆盖，管理端「隐藏」仍然有效。
 *
 * 这个模块是纯数据（不 import 服务端依赖），scripts/curated-events.test.mjs 会转译它。
 */

import type { EventCategory } from "./external-events";

/** 人工精选来源 id。与抓取源共用 external_events 表，靠这个值区分。 */
export const CURATED_SOURCE = "curated" as const;

export type CuratedEvent = {
  /** 稳定标识，入库后作为 (source, external_id) 的唯一键；改它等于新建一条。 */
  sourceId: string;
  /** 主办方原文标题。 */
  title: string;
  /** 中文标题（人工翻译，不是机翻）。 */
  titleZh: string;
  /** 主办方官方页面；详情页的「前往官网」指向这里。 */
  url: string;
  category: EventCategory;
  /** 线上 / 线下 / 混合的文字说明；`online` 只在纯线上时设为 true。 */
  location?: string;
  online?: boolean;
  startsAt: string;
  endsAt?: string;
  deadlineAt?: string;
  /** 奖金口径，短句。 */
  prize?: string;
  /** 主办方原文简介（≤280 字，与抓取口径一致）。 */
  description?: string;
  /** 中文简介（≤280 字）。 */
  descriptionZh?: string;
  /** 主办方原文正文；人工精选通常不整段转载，留空即可。 */
  detailText?: string;
  /** 中文正文（可多段，详情页用 pre-wrap 渲染）。 */
  detailTextZh?: string;
  /** 海报/横幅：站内路径（/assets/...）或 https URL。 */
  imageUrl?: string;
  tags: string[];
};

/**
 * 已收录的人工精选赛事。
 *
 * 收录原则：
 *   1. 只收主办方公开页面能核对到的事实，不编造报名入口、截止日或奖金；
 *   2. 主办方只给到月份时，日期字段取当月边界并在正文里明确说明「具体日以官网为准」；
 *   3. 不在杭客松站内报名 —— 报名一律跳主办方页面，也不参与贡献值与荣誉结算。
 */
export const CURATED_EVENTS: CuratedEvent[] = [
  {
    sourceId: "create-ai-agents-championship-2026",
    title: "Create AI Agents Championship",
    titleZh: "Create AI Agents 智能体锦标赛 · 迪拜",
    url: "https://www.dubaichamberdigital.com/en/create-ai-agents",
    category: "competition",
    // 报名、工作坊与课程在线上；半决赛与总决赛在迪拜线下，所以不标成纯线上
    location: "迪拜（决赛线下 · 其余线上）",
    startsAt: "2026-10-07T00:00:00.000Z",
    // 官网只写「2027 年 1 月报名截止」「2027 年 5 月第一周总决赛」，取当月边界；
    // 正文里明确提示具体日以官网为准。
    deadlineAt: "2027-01-31T15:59:59.000Z",
    endsAt: "2027-05-07T15:59:59.000Z",
    prize: "总额 USD 750,000 · 4 个类别各 USD 150,000",
    description:
      "Dubai Chamber of Digital Economy's flagship global championship for building AI Agents. Free to enter, open worldwide; four award categories with USD 150,000 grants each.",
    descriptionZh:
      "迪拜数字经济商会主办的全球 AI Agent 锦标赛：免费参加，个人或 6 人以内团队均可，四个类别各 15 万美元资助，总额 75 万美元。2026 年 10 月 7 日开放报名，2027 年 1 月截止，2027 年 5 月于迪拜总决赛。",
    detailTextZh: [
      "由迪拜数字经济商会（Dubai Chamber of Digital Economy）主办的全球 AI Agent 锦标赛，面向全球任何年龄、任何地点的个人与团队（每队最多 6 人），技术与非技术背景均可参加，参赛免费，开发成本自理。",
      "四个奖项类别：最佳社会 AI Agent、最佳个人 AI Agent、最佳商业 AI Agent、最佳青年 AI Agent（青年类别要求主导报名者在报名时未满 21 岁）。每个类别冠军获得 15 万美元资助；四类冠军中还会评出一名「Dubai AI Agent of the Year」，并追加资助。奖金总额 75 万美元。",
      "赛程（官网口径）：2026 年 10 月 7 日启动并开放报名；2026 年 10–11 月为探索期（三场公开工作坊 + 线上课程）；2026 年 11 月–2027 年 1 月为构建期（训练课程、工作坊、导师辅导）；2027 年 1 月报名截止并提交 AI Agent 原型、路演材料与演示视频；2027 年 1 月公布 24 强并启动加速器；2027 年 3 月半决赛路演并公布 12 强；2027 年 5 月第一周在迪拜举行总决赛与颁奖。",
      "参赛要求：作品必须是原创的 AI Agent 方案，处于想法、原型或早期 MVP 阶段，且尚未完全商业化；进入总决赛的团队必须现场演示可用的完整产品（官网明确「不是 MVP」）；报名与所有提交材料必须使用英文。",
      "杭客松提示：官网时间只公开到月份（报名 2027 年 1 月截止、总决赛 2027 年 5 月第一周），本页日期字段中的具体日是按月份取的边界值，仅用于排序与展示，请以官网为准。报名、费用与评审细则均以主办方页面为准；本页为杭客松人工收录，不参与杭客松的贡献值与荣誉结算。",
    ].join("\n\n"),
    imageUrl: "/assets/curated/create-ai-agents-championship.png",
    tags: ["AI Agent", "迪拜", "全球赛事", "奖金"],
  },
];

/**
 * 人工精选在某个时刻是否还该展示。
 *
 * 只按**结束/截止时间**判断：哪个先到按哪个。两者都没有就视为长期有效 ——
 * 精选是编辑手工维护的，下架靠从代码里删条目，不靠日期猜。
 * 刻意不看 startsAt：只看开始日等于活动一开始就自动消失。
 * 与抓取窗口无关 —— 这正是 curated 通道存在的理由。
 */
export function curatedVisibleAt(event: CuratedEvent, now: Date = new Date()): boolean {
  const dates = [event.endsAt, event.deadlineAt].filter((value): value is string => Boolean(value));
  if (dates.length === 0) return true;
  return dates.some((value) => {
    const time = Date.parse(value);
    return !Number.isFinite(time) || time >= now.getTime();
  });
}
