/**
 * 杭客松活动（一次活动 = 一次杭客松）的数据模型与创建表单结构。
 *
 * 表单是声明式的：STEPS 描述每一步有哪些字段，创建页只负责渲染和校验。
 * 增删字段只改这一个文件。
 */
import { FACTIONS } from "./factions";

export type ActivityFormat = "online" | "offline";
export type ActivityPricing = "free" | "paid";
export type Judging = "judges" | "public" | "both";
export type Visibility = "public" | "unlisted";
export type JoinPolicy = "anyone" | "link" | "email";

export type Criterion = { name: string; weight: number };
export type Award = { name: string; slots: number; reward: string };

export type Category = "creation" | "tooling" | "city" | "research" | "community";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "creation", label: "内容创作" },
  { value: "tooling", label: "工具与效率" },
  { value: "city", label: "城市与生活" },
  { value: "research", label: "技术探索" },
  { value: "community", label: "社区共创" },
];

export function categoryLabel(value: Category | string) {
  return CATEGORIES.find((item) => item.value === value)?.label ?? "其他";
}

export type Activity = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  overview: string;
  host: string;
  contact: string;
  /** 活动所属区：13 个官方区或「其他」，发起方在发布时选择；参与者以个人账户参赛，不再选阵营。 */
  district: string;
  format: ActivityFormat;
  venue: string;
  pricing: ActivityPricing;
  fee: string;
  category: Category;
  prizePool: number;
  startsAt: string;
  endsAt: string;
  submissionTypes: string[];
  judging: Judging;
  criteria: Criterion[];
  awardsEnabled: boolean;
  awards: Award[];
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  emailDomain: string;
  /** 海报图（竖版），仅平台预置活动配置；自建活动没有。 */
  image?: string;
  createdAt: string;
};

export type Draft = Record<string, unknown>;

export const SUBMISSION_TYPES = [
  { value: "writeup", label: "项目说明" },
  { value: "files", label: "代码或文件" },
  { value: "video", label: "演示视频" },
  { value: "demo", label: "交互 Demo" },
  { value: "live", label: "现场演示" },
];

export const EMPTY_CRITERIA: Criterion[] = [
  { name: "完成度", weight: 40 },
  { name: "创新性", weight: 30 },
  { name: "实用性", weight: 30 },
];

export type Field =
  | {
      name: string;
      label: string;
      type: "text" | "textarea" | "date" | "number";
      placeholder?: string;
      help?: string;
      required?: boolean;
      min?: number;
      max?: number;
      half?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "radio";
      options: { value: string; label: string; hint?: string }[];
      help?: string;
      required?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "checks";
      options: { value: string; label: string }[];
      help?: string;
      required?: boolean;
    }
  /** 活动所属区：从 13 个官方区中单选一个，发起方在发布时确定。 */
  | {
      name: string;
      label: string;
      type: "district";
      help?: string;
      required?: boolean;
    }
  | { name: string; label: string; type: "switch"; help?: string }
  | { name: string; label: string; type: "criteria"; help?: string }
  | { name: string; label: string; type: "awards"; help?: string };

export type Step = {
  id: string;
  title: string;
  summary: string;
  fields: (Field & { showIf?: (v: Draft) => boolean })[];
};

const isOffline = (v: Draft) => v.format === "offline";
const isPaid = (v: Draft) => v.pricing === "paid";
const hasAwards = (v: Draft) => v.awardsEnabled === true;
const byEmail = (v: Draft) => v.joinPolicy === "email";

export const STEPS: Step[] = [
  {
    id: "basics",
    title: "基本信息",
    summary: "活动的名字、一句话说明和主办方",
    fields: [
      { name: "title", label: "活动名称", type: "text", required: true, placeholder: "例如：AI 创造者杭客松 · 夏季场", help: "写清楚这一场要解决什么，比写得多更管用。" },
      { name: "slug", label: "活动代号", type: "text", required: true, placeholder: "ai-creators-autumn", help: "给这场活动起一个代号，站内用它来指代这场活动。只能用字母、数字和连字符，中文标题需要自己起一个。" },
      { name: "subtitle", label: "一句话说明", type: "text", required: true, placeholder: "用一个周末，把想法做成能跑的原型" },
      { name: "category", label: "活动类别", type: "radio", required: true, options: CATEGORIES.map((c) => ({ value: c.value, label: c.label })), help: "活动看板会按类别筛选，选一个最贴近的。" },
      { name: "district", label: "活动所属区", type: "district", required: true, help: "这场活动归属杭州哪个区县；都不属于（线上、跨区、杭州以外）就选「其他」。参与者以个人账户报名参赛，不再选择阵营。" },
      { name: "overview", label: "详细介绍", type: "textarea", placeholder: "背景、面向谁、期待什么样的作品……" },
      { name: "host", label: "主办方", type: "text", required: true, placeholder: "个人、团队或机构名称" },
      { name: "contact", label: "联系方式", type: "text", required: true, placeholder: "例如：微信号 / 邮箱 / 手机号", help: "会公示在活动页，方便参与者有问题时直接联系主办方。" },
    ],
  },
  {
    id: "format",
    title: "形式与费用",
    summary: "线上还是线下，免费还是收费",
    fields: [
      {
        name: "format",
        label: "参与形式",
        type: "radio",
        required: true,
        options: [
          { value: "online", label: "线上", hint: "不限地点，报名与提交都在杭客松上" },
          { value: "offline", label: "线下", hint: "需要到场参与" },
        ],
        help: "活动在杭客松平台内进行，不需要跳转到其他网站。",
      },
      { name: "venue", label: "活动地点", type: "text", required: true, showIf: isOffline, placeholder: "例如：杭州市西湖区 · 某某空间", help: "线下活动需要说明在哪里集合。" },
      {
        name: "pricing",
        label: "参与费用",
        type: "radio",
        required: true,
        options: [
          { value: "free", label: "免费", hint: "不向参与者收费" },
          { value: "paid", label: "收费", hint: "需要说明金额与用途" },
        ],
      },
      { name: "fee", label: "费用说明", type: "text", required: true, showIf: isPaid, placeholder: "例如：每人 199 元，含两日餐食与场地" },
    ],
  },
  {
    id: "schedule",
    title: "活动时间",
    summary: "设定活动的起止日期",
    fields: [
      { name: "startsAt", label: "开始日期", type: "date", required: true, half: true },
      { name: "endsAt", label: "截止日期", type: "date", required: true, half: true },
    ],
  },
  {
    id: "judging",
    title: "提交与评审",
    summary: "作品以什么形式提交，由谁、按什么标准评审",
    fields: [
      { name: "submissionTypes", label: "接受的提交形式", type: "checks", required: true, options: SUBMISSION_TYPES, help: "参与者直接在杭客松上提交，不需要填写任何外部链接。" },
      {
        name: "judging",
        label: "评审方式",
        type: "radio",
        required: true,
        options: [
          { value: "judges", label: "评委评审", hint: "由主办方邀请的评委打分" },
          { value: "public", label: "大众投票", hint: "由参与者与公众投票" },
          { value: "both", label: "两者结合", hint: "评委打分与大众投票各占一部分" },
        ],
      },
      { name: "criteria", label: "评审维度与权重", type: "criteria", help: "权重合计需要等于 100%。发布后参与者可以看到这套标准。" },
    ],
  },
  {
    id: "awards",
    title: "奖项",
    summary: "是否设奖，以及奖项怎么分配",
    fields: [
      { name: "awardsEnabled", label: "设置奖项", type: "switch", help: "关闭时这场活动不评名次，只做共创与交流。" },
      { name: "prizePool", label: "奖金总额", type: "number", min: 0, max: 1000000, half: true, showIf: hasAwards, help: "以人民币元计。没有奖金填 0，只设荣誉也可以。" },
      { name: "awards", label: "奖项设置", type: "awards", showIf: hasAwards },
    ],
  },
  {
    id: "access",
    title: "公开范围",
    summary: "谁能看到这场活动，谁能参加",
    fields: [
      {
        name: "visibility",
        label: "可见性",
        type: "radio",
        required: true,
        options: [
          { value: "public", label: "公开", hint: "在活动列表和搜索中可见" },
          { value: "unlisted", label: "不公开", hint: "不在活动列表中展示，只有拿到代号的人能找到" },
        ],
      },
      {
        name: "joinPolicy",
        label: "谁能参加",
        type: "radio",
        required: true,
        options: [
          { value: "anyone", label: "所有人" },
          { value: "link", label: "知道活动代号的人" },
          { value: "email", label: "限定邮箱域名" },
        ],
      },
      { name: "emailDomain", label: "允许的邮箱域名", type: "text", required: true, showIf: byEmail, placeholder: "例如：example.com" },
    ],
  },
];

export function initialDraft(host = ""): Draft {
  return {
    title: "",
    slug: "",
    subtitle: "",
    overview: "",
    host,
    contact: "",
    district: "",
    format: "offline",
    venue: "",
    pricing: "free",
    fee: "",
    category: "creation",
    prizePool: 0,
    startsAt: "",
    endsAt: "",
    submissionTypes: ["writeup", "demo"],
    judging: "judges",
    criteria: EMPTY_CRITERIA.map((c) => ({ ...c })),
    awardsEnabled: true,
    awards: [{ name: "最佳作品", slots: 1, reward: "" }],
    visibility: "public",
    joinPolicy: "anyone",
    emailDomain: "",
  };
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isBlank(value: unknown) {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || String(value).trim() === "";
}

/** Returns the field name to message map for one step; empty means the step passes. */
export function validateStep(step: Step, values: Draft): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of step.fields) {
    if (field.showIf && !field.showIf(values)) continue;
    const value = values[field.name];

    if ("required" in field && field.required && isBlank(value)) {
      errors[field.name] = "这一项需要填写";
      continue;
    }
    if (isBlank(value)) continue;

    if (field.type === "text" && field.name === "slug" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(value))) {
      errors[field.name] = "只能使用小写字母、数字和连字符";
    }
    if (field.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < (field.min ?? 1) || n > (field.max ?? 999)) {
        errors[field.name] = `请填写 ${field.min ?? 1} 到 ${field.max ?? 999} 之间的数字`;
      }
    }
    if (field.type === "checks" && !Array.isArray(value)) {
      errors[field.name] = "至少选择一项";
    }
    if (field.name === "emailDomain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(value).replace(/^@/, ""))) {
      errors[field.name] = "请填写域名，例如 example.com";
    }
  }

  if (values.startsAt && values.endsAt && String(values.endsAt) < String(values.startsAt)) {
    errors.endsAt = "截止日期不能早于开始日期";
  }

  if (step.id === "judging") {
    const criteria = (values.criteria as Criterion[]) ?? [];
    const named = criteria.filter((c) => c.name.trim());
    if (named.length === 0) {
      errors.criteria = "至少填写一个评审维度";
    } else {
      const total = named.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);
      if (total !== 100) errors.criteria = `权重合计需要是 100%，当前是 ${total}%`;
    }
  }

  if (step.id === "awards" && values.awardsEnabled) {
    const awards = (values.awards as Award[]) ?? [];
    const named = awards.filter((a) => a.name.trim());
    if (named.length === 0) errors.awards = "至少填写一个奖项，或关闭奖项开关";
  }

  return errors;
}

export function validateAll(values: Draft): Record<string, string> {
  return STEPS.reduce<Record<string, string>>((all, step) => ({ ...all, ...validateStep(step, values) }), {});
}

export function toActivity(values: Draft): Activity {
  const title = String(values.title ?? "").trim();
  return {
    id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    slug: slugify(String(values.slug ?? "")) || slugify(title) || "activity",
    title,
    subtitle: String(values.subtitle ?? "").trim(),
    overview: String(values.overview ?? "").trim(),
    host: String(values.host ?? "").trim(),
    contact: String(values.contact ?? "").trim(),
    district: FACTIONS.some((faction) => faction.id === values.district) ? String(values.district) : "",
    format: values.format === "online" ? "online" : "offline",
    venue: values.format === "offline" ? String(values.venue ?? "").trim() : "",
    pricing: values.pricing === "paid" ? "paid" : "free",
    fee: values.pricing === "paid" ? String(values.fee ?? "").trim() : "",
    category: (values.category as Category) ?? "creation",
    prizePool: values.awardsEnabled ? Number(values.prizePool) || 0 : 0,
    startsAt: String(values.startsAt ?? ""),
    endsAt: String(values.endsAt ?? ""),
    submissionTypes: Array.isArray(values.submissionTypes) ? (values.submissionTypes as string[]) : [],
    judging: (values.judging as Judging) ?? "judges",
    criteria: ((values.criteria as Criterion[]) ?? []).filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), weight: Number(c.weight) || 0 })),
    awardsEnabled: values.awardsEnabled === true,
    awards: values.awardsEnabled
      ? ((values.awards as Award[]) ?? []).filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), slots: Number(a.slots) || 1, reward: a.reward.trim() }))
      : [],
    visibility: values.visibility === "unlisted" ? "unlisted" : "public",
    joinPolicy: (values.joinPolicy as JoinPolicy) ?? "anyone",
    emailDomain: values.joinPolicy === "email" ? String(values.emailDomain ?? "").replace(/^@/, "").trim() : "",
    createdAt: new Date().toISOString(),
  };
}

export const STORAGE_KEY = "hangkathon.activities.v1";

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/**
 * Stored activities outlive schema changes, so fill in anything an older
 * record is missing rather than letting the list render crash on it.
 */
function normalize(raw: unknown): Activity | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const title = text(value.title);
  if (!title) return null;

  return {
    id: text(value.id) || `a_${title}`,
    slug: text(value.slug) || "activity",
    title,
    subtitle: text(value.subtitle),
    overview: text(value.overview),
    host: text(value.host),
    contact: text(value.contact),
    district: FACTIONS.some((faction) => faction.id === value.district) ? text(value.district) : "",
    format: value.format === "online" ? "online" : "offline",
    venue: text(value.venue),
    pricing: value.pricing === "paid" ? "paid" : "free",
    fee: text(value.fee),
    category: (value.category as Category) ?? "creation",
    prizePool: Number(value.prizePool) || 0,
    startsAt: text(value.startsAt),
    endsAt: text(value.endsAt),
    submissionTypes: list<string>(value.submissionTypes),
    judging: (value.judging as Judging) ?? "judges",
    criteria: list<Criterion>(value.criteria).filter((c) => c && typeof c.name === "string"),
    awardsEnabled: value.awardsEnabled === true,
    awards: list<Award>(value.awards).filter((a) => a && typeof a.name === "string"),
    visibility: value.visibility === "unlisted" ? "unlisted" : "public",
    joinPolicy: (value.joinPolicy as JoinPolicy) ?? "anyone",
    emailDomain: text(value.emailDomain),
    createdAt: text(value.createdAt, new Date(0).toISOString()),
  };
}

/** Activities live in the browser until a database is provisioned. */
export function loadActivities(): Activity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((item): item is Activity => item !== null);
  } catch {
    return [];
  }
}

export function saveActivity(activity: Activity) {
  const next = [activity, ...loadActivities().filter((item) => item.id !== activity.id)];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 50)));
}

export function formatLabel(activity: Activity) {
  return activity.format === "online" ? "线上" : "线下";
}

export function pricingLabel(activity: Activity) {
  return activity.pricing === "free" ? "免费" : "收费";
}

export function prizeText(activity: Activity) {
  if (!activity.awardsEnabled) return "不设奖";
  if (activity.prizePool > 0) return `奖金 ¥${activity.prizePool.toLocaleString("zh-CN")}`;
  return "荣誉奖项";
}

export function judgingLabel(judging: Judging) {
  return judging === "public" ? "公众评价" : judging === "both" ? "评审 + 公众" : "评审评价";
}

export function visibilityLabel(visibility: Visibility) {
  return visibility === "unlisted" ? "不公开" : "公开";
}

export function joinPolicyLabel(activity: Activity) {
  if (activity.joinPolicy === "email") return `限 ${activity.emailDomain || "指定邮箱域名"} 的邮箱`;
  if (activity.joinPolicy === "link") return "知道活动代号的人";
  return "所有人可报名";
}

export function submissionLabels(types: string[]) {
  return types.map((value) => SUBMISSION_TYPES.find((item) => item.value === value)?.label ?? value);
}

/** Resolve one activity by its 活动代号, searching this device's records first. */
export function findActivityBySlug(slug: string, demoActivities: Activity[] = []): Activity | null {
  return loadActivities().find((item) => item.slug === slug) ?? demoActivities.find((item) => item.slug === slug) ?? null;
}
