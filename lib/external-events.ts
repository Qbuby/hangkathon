/**
 * 全球赛事抓取的数据契约：scripts/events/fetch.py 产出 → ingest API 校验入库 → 活动页展示。
 * 这个模块保持纯逻辑（不允许 import 服务端依赖），scripts/events/events.test.mjs 会整体 transpile 它。
 */

export const EVENT_SOURCES = [
  { id: "hudongba", label: "互动吧" },
  { id: "topcoder", label: "Topcoder" },
  { id: "mlh", label: "MLH" },
  { id: "drivendata", label: "DrivenData" },
  { id: "contestwatchers", label: "Contest Watchers" },
  { id: "xprize", label: "XPRIZE" },
  { id: "studentcompetitions", label: "StudentCompetitions" },
] as const;

export type EventSourceId = (typeof EVENT_SOURCES)[number]["id"];

export const EVENT_CATEGORIES = ["hackathon", "competition", "award", "activity"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** 与 fetch.py 的 finalize() 输出一一对应（camelCase，ISO 日期）。id 与 *Zh 由入库侧补充。 */
export type ExternalEvent = {
  id?: string;
  source: EventSourceId;
  sourceId: string;
  title: string;
  titleZh?: string;
  url: string;
  category: EventCategory;
  location?: string;
  online?: boolean;
  startsAt?: string;
  endsAt?: string;
  deadlineAt?: string;
  prize?: string;
  description?: string;
  descriptionZh?: string;
  detailText?: string;
  detailTextZh?: string;
  imageUrl?: string;
  tags: string[];
};

const SOURCE_IDS = new Set<string>(EVENT_SOURCES.map((item) => item.id));
const CATEGORY_IDS = new Set<string>(EVENT_CATEGORIES);

export function isEventSource(value: string): value is EventSourceId {
  return SOURCE_IDS.has(value);
}

export function categoryLabel(category: EventCategory): string {
  return category === "hackathon" ? "黑客松" : category === "competition" ? "竞赛" : category === "activity" ? "活动" : "创意大奖";
}

/** 国内平台（江浙沪线下活动）来源——活动页「本地赛事」板块的数据源。 */
const LOCAL_SOURCES = new Set<string>(["hudongba"]);

export function eventScope(source: string): "local" | "global" {
  return LOCAL_SOURCES.has(source) ? "local" : "global";
}

/** 用户定的窗口口径：开始日期最早到一周前，最晚到之后三个月。 */
export const WINDOW_PAST_DAYS = 7;
export const WINDOW_FUTURE_DAYS = 90;

const DAY_MS = 86_400_000;

function asIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString();
}

function asTrimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

/**
 * ingest 入库前的逐条校验：不合要求的返回 null 直接丢弃，绝不让坏数据进库。
 * 日期统一转成 UTC ISO；startsAt 缺席允许（Deadline 驱动的目录站）。
 */
export function normalizeEventInput(raw: unknown): ExternalEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const source = typeof item.source === "string" ? item.source : "";
  if (!isEventSource(source)) return null;
  const sourceId = asTrimmed(item.sourceId, 200);
  const title = asTrimmed(item.title, 300);
  const url = asTrimmed(item.url, 2000);
  if (!sourceId || !title || !url || !/^https?:\/\//.test(url)) return null;
  const category = typeof item.category === "string" && CATEGORY_IDS.has(item.category)
    ? (item.category as EventCategory)
    : "competition";
  const startsAt = asIsoDate(item.startsAt);
  const endsAt = asIsoDate(item.endsAt);
  const deadlineAt = asIsoDate(item.deadlineAt);
  if (!startsAt && !endsAt && !deadlineAt) return null;
  const online = typeof item.online === "boolean" ? item.online : undefined;
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).slice(0, 10)
    : [];
  const event: ExternalEvent = { source, sourceId, title, url, category, tags };
  if (startsAt) event.startsAt = startsAt;
  if (endsAt) event.endsAt = endsAt;
  if (deadlineAt) event.deadlineAt = deadlineAt;
  const location = asTrimmed(item.location, 200);
  if (location) event.location = location;
  if (online !== undefined) event.online = online;
  const prize = asTrimmed(item.prize, 80);
  if (prize) event.prize = prize;
  const imageUrl = asTrimmed(item.imageUrl, 1000);
  if (imageUrl && /^https?:\/\//.test(imageUrl)) event.imageUrl = imageUrl;
  const description = asTrimmed(item.description, 280);
  if (description) event.description = description;
  return event;
}

export function eventWindowBounds(now: Date = new Date()) {
  return {
    past: new Date(now.getTime() - WINDOW_PAST_DAYS * DAY_MS),
    future: new Date(now.getTime() + WINDOW_FUTURE_DAYS * DAY_MS),
  };
}

/**
 * 与 fetch.py 的 in_window() 同口径的兜底过滤（服务端已经滤过，这里主要挡缓存里的旧数据）：
 * 开始日期落在 [now-7d, now+90d]；或已在进行、结束/截止日期落在 [now, now+90d]。
 */
export function filterByWindow(events: ExternalEvent[], now: Date = new Date()): ExternalEvent[] {
  const past = new Date(now.getTime() - WINDOW_PAST_DAYS * DAY_MS);
  const future = new Date(now.getTime() + WINDOW_FUTURE_DAYS * DAY_MS);
  const between = (value: string | undefined, lo: Date, hi: Date) => {
    if (!value) return false;
    const date = new Date(value);
    return date >= lo && date <= hi;
  };
  return events.filter((event) => {
    if (event.startsAt && between(event.startsAt, past, future)) return true;
    return between(event.endsAt, now, future) || between(event.deadlineAt, now, future);
  });
}
