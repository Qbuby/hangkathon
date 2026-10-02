"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ArrowLeft, Check, EyeOff, Globe, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
};

type AdminActivity = {
  id: string;
  slug: string;
  title: string;
  district: string;
  visibility: "public" | "unlisted";
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

type Tab = "overview" | "activities" | "submissions";

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
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null);
  const [busySubmission, setBusySubmission] = useState<string | null>(null);

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
    setSubmissions(null);
    try {
      const response = await fetch(`/api/admin/activities/${encodeURIComponent(slug)}/submissions`);
      if (response.ok) {
        const data = (await response.json()) as { submissions: AdminSubmission[] };
        setSubmissions(data.submissions);
      } else {
        setSubmissions([]);
      }
    } catch {
      setSubmissions([]);
    }
  };

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
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

  const selectedActivity = activities.find((row) => row.slug === selectedSlug) ?? null;

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
                ].map((card) => (
                  <div key={card.label} className={`manage-stat${card.hot ? " is-hot" : ""}`}>
                    <strong>{card.value === undefined ? "—" : card.value.toLocaleString("zh-CN")}</strong>
                    <span>{card.label}</span>
                  </div>
                ))}
              </div>
              <p className="detail-placeholder">
                待审核作品在「作品」标签里处理；贡献值结算流程接入后，审核通过将自动折算贡献值。
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
                              <Link className="manage-act-link" href={`/activities/${activity.slug}`}>{activity.title}</Link>
                              <span className="manage-act-slug">{activity.seeded ? "预置 · " : ""}{activity.slug}</span>
                            </td>
                            <td>{activity.ownerName || activity.ownerEmail || "—"}</td>
                            <td className="manage-act-date">{activity.startsAt} ~ {activity.endsAt}</td>
                            <td className="num">{activity.joinCount}</td>
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
                              {district && <span className="manage-district" style={{ color: district.color }}>{district.name}</span>}
                            </td>
                            <td>
                              <div className="manage-actions">
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
              </div>

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
        </div>
      )}
    </main>
  );
}
