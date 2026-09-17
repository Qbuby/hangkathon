/**
 * 杭客松活动（一次活动 = 一次杭客松）的数据模型与创建表单结构。
 *
 * 表单是声明式的：STEPS 描述每一步有哪些字段，创建页只负责渲染和校验。
 * 增删字段只改这一个文件。
 */

export type ActivityFormat = "online" | "offline";
export type ActivityPricing = "free" | "paid";
export type Judging = "judges" | "public" | "both";
export type Visibility = "public" | "unlisted";
export type JoinPolicy = "anyone" | "link" | "email";

export type Criterion = { name: string; weight: number };
export type Award = { name: string; slots: number; reward: string };

export type Activity = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  overview: string;
  host: string;
  format: ActivityFormat;
  venue: string;
  onlineUrl: string;
  pricing: ActivityPricing;
  fee: string;
  startsAt: string;
  endsAt: string;
  maxTeamSize: number;
  openTeam: boolean;
  submissionTypes: string[];
  judging: Judging;
  criteria: Criterion[];
  awardsEnabled: boolean;
  awards: Award[];
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  emailDomain: string;
  createdAt: string;
};

export type Draft = Record<string, unknown>;

export const SUBMISSION_TYPES = [
  { value: "repo", label: "代码仓库" },
  { value: "video", label: "演示视频" },
  { value: "demo", label: "在线 Demo" },
  { value: "writeup", label: "说明文档" },
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
      type: "text" | "textarea" | "date" | "number" | "url";
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
  | { name: string; label: string; type: "switch"; help?: string }
  | { name: string; label: string; type: "criteria"; help?: string }
  | { name: string; label: string; type: "awards"; help?: string };

export type Step = {
  id: string;
  title: string;
  summary: string;
  fields: (Field & { showIf?: (v: Draft) => boolean })[];
};

const isOnline = (v: Draft) => v.format === "online";
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
      { name: "slug", label: "链接地址", type: "text", required: true, placeholder: "ai-creators-autumn", help: "活动的网址后缀，只能用字母、数字和连字符。中文标题需要自己写一个。" },
      { name: "subtitle", label: "一句话说明", type: "text", required: true, placeholder: "用一个周末，把想法做成能跑的原型" },
      { name: "overview", label: "详细介绍", type: "textarea", placeholder: "背景、面向谁、期待什么样的作品……" },
      { name: "host", label: "主办方", type: "text", required: true, placeholder: "个人、团队或机构名称" },
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
          { value: "online", label: "线上", hint: "不限地点，线上组队与提交" },
          { value: "offline", label: "线下", hint: "需要到场参与" },
        ],
      },
      { name: "venue", label: "活动地点", type: "text", required: true, showIf: isOffline, placeholder: "例如：杭州市西湖区 · 某某空间" },
      { name: "onlineUrl", label: "线上入口", type: "url", showIf: isOnline, placeholder: "https://", help: "直播、会议或活动主页链接，可稍后补充。" },
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
    title: "时间与队伍",
    summary: "起止时间、队伍规模与组队方式",
    fields: [
      { name: "startsAt", label: "开始日期", type: "date", required: true, half: true },
      { name: "endsAt", label: "截止日期", type: "date", required: true, half: true },
      { name: "maxTeamSize", label: "单队最多人数", type: "number", required: true, min: 1, max: 20, half: true },
      { name: "openTeam", label: "允许自由组队", type: "switch", help: "打开后，参与者可以互相邀请加入队伍。" },
    ],
  },
  {
    id: "judging",
    title: "提交与评审",
    summary: "作品以什么形式提交，由谁、按什么标准评审",
    fields: [
      { name: "submissionTypes", label: "接受的提交形式", type: "checks", required: true, options: SUBMISSION_TYPES },
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
          { value: "unlisted", label: "不公开", hint: "只有拿到链接的人能看到" },
        ],
      },
      {
        name: "joinPolicy",
        label: "谁能参加",
        type: "radio",
        required: true,
        options: [
          { value: "anyone", label: "所有人" },
          { value: "link", label: "持有链接的人" },
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
    format: "offline",
    venue: "",
    onlineUrl: "",
    pricing: "free",
    fee: "",
    startsAt: "",
    endsAt: "",
    maxTeamSize: 4,
    openTeam: true,
    submissionTypes: ["repo", "demo"],
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
    if (field.type === "url" && !/^https?:\/\/\S+$/.test(String(value))) {
      errors[field.name] = "需要以 http:// 或 https:// 开头";
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
    format: values.format === "online" ? "online" : "offline",
    venue: values.format === "offline" ? String(values.venue ?? "").trim() : "",
    onlineUrl: values.format === "online" ? String(values.onlineUrl ?? "").trim() : "",
    pricing: values.pricing === "paid" ? "paid" : "free",
    fee: values.pricing === "paid" ? String(values.fee ?? "").trim() : "",
    startsAt: String(values.startsAt ?? ""),
    endsAt: String(values.endsAt ?? ""),
    maxTeamSize: Number(values.maxTeamSize) || 1,
    openTeam: values.openTeam === true,
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

/** Activities live in the browser until a database is provisioned. */
export function loadActivities(): Activity[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Activity => Boolean(item) && typeof item === "object" && typeof (item as Activity).title === "string");
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
