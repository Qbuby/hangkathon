"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ArrowLeft, Check, Download, EyeOff, Globe, RefreshCw, Rocket, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { categoryLabel, formatLabel, judgingLabel, joinPolicyLabel, pricingLabel, prizeText, submissionLabels, type Activity } from "@/lib/activity";
import { factionById } from "@/lib/factions";
import { usePageMotion } from "../motion-scope";
import "../activities/[slug]/detail.css";
import "./manage.css";

/**
 * 管理端口（/manage）：无公开导航入口，直达 URL。
 * 服务端为准：/api/admin/* 全部 requireAdmin，前端这层只是把 403/401 画成人话。
 */

type AdminSession = {
  user: { email: string; name: string | null } | null;
  admin: boolean;
};

type Overview = {
  users: number;
  activities: number;
  joins: number;
  submissions: number;
  pendingReviews: number;
  pendingActivities: number;
  pendingAgents: number;
};

type AdminActivity = {
  id: string;
  slug: string;
  title: string;
  district: string;
  visibility: "public" | "unlisted";
  /** 活动审核流（pending | published）；与 AdminSubmission.reviewStatus 同名不同义，勿混用文案常量与样式。 */
  reviewStatus: "pending" | "published";
  seeded: boolean;
  startsAt: string;
  endsAt: string;
  ownerEmail: string | null;
  ownerName: string | null;
  joinCount: number;
  submissionCount: number;
};

type AdminSubmission = {
  id: string;
  url: string;
  submittedAt: string;
  authorName: string | null;
  caption: string | null;
  diggCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  collectCount: number | null;
  metricsError: string | null;
  reviewStatus: "pending" | "approved" | "rejected";
  userEmail: string;
  userName: string | null;
};

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  activityCount: number;
  joinCount: number;
  submissionCount: number;
};

type AdminJoin = {
  userId: string;
  email: string;
  name: string | null;
  joinedAt: string;
  inviterEmail: string | null;
};

type AdminExternalEvent = {
  id: string;
  source: string;
  title: string;
  url: string;
  startsAt: string | null;
  deadlineAt: string | null;
  hidden: boolean;
};

type Tab = "overview" | "activities" | "submissions" | "users" | "agents" | "events" | "audit" | "blacklist";

type AgentApplication = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  contactName: string;
  organization: string;
  phone: string;
  email: string;
  statement: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

type AuditLog = {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  userEmail: string | null;
  ip: string | null;
  port: string | null;
  protocol: string | null;
  targetType: string | null;
  targetId: string | null;
  result: string;
  detail: Record<string, unknown>;
};

type BlacklistEntry = {
  id: string;
  email: string;
  reason: string;
  source: string;
  hits: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  revokedAt: string | null;
};

const AUDIT_CATEGORY_LABEL: Record<string, string> = {
  auth: "登录登出",
  register: "用户注册",
  publish: "内容发布",
  behavior: "用户行为",
  admin: "管理操作",
  security: "安全事件",
  system: "系统",
};

const GUARD = {
  loading: "loading",
  noDb: "noDb",
  login: "login",
  forbidden: "forbidden",
  ok: "ok",
} as const;
type Guard = (typeof GUARD)[keyof typeof GUARD];

const REVIEW_LABEL: Record<AdminSubmission["reviewStatus"], string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};

/**
 * 颁奖统计的加权口径（可调）：赞 1 / 评 2 / 转 3 / 藏 2。
 * 只有已通过（approved）的作品计分，驳回/待审核的互动量不计入，防止未过审作品占排名；
 * 指标缺失（抓取失败）按 0 计，但仍计入作品数；同一链接重复提交只算一件；渲染时聚合，不落库。
 */
const WEIGHTS = { likes: 1, comments: 2, shares: 3, collects: 2 } as const;

type AwardStat = {
  email: string;
  name: string;
  works: number;
  approved: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
  total: number;
};

/**
 * 同一用户重复提交同一链接只算一件作品：addSubmission 对 submissions 无条件 insert
 * （lib/server/submissions.ts:49，无唯一约束），重复行经 setMetricsForUrl 带着同一套指标，
 * 逐行计分会翻倍且可被主动刷分。重复行审核状态可能不同，优先保留已通过的那条。
 */
function dedupeWorks(submissions: AdminSubmission[]): AdminSubmission[] {
  const byKey = new Map<string, AdminSubmission>();
  for (const submission of submissions) {
    const key = `${submission.userEmail}\u0000${submission.url}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, submission);
    } else if (existing.reviewStatus !== "approved" && submission.reviewStatus === "approved") {
      byKey.set(key, submission);
    }
  }
  return [...byKey.values()];
}

/** 按用户邮箱聚合一场活动的作品数据，加权总分降序（并列看作品数，再按邮箱稳定排序）。 */
function awardStats(submissions: AdminSubmission[]): AwardStat[] {
  const byUser = new Map<string, AwardStat>();
  for (const submission of dedupeWorks(submissions)) {
    const likes = submission.diggCount ?? 0;
    const comments = submission.commentCount ?? 0;
    const shares = submission.shareCount ?? 0;
    const collects = submission.collectCount ?? 0;
    const stat = byUser.get(submission.userEmail) ?? {
      email: submission.userEmail,
      name: submission.userName || submission.userEmail,
      works: 0,
      approved: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      collects: 0,
      total: 0,
    };
    stat.works += 1;
    if (submission.reviewStatus === "approved") {
      // 仅已通过作品计入互动量与加权总分（口径见 WEIGHTS 注释，与贡献值结算一致）
      stat.approved += 1;
      stat.likes += likes;
      stat.comments += comments;
      stat.shares += shares;
      stat.collects += collects;
      stat.total += likes * WEIGHTS.likes + comments * WEIGHTS.comments + shares * WEIGHTS.shares + collects * WEIGHTS.collects;
    }
    byUser.set(submission.userEmail, stat);
  }
  return [...byUser.values()].sort((a, b) => b.total - a.total || b.works - a.works || a.email.localeCompare(b.email));
}

const SOURCE_LABEL: Record<string, string> = {
  contest_watchers: "Contest Watchers",
  chinahpc: "中国高性能计算",
  ccf: "CCF",
};

/** 客户端 CSV（带 BOM，Excel 直接打开不乱码）。 */
function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const escape = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    // 公式注入防护：= + - @ 开头的单元格加前导单引号，Excel 按文本而不是公式执行（昵称等用户可控字段）
    const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fmtCount(value: number | null) {
  if (value === null) return "—";
  return value >= 10000 ? `${(value / 10000).toFixed(1).replace(/\.0$/, "")} 万` : value.toLocaleString("zh-CN");
}

export default function ManagePage() {
  const [guard, setGuard] = useState<Guard>(GUARD.loading);
  const [providers, setProviders] = useState<{ id: string; name: string; configured: boolean }[]>([]);
  const [configured, setConfigured] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activities, setActivities] = useState<AdminActivity[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [auditLogs, setAuditLogs] = useState<AuditLog[] | null>(null);
  const [auditCategory, setAuditCategory] = useState("");
  const [auditIntegrity, setAuditIntegrity] = useState<string | null>(null);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[] | null>(null);
  const [blockForm, setBlockForm] = useState({ email: "", reason: "", source: "platform" });
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null);
  const [busySubmission, setBusySubmission] = useState<string | null>(null);
  // 待审核活动详情（公开详情页对管理员也 404，审核前在这里看内容）
  const [inspect, setInspect] = useState<{ slug: string; activity: Activity | null; failed: boolean } | null>(null);
  const submissionsRequest = useRef(0);
  const inspectRequest = useRef(0);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentApplication[] | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [joins, setJoins] = useState<AdminJoin[] | null>(null);
  const [joinsSlug, setJoinsSlug] = useState<string | null>(null);
  const [busyJoin, setBusyJoin] = useState<string | null>(null);
  const [events, setEvents] = useState<AdminExternalEvent[] | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);

  usePageMotion("manage", { ready: guard !== GUARD.loading });

  // 守卫读取：503=无数据库；401/非 admin=无权限（区分未登录/已登录）。
  // 登录后 signIn 的 callbackUrl 会整页跳回 /manage，状态自然重读。
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/session");
        if (response.status === 503) {
          if (!cancelled) setGuard(GUARD.noDb);
          return;
        }
        const data = (await response.json()) as AdminSession;
        if (cancelled) return;
        if (!data.user) {
          setGuard(GUARD.login);
          const sessionResponse = await fetch("/api/session");
          const sessionData = (await sessionResponse.json()) as {
            configured: boolean;
            providers: { id: string; name: string; configured: boolean }[];
          };
          if (!cancelled) {
            setProviders(sessionData.providers ?? []);
            setConfigured(sessionData.configured ?? false);
          }
          return;
        }
        if (!data.admin) {
          if (!cancelled) setGuard(GUARD.forbidden);
          return;
        }
        if (!cancelled) setGuard(GUARD.ok);
      } catch {
        if (!cancelled) setGuard(GUARD.login);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (guard !== GUARD.ok) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [overviewResponse, activitiesResponse] = await Promise.all([
          fetch("/api/admin/overview"),
          fetch("/api/admin/activities"),
        ]);
        if (cancelled) return;
        if (overviewResponse.ok) setOverview((await overviewResponse.json()) as Overview);
        if (activitiesResponse.ok) {
          const data = (await activitiesResponse.json()) as { activities: AdminActivity[] };
          setActivities(data.activities);
        }
      } catch {
        /* 面板上显示为空即可 */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [guard]);

  const loadSubmissions = async (slug: string) => {
    const requestId = ++submissionsRequest.current;
    setSubmissions(null);
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(slug)}/submissions`);
      const data = response.ok ? ((await response.json()) as { submissions: AdminSubmission[] }) : null;
      // 快速切换活动时丢弃过期响应：旧活动的作品串进当前面板，颁奖统计与导出 CSV 会跟着错
      if (requestId !== submissionsRequest.current) return;
      setSubmissions(data ? data.submissions : []);
    } catch {
      if (requestId !== submissionsRequest.current) return;
      setSubmissions([]);
    }
  };

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  }

  /** 读取待审核活动正文（GET /api/admin/activities/[slug]，管理端视角不受公开可见性限制）。 */
  async function openActivityInspect(slug: string) {
    const requestId = ++inspectRequest.current;
    setInspect({ slug, activity: null, failed: false });
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(slug)}`);
      const activity = response.ok ? (((await response.json()) as { activity: Activity }).activity ?? null) : null;
      if (requestId !== inspectRequest.current) return;
      setInspect({ slug, activity, failed: !response.ok });
    } catch {
      if (requestId !== inspectRequest.current) return;
      setInspect({ slug, activity: null, failed: true });
    }
  }

  // 用户 / 赛事两个标签按需加载：切过去时拉一次。
  useEffect(() => {
    if (guard !== GUARD.ok) return;
    if (tab === "users" && users === null) {
      let cancelled = false;
      void (async () => {
        try {
          const response = await fetch("/api/admin/users");
          if (!cancelled && response.ok) setUsers(((await response.json()) as { users: AdminUser[] }).users);
        } catch {
          if (!cancelled) setUsers([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (tab === "agents" && agents === null) {
      let cancelled = false;
      void (async () => {
        try {
          const response = await fetch("/api/admin/agents");
          if (!cancelled && response.ok) {
            setAgents(((await response.json()) as { applications: AgentApplication[] }).applications);
          }
        } catch {
          if (!cancelled) setAgents([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (tab === "events" && events === null) {
      let cancelled = false;
      void (async () => {
        try {
          const response = await fetch("/api/admin/events");
          if (!cancelled && response.ok) setEvents(((await response.json()) as { events: AdminExternalEvent[] }).events);
        } catch {
          if (!cancelled) setEvents([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (tab === "audit" && auditLogs === null) {
      let cancelled = false;
      void (async () => {
        try {
          const query = auditCategory ? `?category=${encodeURIComponent(auditCategory)}&limit=300` : "?limit=300";
          const response = await fetch(`/api/admin/audit${query}`);
          if (!cancelled && response.ok) setAuditLogs(((await response.json()) as { logs: AuditLog[] }).logs);
        } catch {
          if (!cancelled) setAuditLogs([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (tab === "blacklist" && blacklist === null) {
      let cancelled = false;
      void (async () => {
        try {
          const response = await fetch("/api/admin/blacklist");
          if (!cancelled && response.ok) setBlacklist(((await response.json()) as { entries: BlacklistEntry[] }).entries);
        } catch {
          if (!cancelled) setBlacklist([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [guard, tab, users, agents, events, auditLogs, auditCategory, blacklist]);

  /** 审计链完整性自检：任何一条被改过都会在这里断链（检查表 8.2c / 8.4.4）。 */
  async function verifyAudit() {
    setAuditIntegrity("正在校验…");
    try {
      const response = await fetch("/api/admin/audit/verify");
      const data = response.ok ? ((await response.json()) as { ok: boolean; checked: number; brokenAt: string | null }) : null;
      if (!data) {
        setAuditIntegrity("校验失败");
        return;
      }
      setAuditIntegrity(
        data.ok
          ? `完整性校验通过：${data.checked} 条记录哈希链一致`
          : `哈希链在 ${data.brokenAt} 处断裂，日志可能被改动`,
      );
    } catch {
      setAuditIntegrity("校验失败");
    }
  }

  async function addBlacklistEntry() {
    if (!blockForm.email || !blockForm.reason) return;
    const response = await fetch("/api/admin/blacklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(blockForm),
    });
    if (response.ok) {
      flash("已加入黑名单");
      setBlockForm({ email: "", reason: "", source: "platform" });
      setBlacklist(null);
    } else {
      flash("加入失败");
    }
  }

  async function revokeBlacklistEntry(id: string) {
    const response = await fetch(`/api/admin/blacklist/${encodeURIComponent(id)}`, { method: "DELETE" });
    flash(response.ok ? "已解除" : "解除失败");
    setBlacklist(null);
  }

  async function toggleVisibility(activity: AdminActivity) {
    setBusySlug(activity.slug);
    try {
      const next = activity.visibility === "public" ? "unlisted" : "public";
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activity.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (response.ok) {
        setActivities((rows) => rows.map((row) => (row.slug === activity.slug ? { ...row, visibility: next } : row)));
        flash(next === "public" ? "已设为公开" : "已设为不公开");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "操作失败");
      }
    } finally {
      setBusySlug(null);
    }
  }

  async function removeActivity(activity: AdminActivity) {
    if (!window.confirm(`确定删除「${activity.title}」？报名与作品记录会一并删除，且无法恢复。`)) return;
    setBusySlug(activity.slug);
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activity.slug)}`, { method: "DELETE" });
      if (response.ok) {
        setActivities((rows) => rows.filter((row) => row.slug !== activity.slug));
        flash("已删除");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "删除失败");
      }
    } finally {
      setBusySlug(null);
    }
  }

  /** 活动审核通过：pending → published；计数卡依赖 overview，通过后重读一次。 */
  async function approveActivity(activity: AdminActivity) {
    setBusySlug(activity.slug);
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activity.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus: "published" }),
      });
      if (response.ok) {
        setActivities((rows) => rows.map((row) => (row.slug === activity.slug ? { ...row, reviewStatus: "published" } : row)));
        try {
          const overviewResponse = await fetch("/api/admin/overview");
          if (overviewResponse.ok) setOverview((await overviewResponse.json()) as Overview);
        } catch {
          /* 计数短暂不新鲜无妨 */
        }
        flash("已审核通过");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "操作失败");
      }
    } finally {
      setBusySlug(null);
    }
  }

  async function review(submission: AdminSubmission, status: AdminSubmission["reviewStatus"]) {
    setBusySubmission(submission.id);
    try {
      const response = await fetch(`/api/admin/submissions/${encodeURIComponent(submission.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        setSubmissions((rows) =>
          rows ? rows.map((row) => (row.id === submission.id ? { ...row, reviewStatus: status } : row)) : rows,
        );
        // 待审核计数变了，总览卡片重读一次（事件处理器里可以随意 setState）。
        try {
          const overviewResponse = await fetch("/api/admin/overview");
          if (overviewResponse.ok) setOverview((await overviewResponse.json()) as Overview);
        } catch {
          /* 计数短暂不新鲜无妨 */
        }
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "审核失败");
      }
    } finally {
      setBusySubmission(null);
    }
  }

  function openSubmissions(slug: string) {
    setSelectedSlug(slug);
    setTab("submissions");
    void loadSubmissions(slug);
  }

  async function loadJoins(slug: string) {
    setJoins(null);
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(slug)}/joins`);
      if (response.ok) setJoins(((await response.json()) as { joins: AdminJoin[] }).joins);
      else setJoins([]);
    } catch {
      setJoins([]);
    }
  }

  function openJoins(slug: string) {
    setJoinsSlug(slug);
    void loadJoins(slug);
  }

  async function removeJoin(activity: AdminActivity, join: AdminJoin) {
    if (!window.confirm(`把 ${join.name || join.email} 的报名移除？只删报名记录，不影响账号。`)) return;
    setBusyJoin(join.userId);
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(activity.slug)}/joins`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: join.userId }),
      });
      if (response.ok) {
        setJoins((rows) => (rows ? rows.filter((row) => row.userId !== join.userId) : rows));
        setActivities((rows) =>
          rows.map((row) => (row.slug === activity.slug ? { ...row, joinCount: Math.max(0, row.joinCount - 1) } : row)),
        );
        void fetch("/api/admin/overview").then(async (response) => {
          if (response.ok) setOverview((await response.json()) as Overview);
        });
        flash("已移除报名");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "移除失败");
      }
    } finally {
      setBusyJoin(null);
    }
  }

  function exportJoinsCsv(activity: AdminActivity, rows: AdminJoin[]) {
    downloadCsv(
      `报名名单-${activity.slug}.csv`,
      ["昵称", "邮箱", "报名时间", "邀请人"],
      rows.map((row) => [row.name ?? "", row.email, row.joinedAt, row.inviterEmail ?? ""]),
    );
  }

  function exportSubmissionsCsv(activity: AdminActivity, rows: AdminSubmission[]) {
    downloadCsv(
      `作品列表-${activity.slug}.csv`,
      ["作者", "邮箱", "链接", "文案", "赞", "评", "转", "藏", "审核状态", "提交时间"],
      rows.map((row) => [
        row.userName || row.authorName || "",
        row.userEmail,
        row.url,
        row.caption ?? "",
        row.diggCount,
        row.commentCount,
        row.shareCount,
        row.collectCount,
        REVIEW_LABEL[row.reviewStatus],
        row.submittedAt,
      ]),
    );
  }

  function exportAwardCsv(activity: AdminActivity, stats: AwardStat[]) {
    downloadCsv(
      `颁奖统计-${activity.slug}.csv`,
      ["排名", "用户", "作品数", "已通过数", "赞", "评", "转", "藏", "加权总分"],
      stats.map((stat, index) => [index + 1, stat.name, stat.works, stat.approved, stat.likes, stat.comments, stat.shares, stat.collects, stat.total]),
    );
  }

  async function refreshSubmission(submission: AdminSubmission) {
    setBusySubmission(submission.id);
    try {
      const response = await fetch(`/api/admin/submissions/${encodeURIComponent(submission.id)}/refresh`, {
        method: "POST",
      });
      if (response.ok) {
        const data = (await response.json()) as { submission: AdminSubmission | null };
        if (data.submission) {
          setSubmissions((rows) =>
            rows ? rows.map((row) => (row.id === submission.id ? data.submission! : row)) : rows,
          );
          flash("数据已刷新");
        } else {
          flash("这个部署没有启用作品数据抓取");
        }
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "刷新失败");
      }
    } finally {
      setBusySubmission(null);
    }
  }

  /** 审核代理商申请：通过=授予代理商角色；驳回=留理由（用户可改后重提）。 */
  async function reviewAgent(id: string, decision: "approved" | "rejected") {
    let note: string | null = null;
    if (decision === "rejected") {
      note = window.prompt("驳回理由（会展示给申请人，可留空）：") ?? "";
      if (note === null) return;
    } else if (!window.confirm("通过该申请并授予代理商身份？通过后对方即可发布活动。")) return;
    setBusyAgent(id);
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      if (response.ok) {
        flash(decision === "approved" ? "已通过并授予代理商身份" : "已驳回");
        setAgents(null);
        setUsers(null);
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "操作失败");
      }
    } finally {
      setBusyAgent(null);
    }
  }

  /** 授予/收回代理商角色（用户标签的快捷操作；与申请审核走同一个角色字段）。 */
  async function setAgentRole(user: AdminUser, toAgent: boolean) {
    if (!window.confirm(`${toAgent ? "授予" : "收回"} ${user.email} 的代理商角色？`)) return;
    setBusyUser(user.id);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: toAgent ? "agent" : "user" }),
      });
      if (response.ok) {
        setUsers((rows) => (rows ? rows.map((row) => (row.id === user.id ? { ...row, role: toAgent ? "agent" : "user" } : row)) : rows));
        flash(toAgent ? "已授予代理商" : "已收回代理商");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "操作失败");
      }
    } finally {
      setBusyUser(null);
    }
  }

  async function toggleUserRole(user: AdminUser) {
    if (!window.confirm(`${user.role === "admin" ? "收回" : "授予"} ${user.email} 的管理员角色？`)) return;
    setBusyUser(user.id);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: user.role === "admin" ? "user" : "admin" }),
      });
      if (response.ok) {
        setUsers((rows) =>
          rows ? rows.map((row) => (row.id === user.id ? { ...row, role: row.role === "admin" ? "user" : "admin" } : row)) : rows,
        );
        flash("角色已更新");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "操作失败");
      }
    } finally {
      setBusyUser(null);
    }
  }

  async function removeUser(user: AdminUser) {
    if (!window.confirm(`确定删除 ${user.email}？其发起的活动、报名与作品记录都会一并删除，且无法恢复。`)) return;
    setBusyUser(user.id);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      if (response.ok) {
        setUsers((rows) => (rows ? rows.filter((row) => row.id !== user.id) : rows));
        flash("用户已删除");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "删除失败");
      }
    } finally {
      setBusyUser(null);
    }
  }

  async function toggleEventHidden(event: AdminExternalEvent) {
    setBusyEvent(event.id);
    try {
      const response = await fetch("/api/admin/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: event.id, hidden: !event.hidden }),
      });
      if (response.ok) {
        setEvents((rows) =>
          rows ? rows.map((row) => (row.id === event.id ? { ...row, hidden: !event.hidden } : row)) : rows,
        );
        flash(event.hidden ? "已恢复显示" : "已隐藏");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "操作失败");
      }
    } finally {
      setBusyEvent(null);
    }
  }

  async function removeEvent(event: AdminExternalEvent) {
    if (!window.confirm(`确定删除「${event.title}」？抓取脚本下次若再抓到会重新入库。`)) return;
    setBusyEvent(event.id);
    try {
      const response = await fetch("/api/admin/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: event.id }),
      });
      if (response.ok) {
        setEvents((rows) => (rows ? rows.filter((row) => row.id !== event.id) : rows));
        flash("已删除");
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        flash(data?.error ?? "删除失败");
      }
    } finally {
      setBusyEvent(null);
    }
  }

  const selectedActivity = activities.find((row) => row.slug === selectedSlug) ?? null;
  // 颁奖统计：选定活动且有作品时按 WEIGHTS 即时聚合（刷新数据/切换活动后自动更新，不落库）。
  const selectedStats = selectedActivity && submissions && submissions.length > 0 ? awardStats(submissions) : null;

  /** 待审核活动详情面板：公开详情页对管理员也是 404，审核前在这里读正文。 */
  function renderInspectPanel() {
    if (!inspect) return null;
    const activity = inspect.activity;
    const district = activity ? factionById(activity.district) : undefined;
    return (
      <div className="manage-joins-panel">
        <div className="manage-joins-head">
          <h3>活动详情 · {activities.find((row) => row.slug === inspect.slug)?.title ?? inspect.slug}</h3>
          <button className="manage-link" onClick={() => setInspect(null)}>收起</button>
        </div>
        {inspect.failed && <p className="detail-placeholder">读取失败，请稍后重试。</p>}
        {!inspect.failed && !activity && <p className="detail-placeholder">正在读取活动…</p>}
        {activity && (
          <>
            {activity.subtitle && <p className="detail-placeholder">{activity.subtitle}</p>}
            <dl className="manage-inspect-grid">
              <div><dt>主办方</dt><dd>{activity.host || "—"}</dd></div>
              <div><dt>联系方式</dt><dd>{activity.contact || "—"}</dd></div>
              <div><dt>类别 / 所属区</dt><dd>{categoryLabel(activity.category)}{district ? ` · ${district.name}` : ""}</dd></div>
              <div><dt>形式 / 地点</dt><dd>{formatLabel(activity)}{activity.format === "offline" && activity.venue ? ` · ${activity.venue}` : ""}</dd></div>
              <div><dt>费用</dt><dd>{pricingLabel(activity)}{activity.fee ? ` · ${activity.fee}` : ""}</dd></div>
              <div><dt>时间</dt><dd>{activity.startsAt} ~ {activity.endsAt || "待定"}</dd></div>
              <div><dt>谁能参加</dt><dd>{joinPolicyLabel(activity)}</dd></div>
              <div><dt>评审方式</dt><dd>{judgingLabel(activity.judging)}</dd></div>
              <div><dt>奖项</dt><dd>{prizeText(activity)}{activity.awardsEnabled && activity.awards.length > 0 ? ` · ${activity.awards.map((award) => award.name).join("、")}` : ""}</dd></div>
              <div><dt>提交形式</dt><dd>{submissionLabels(activity.submissionTypes).join("、") || "—"}</dd></div>
            </dl>
            {activity.overview && <p className="manage-inspect-overview">{activity.overview}</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <main className="detail-page manage-page">
      <header className="detail-top" data-reveal="block">
        <Link className="detail-back" href="/"><ArrowLeft size={17} /> 返回首页</Link>
        <span className="detail-top-title">管理端口</span>
        <span className="detail-top-note">{guard === GUARD.ok ? "管理员" : guard === GUARD.loading ? "读取中" : "受限"}</span>
      </header>

      {guard === GUARD.loading && (
        <div className="manage-card" data-reveal="block">
          <p className="eyebrow">MANAGE</p>
          <h1>正在校验权限…</h1>
          <span className="session-placeholder" aria-hidden="true" />
        </div>
      )}

      {guard === GUARD.noDb && (
        <div className="manage-card" data-reveal="block">
          <p className="eyebrow">MANAGE</p>
          <h1>此部署未连接数据库</h1>
          <p className="detail-placeholder">
            管理端口依赖服务端数据库（自托管版）。hangkathon.net（Vercel）的数据在本机浏览器里，没有可管理的服务端数据。
          </p>
          <Button asChild className="primary-action"><Link href="/">返回首页</Link></Button>
        </div>
      )}

      {guard === GUARD.login && (
        <div className="manage-card" data-reveal="block">
          <p className="eyebrow">MANAGE</p>
          <h1>先登录，再进管理端口</h1>
          <p className="detail-placeholder">管理端口只对管理员账号开放；登录后若账号在管理员名单内，会自动进入面板。</p>
          <div className="provider-list">
            {providers.map((provider) => (
              <button
                key={provider.id}
                className="provider-button"
                disabled={!configured || !provider.configured}
                onClick={() => void signIn(provider.id, { callbackUrl: "/manage" })}
              >
                <span>使用 {provider.name} 登录</span>
                {!provider.configured && <span className="provider-state">未配置</span>}
              </button>
            ))}
          </div>
          {!configured && <p className="detail-placeholder">本环境未配置登录。</p>}
          <Button asChild className="primary-action"><Link href="/">返回首页</Link></Button>
        </div>
      )}

      {guard === GUARD.forbidden && (
        <div className="manage-card" data-reveal="block">
          <p className="eyebrow">MANAGE</p>
          <h1>无管理员权限</h1>
          <p className="detail-placeholder">
            当前账号不在管理员名单内。如需开通，请站长把登录邮箱加入服务器 ADMIN_EMAILS 后重建容器。
          </p>
          <Button asChild className="primary-action"><Link href="/">返回首页</Link></Button>
        </div>
      )}

      {guard === GUARD.ok && (
        <div className="manage-body">
          <nav className="manage-tabs" aria-label="管理端口分区" data-reveal="block">
            <button className={`manage-tab${tab === "overview" ? " is-on" : ""}`} onClick={() => setTab("overview")}>总览</button>
            <button className={`manage-tab${tab === "activities" ? " is-on" : ""}`} onClick={() => setTab("activities")}>活动</button>
            <button className={`manage-tab${tab === "submissions" ? " is-on" : ""}`} onClick={() => setTab("submissions")}>作品</button>
            <button className={`manage-tab${tab === "users" ? " is-on" : ""}`} onClick={() => setTab("users")}>用户</button>
            <button className={`manage-tab${tab === "agents" ? " is-on" : ""}`} onClick={() => setTab("agents")}>代理商</button>
            <button className={`manage-tab${tab === "events" ? " is-on" : ""}`} onClick={() => setTab("events")}>全球赛事</button>
            <button className={`manage-tab${tab === "audit" ? " is-on" : ""}`} onClick={() => setTab("audit")}>审计日志</button>
            <button className={`manage-tab${tab === "blacklist" ? " is-on" : ""}`} onClick={() => setTab("blacklist")}>黑名单</button>
          </nav>

          {notice && <p className="manage-notice" role="status">{notice}</p>}

          {tab === "overview" && (
            <section className="manage-section" aria-label="数据总览" data-reveal="block">
              <div className="manage-stats">
                {[
                  { label: "用户", value: overview?.users },
                  { label: "活动", value: overview?.activities },
                  { label: "报名", value: overview?.joins },
                  { label: "作品", value: overview?.submissions },
                  { label: "待审核作品", value: overview?.pendingReviews, hot: (overview?.pendingReviews ?? 0) > 0 },
                  { label: "待审核活动", value: overview?.pendingActivities, hot: (overview?.pendingActivities ?? 0) > 0 },
                  { label: "待审代理商", value: overview?.pendingAgents, hot: (overview?.pendingAgents ?? 0) > 0 },
                ].map((card) => (
                  <div key={card.label} className={`manage-stat${card.hot ? " is-hot" : ""}`}>
                    <strong>{card.value === undefined ? "—" : card.value.toLocaleString("zh-CN")}</strong>
                    <span>{card.label}</span>
                  </div>
                ))}
              </div>
              <p className="detail-placeholder">
                待审核作品在「作品」标签里处理；代理商申请在「代理商」标签里审核，通过后对方才能发布活动；贡献值结算流程接入后，审核通过将自动折算贡献值。
              </p>
            </section>
          )}

          {tab === "activities" && (
            <section className="manage-section" aria-label="全部活动" data-reveal="block">
              {activities.length === 0 ? (
                <p className="detail-placeholder">还没有活动。</p>
              ) : (
                <div className="manage-table-wrap">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>活动</th>
                        <th>发起人</th>
                        <th>时间</th>
                        <th className="num">报名</th>
                        <th className="num">作品</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activities.map((activity) => {
                        const district = factionById(activity.district);
                        return (
                          <tr key={activity.id}>
                            <td>
                              {activity.reviewStatus === "pending" ? (
                                <button
                                  className="manage-act-link manage-act-button"
                                  title="待审核活动详情页未公开，点这里查看内容"
                                  onClick={() => void openActivityInspect(activity.slug)}
                                >
                                  {activity.title}
                                </button>
                              ) : (
                                <Link className="manage-act-link" href={`/activities/${activity.slug}`}>{activity.title}</Link>
                              )}
                              <span className="manage-act-slug">{activity.seeded ? "预置 · " : ""}{activity.slug}</span>
                            </td>
                            <td>{activity.ownerName || activity.ownerEmail || "—"}</td>
                            <td className="manage-act-date">{activity.startsAt} ~ {activity.endsAt}</td>
                            <td className="num">
                              {activity.joinCount > 0 ? (
                                <button className="manage-link" onClick={() => openJoins(activity.slug)}>
                                  {activity.joinCount}
                                </button>
                              ) : (
                                0
                              )}
                            </td>
                            <td className="num">
                              {activity.submissionCount > 0 ? (
                                <button className="manage-link" onClick={() => openSubmissions(activity.slug)}>
                                  {activity.submissionCount}
                                </button>
                              ) : (
                                0
                              )}
                            </td>
                            <td>
                              <span className={`manage-pill${activity.visibility === "public" ? " is-public" : ""}`}>
                                {activity.visibility === "public" ? "公开" : "不公开"}
                              </span>
                              {activity.reviewStatus === "pending" && <span className="manage-pill is-warn">待审核</span>}
                              {district && <span className="manage-district" style={{ color: district.color }}>{district.name}</span>}
                            </td>
                            <td>
                              <div className="manage-actions">
                                {activity.reviewStatus === "pending" && (
                                  <button
                                    className="manage-link is-approve"
                                    disabled={busySlug === activity.slug}
                                    onClick={() => void approveActivity(activity)}
                                  >
                                    <Check size={13} /> 审核通过
                                  </button>
                                )}
                                <button
                                  className="manage-link"
                                  disabled={busySlug === activity.slug}
                                  onClick={() => void toggleVisibility(activity)}
                                >
                                  {activity.visibility === "public" ? <><EyeOff size={13} /> 不公开</> : <><Globe size={13} /> 公开</>}
                                </button>
                                <button
                                  className="manage-link is-danger"
                                  disabled={busySlug === activity.slug || activity.seeded}
                                  title={activity.seeded ? "预置活动由代码同步管理" : undefined}
                                  onClick={() => void removeActivity(activity)}
                                >
                                  <Trash2 size={13} /> 删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {renderInspectPanel()}

              {joinsSlug && (
                <div className="manage-joins-panel">
                  <div className="manage-joins-head">
                    <h3>报名名单 · {activities.find((row) => row.slug === joinsSlug)?.title ?? joinsSlug}</h3>
                    <div className="manage-actions">
                      <button
                        className="manage-link"
                        onClick={() => {
                          const activity = activities.find((row) => row.slug === joinsSlug);
                          if (activity && joins) exportJoinsCsv(activity, joins);
                        }}
                        disabled={!joins || joins.length === 0}
                      >
                        <Download size={13} /> 导出 CSV
                      </button>
                      <button className="manage-link" onClick={() => setJoinsSlug(null)}>收起</button>
                    </div>
                  </div>
                  {joins === null && <p className="detail-placeholder">正在读取报名…</p>}
                  {joins?.length === 0 && <p className="detail-placeholder">这个活动还没有人报名。</p>}
                  {joins && joins.length > 0 && (
                    <div className="manage-table-wrap">
                      <table className="manage-table">
                        <thead>
                          <tr>
                            <th>昵称</th>
                            <th>邮箱</th>
                            <th>报名时间</th>
                            <th>邀请人</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {joins.map((join) => (
                            <tr key={join.userId}>
                              <td>{join.name || "—"}</td>
                              <td>{join.email}</td>
                              <td className="manage-act-date">{new Date(join.joinedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</td>
                              <td>{join.inviterEmail ?? "—"}</td>
                              <td>
                                <button
                                  className="manage-link is-danger"
                                  disabled={busyJoin === join.userId}
                                  onClick={() => {
                                    const activity = activities.find((row) => row.slug === joinsSlug);
                                    if (activity) void removeJoin(activity, join);
                                  }}
                                >
                                  <X size={13} /> 移除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === "submissions" && (
            <section className="manage-section" aria-label="作品审核" data-reveal="block">
              <div className="manage-submission-picker">
                <label htmlFor="manage-activity-select">选择活动</label>
                <select
                  id="manage-activity-select"
                  value={selectedSlug ?? ""}
                  onChange={(event) => openSubmissions(event.target.value)}
                >
                  <option value="" disabled>— 请选择 —</option>
                  {activities.map((activity) => (
                    <option key={activity.id} value={activity.slug}>
                      {activity.title}（{activity.submissionCount} 件）
                    </option>
                  ))}
                </select>
                {selectedActivity && submissions !== null && (
                  <span className="detail-placeholder">{submissions.length} 件作品</span>
                )}
                {selectedActivity && submissions && submissions.length > 0 && (
                  <button className="manage-link" onClick={() => exportSubmissionsCsv(selectedActivity, submissions)}>
                    <Download size={13} /> 导出 CSV
                  </button>
                )}
              </div>

              {selectedStats && (
                <div className="manage-award-panel">
                  <div className="manage-award-head">
                    <h3>颁奖统计 · {selectedActivity?.title}</h3>
                    <button
                      className="manage-link"
                      onClick={() => {
                        if (selectedActivity) exportAwardCsv(selectedActivity, selectedStats);
                      }}
                    >
                      <Download size={13} /> 导出加权汇总 CSV
                    </button>
                  </div>
                  <div className="manage-table-wrap">
                    <table className="manage-table">
                      <thead>
                        <tr>
                          <th>排名</th>
                          <th>用户</th>
                          <th className="num">作品数</th>
                          <th className="num">已通过数</th>
                          <th className="num">赞</th>
                          <th className="num">评</th>
                          <th className="num">转</th>
                          <th className="num">藏</th>
                          <th className="num">加权总分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedStats.map((stat, index) => (
                          <tr key={stat.email}>
                            <td>{index + 1}</td>
                            <td>
                              <strong>{stat.name}</strong>
                              <span className="manage-act-slug">{stat.email}</span>
                            </td>
                            <td className="num">{stat.works}</td>
                            <td className="num">{stat.approved}</td>
                            <td className="num">{stat.likes}</td>
                            <td className="num">{stat.comments}</td>
                            <td className="num">{stat.shares}</td>
                            <td className="num">{stat.collects}</td>
                            <td className="num">{stat.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="detail-placeholder">口径：仅已通过作品计入互动量与加权总分（驳回/待审核不计）；同一链接重复提交只算一件。</p>
                </div>
              )}

              {selectedSlug && submissions === null && <p className="detail-placeholder">正在读取作品…</p>}
              {selectedSlug && submissions?.length === 0 && (
                <p className="detail-placeholder">这个活动还没有作品提交。</p>
              )}

              {submissions && submissions.length > 0 && (
                <div className="manage-submission-list">
                  {submissions.map((submission) => (
                    <article key={submission.id} className={`manage-submission is-${submission.reviewStatus}`}>
                      <div className="manage-submission-head">
                        <strong>{submission.userName || submission.userEmail}</strong>
                        <span className="manage-submission-mail">{submission.userEmail}</span>
                        <span className={`manage-pill${submission.reviewStatus === "approved" ? " is-public" : ""}`}>
                          {REVIEW_LABEL[submission.reviewStatus]}
                        </span>
                        <time>{new Date(submission.submittedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</time>
                      </div>
                      {submission.caption && <p className="manage-submission-caption">{submission.caption}</p>}
                      <p className="manage-submission-url">
                        <a href={submission.url} target="_blank" rel="noopener noreferrer nofollow">{submission.url}</a>
                      </p>
                      <div className="manage-metrics">
                        <span>赞 {fmtCount(submission.diggCount)}</span>
                        <span>评 {fmtCount(submission.commentCount)}</span>
                        <span>转 {fmtCount(submission.shareCount)}</span>
                        <span>藏 {fmtCount(submission.collectCount)}</span>
                        {submission.metricsError && <em className="manage-metrics-error">抓取失败：{submission.metricsError}</em>}
                      </div>
                      <div className="manage-actions">
                        <button
                          className="manage-link"
                          disabled={busySubmission === submission.id}
                          onClick={() => void refreshSubmission(submission)}
                        >
                          <RefreshCw size={13} /> 刷新数据
                        </button>
                        <button
                          className="manage-link is-approve"
                          disabled={busySubmission === submission.id || submission.reviewStatus === "approved"}
                          onClick={() => void review(submission, "approved")}
                        >
                          <Check size={13} /> 通过
                        </button>
                        <button
                          className="manage-link is-danger"
                          disabled={busySubmission === submission.id || submission.reviewStatus === "rejected"}
                          onClick={() => void review(submission, "rejected")}
                        >
                          <X size={13} /> 驳回
                        </button>
                        {submission.reviewStatus !== "pending" && (
                          <button
                            className="manage-link"
                            disabled={busySubmission === submission.id}
                            onClick={() => void review(submission, "pending")}
                          >
                            撤回待审核
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === "users" && (
            <section className="manage-section" aria-label="用户管理" data-reveal="block">
              {users === null ? (
                <p className="detail-placeholder">正在读取用户…</p>
              ) : users.length === 0 ? (
                <p className="detail-placeholder">还没有用户。</p>
              ) : (
                <div className="manage-table-wrap">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>用户</th>
                        <th>角色</th>
                        <th className="num">发起</th>
                        <th className="num">报名</th>
                        <th className="num">作品</th>
                        <th>注册时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.name || "—"}</strong>
                            <span className="manage-act-slug">{user.email}</span>
                          </td>
                          <td>
                            <span className={`manage-pill${user.role === "admin" ? " is-public" : user.role === "agent" ? " is-agent" : ""}`}>
                              {user.role === "admin" ? "管理员" : user.role === "agent" ? "代理商" : "用户"}
                            </span>
                          </td>
                          <td className="num">{user.activityCount}</td>
                          <td className="num">{user.joinCount}</td>
                          <td className="num">{user.submissionCount}</td>
                          <td className="manage-act-date">{new Date(user.createdAt).toLocaleDateString("zh-CN")}</td>
                          <td>
                            <div className="manage-actions">
                              <button
                                className="manage-link"
                                disabled={busyUser === user.id}
                                title={user.role === "admin" ? "收回管理员" : "设为管理员"}
                                onClick={() => void toggleUserRole(user)}
                              >
                                {user.role === "admin" ? <><ShieldOff size={13} /> 收回管理员</> : <><ShieldCheck size={13} /> 设为管理员</>}
                              </button>
                              {user.role !== "admin" && (
                                <button
                                  className="manage-link"
                                  disabled={busyUser === user.id}
                                  title={user.role === "agent" ? "收回代理商（对方将不能再发布活动）" : "直接授予代理商（可发布活动）"}
                                  onClick={() => void setAgentRole(user, user.role !== "agent")}
                                >
                                  {user.role === "agent" ? <><ShieldOff size={13} /> 收回代理商</> : <><Rocket size={13} /> 设为代理商</>}
                                </button>
                              )}
                              <button
                                className="manage-link is-danger"
                                disabled={busyUser === user.id}
                                onClick={() => void removeUser(user)}
                              >
                                <Trash2 size={13} /> 删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="detail-placeholder">
                删除用户会级联删除其发起的活动、报名与作品记录，无法恢复；角色改动立即生效（自己的角色不能在这里改，用服务器 ADMIN_EMAILS 管理）。
              </p>
            </section>
          )}

          {tab === "audit" && (
            <section className="manage-section" aria-label="审计日志" data-reveal="block">
              <div className="manage-toolbar">
                <select
                  aria-label="按分类筛选"
                  value={auditCategory}
                  onChange={(event) => {
                    setAuditCategory(event.target.value);
                    setAuditLogs(null);
                  }}
                >
                  <option value="">全部分类</option>
                  {Object.entries(AUDIT_CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <a className="manage-link" href={`/api/admin/audit?format=csv${auditCategory ? `&category=${encodeURIComponent(auditCategory)}` : ""}&limit=2000`}>
                  导出 CSV
                </a>
                <button className="manage-link" onClick={() => void verifyAudit()}>
                  完整性自检
                </button>
                {auditIntegrity && <span className="manage-note">{auditIntegrity}</span>}
              </div>
              {auditLogs === null ? (
                <p className="detail-placeholder">正在读取审计日志…</p>
              ) : auditLogs.length === 0 ? (
                <p className="detail-placeholder">还没有审计记录。</p>
              ) : (
                <div className="manage-table-wrap">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>分类</th>
                        <th>动作</th>
                        <th>账号</th>
                        <th>来源 IP:端口</th>
                        <th>对象</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="manage-act-date">{new Date(log.createdAt).toLocaleString("zh-CN")}</td>
                          <td>{AUDIT_CATEGORY_LABEL[log.category] ?? log.category}</td>
                          <td>{log.action}</td>
                          <td>{log.userEmail ?? "—"}</td>
                          <td>{log.ip ? `${log.ip}:${log.port ?? "?"}` : "—"}</td>
                          <td>{log.targetType ? `${log.targetType} ${log.targetId ?? ""}` : "—"}</td>
                          <td>
                            <span className={`manage-pill${log.result === "denied" || log.result === "failed" ? "" : " is-public"}`}>
                              {log.result === "success" ? "成功" : log.result === "denied" ? "已拦截" : "失败"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="detail-placeholder">
                记录用户注册、登录登出、内容发布、报名行为与管理操作，逐条带 IP、端口与协议，可溯源到真实账号。
                日志表只允许写入：应用层与数据库触发器都拒绝修改和删除。
              </p>
            </section>
          )}

          {tab === "blacklist" && (
            <section className="manage-section" aria-label="用户黑名单" data-reveal="block">
              <div className="manage-toolbar">
                <input
                  aria-label="账号邮箱"
                  placeholder="账号邮箱"
                  value={blockForm.email}
                  onChange={(event) => setBlockForm({ ...blockForm, email: event.target.value })}
                />
                <input
                  aria-label="列入原因"
                  placeholder="列入原因（必填）"
                  value={blockForm.reason}
                  onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })}
                />
                <select
                  aria-label="来源"
                  value={blockForm.source}
                  onChange={(event) => setBlockForm({ ...blockForm, source: event.target.value })}
                >
                  <option value="platform">平台自查</option>
                  <option value="police">公安通报</option>
                </select>
                <button className="manage-link" onClick={() => void addBlacklistEntry()}>加入黑名单</button>
              </div>
              {blacklist === null ? (
                <p className="detail-placeholder">正在读取黑名单…</p>
              ) : blacklist.length === 0 ? (
                <p className="detail-placeholder">黑名单为空。</p>
              ) : (
                <div className="manage-table-wrap">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>账号</th>
                        <th>原因</th>
                        <th>来源</th>
                        <th className="num">命中</th>
                        <th>生效时间</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blacklist.map((entry) => (
                        <tr key={entry.id} className={entry.revokedAt ? "is-dim" : undefined}>
                          <td>{entry.email}</td>
                          <td>{entry.reason}</td>
                          <td>{entry.source === "police" ? "公安通报" : "平台自查"}</td>
                          <td className="num">{entry.hits}</td>
                          <td className="manage-act-date">{new Date(entry.effectiveFrom).toLocaleString("zh-CN")}</td>
                          <td>
                            <span className={`manage-pill${entry.revokedAt ? "" : " is-public"}`}>
                              {entry.revokedAt ? "已解除" : "生效中"}
                            </span>
                          </td>
                          <td>
                            {entry.revokedAt ? null : (
                              <button className="manage-link" onClick={() => void revokeBlacklistEntry(entry.id)}>
                                解除
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="detail-placeholder">
                黑名单内账号无法发起活动、报名与提交作品；连续命中内容过滤会自动入名单，解除需要记录操作人。
              </p>
            </section>
          )}

          {tab === "agents" && (
            <section className="manage-section" aria-label="代理商管理" data-reveal="block">
              {agents === null ? (
                <p className="detail-placeholder">正在读取代理商申请…</p>
              ) : agents.length === 0 ? (
                <p className="detail-placeholder">还没有收到代理商申请。</p>
              ) : (
                <div className="manage-table-wrap">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>申请人</th>
                        <th>联系人</th>
                        <th>机构 / 电话</th>
                        <th>身份声明</th>
                        <th>状态</th>
                        <th>申请时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((item) => (
                        <tr key={item.id} className={item.status !== "pending" ? "is-dim" : undefined}>
                          <td>
                            <strong>{item.userName || "—"}</strong>
                            <span className="manage-act-slug">{item.userEmail ?? "—"}</span>
                          </td>
                          <td>{item.contactName}</td>
                          <td>
                            {item.organization || "—"}
                            <span className="manage-act-slug">{item.phone}</span>
                          </td>
                          <td className="manage-agent-statement" title={item.statement}>
                            {item.statement.length > 60 ? `${item.statement.slice(0, 60)}…` : item.statement}
                          </td>
                          <td>
                            <span className={`manage-pill${item.status === "approved" ? " is-public" : item.status === "pending" ? " is-agent" : ""}`}>
                              {item.status === "pending" ? "待审核" : item.status === "approved" ? "已通过" : "已驳回"}
                            </span>
                            {item.reviewNote && <span className="manage-act-slug">{item.reviewNote}</span>}
                          </td>
                          <td className="manage-act-date">{new Date(item.updatedAt).toLocaleString("zh-CN")}</td>
                          <td>
                            {item.status === "pending" ? (
                              <div className="manage-actions">
                                <button className="manage-link" disabled={busyAgent === item.id} onClick={() => void reviewAgent(item.id, "approved")}>
                                  <ShieldCheck size={13} /> 通过
                                </button>
                                <button className="manage-link is-danger" disabled={busyAgent === item.id} onClick={() => void reviewAgent(item.id, "rejected")}>
                                  驳回
                                </button>
                              </div>
                            ) : (
                              <span className="manage-act-slug">已处理</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="detail-placeholder">
                只有代理商可以发布活动。通过申请会自动把对方角色提为代理商；也可以在「用户」标签里直接授予/收回。
                所有授予与收回都会写入审计日志。
              </p>
            </section>
          )}

          {tab === "events" && (
            <section className="manage-section" aria-label="全球赛事管理" data-reveal="block">
              {events === null ? (
                <p className="detail-placeholder">正在读取赛事…</p>
              ) : events.length === 0 ? (
                <p className="detail-placeholder">还没有抓到外部赛事。</p>
              ) : (
                <div className="manage-table-wrap">
                  <table className="manage-table">
                    <thead>
                      <tr>
                        <th>赛事</th>
                        <th>来源</th>
                        <th>开始 / 截止</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((event) => (
                        <tr key={event.id} className={event.hidden ? "is-dim" : undefined}>
                          <td>
                            <a className="manage-act-link" href={event.url} target="_blank" rel="noopener noreferrer nofollow">
                              {event.title}
                            </a>
                          </td>
                          <td>{SOURCE_LABEL[event.source] ?? event.source}</td>
                          <td className="manage-act-date">
                            {event.startsAt ? new Date(event.startsAt).toLocaleDateString("zh-CN") : "—"}
                            {event.deadlineAt ? ` / 截止 ${new Date(event.deadlineAt).toLocaleDateString("zh-CN")}` : ""}
                          </td>
                          <td>
                            <span className={`manage-pill${event.hidden ? "" : " is-public"}`}>
                              {event.hidden ? "已隐藏" : "展示中"}
                            </span>
                          </td>
                          <td>
                            <div className="manage-actions">
                              <button
                                className="manage-link"
                                disabled={busyEvent === event.id}
                                onClick={() => void toggleEventHidden(event)}
                              >
                                {event.hidden ? <><Globe size={13} /> 恢复显示</> : <><EyeOff size={13} /> 隐藏</>}
                              </button>
                              <button
                                className="manage-link is-danger"
                                disabled={busyEvent === event.id}
                                onClick={() => void removeEvent(event)}
                              >
                                <Trash2 size={13} /> 删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="detail-placeholder">
                隐藏只影响活动页的全球赛事列表，抓取脚本不会重置该标记；删除后若来源站仍有该赛事，次日电抓会重新入库。
              </p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
