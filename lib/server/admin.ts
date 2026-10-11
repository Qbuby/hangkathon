import { count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { captureMetrics } from "./work-metrics";
import type { ActivityReviewStatus, Visibility } from "@/lib/activity";

/**
 * 管理端口的服务端能力：全量活动、全量作品、用户、报名、外部赛事、
 * 总览计数与审核/下线操作。只有 requireAdmin() 通过后的路由才会走到这里；
 * 错误统一由 handleRouteError 出口（AdminActionError 由路由层映射为 4xx）。
 */

export type AdminOverview = {
  users: number;
  activities: number;
  joins: number;
  submissions: number;
  pendingReviews: number;
  /** 待审核活动（用户发起、还没通过审核的）。 */
  pendingActivities: number;
  /** 待审核的代理商申请。 */
  pendingAgents: number;
};

export type AdminActivityRow = {
  id: string;
  slug: string;
  title: string;
  district: string;
  visibility: Visibility;
  reviewStatus: ActivityReviewStatus;
  seeded: boolean;
  startsAt: string;
  endsAt: string;
  ownerEmail: string | null;
  ownerName: string | null;
  joinCount: number;
  submissionCount: number;
  createdAt: string;
};

export type AdminSubmissionRow = {
  id: string;
  activityId: string;
  url: string;
  submittedAt: string;
  authorName: string | null;
  caption: string | null;
  diggCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  collectCount: number | null;
  metricsError: string | null;
  reviewStatus: string;
  userEmail: string;
  userName: string | null;
};

export async function adminOverview(): Promise<AdminOverview> {
  const db = getDb();
  const [usersRow] = await db.select({ value: count() }).from(schema.users);
  const [activitiesRow] = await db.select({ value: count() }).from(schema.activities);
  const [joinsRow] = await db.select({ value: count() }).from(schema.joins);
  const [submissionsRow] = await db.select({ value: count() }).from(schema.submissions);
  const [pendingRow] = await db
    .select({ value: count() })
    .from(schema.submissions)
    .where(eq(schema.submissions.reviewStatus, "pending"));
  const [pendingActivitiesRow] = await db
    .select({ value: count() })
    .from(schema.activities)
    .where(eq(schema.activities.reviewStatus, "pending"));
  const [pendingAgentsRow] = await db
    .select({ value: count() })
    .from(schema.agentApplications)
    .where(eq(schema.agentApplications.status, "pending"));
  return {
    users: Number(usersRow?.value ?? 0),
    activities: Number(activitiesRow?.value ?? 0),
    joins: Number(joinsRow?.value ?? 0),
    submissions: Number(submissionsRow?.value ?? 0),
    pendingReviews: Number(pendingRow?.value ?? 0),
    pendingActivities: Number(pendingActivitiesRow?.value ?? 0),
    pendingAgents: Number(pendingAgentsRow?.value ?? 0),
  };
}

export async function listAllActivities(): Promise<AdminActivityRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.activities.id,
      slug: schema.activities.slug,
      title: schema.activities.title,
      district: schema.activities.district,
      visibility: schema.activities.visibility,
      reviewStatus: schema.activities.reviewStatus,
      seeded: schema.activities.seeded,
      startsAt: schema.activities.startsAt,
      endsAt: schema.activities.endsAt,
      createdAt: schema.activities.createdAt,
      ownerEmail: schema.users.email,
      ownerName: schema.users.name,
      joinCount: sql<number>`(select count(*) from ${schema.joins} where ${schema.joins.activityId} = ${schema.activities.id})`,
      submissionCount: sql<number>`(select count(*) from ${schema.submissions} where ${schema.submissions.activityId} = ${schema.activities.id})`,
    })
    .from(schema.activities)
    .leftJoin(schema.users, eq(schema.activities.ownerId, schema.users.id))
    .orderBy(desc(schema.activities.createdAt));
  return rows.map((row) => ({
    ...row,
    visibility: row.visibility as Visibility,
    reviewStatus: row.reviewStatus as ActivityReviewStatus,
    joinCount: Number(row.joinCount ?? 0),
    submissionCount: Number(row.submissionCount ?? 0),
    createdAt: row.createdAt.toISOString(),
  }));
}

export class AdminActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminActionError";
    this.status = status;
  }
}

export async function setActivityVisibility(slug: string, visibility: Visibility): Promise<void> {
  if (visibility !== "public" && visibility !== "unlisted") {
    throw new AdminActionError(400, "公开状态只能是 public 或 unlisted");
  }
  const db = getDb();
  const updated = await db
    .update(schema.activities)
    .set({ visibility })
    .where(eq(schema.activities.slug, slug))
    .returning({ id: schema.activities.id });
  if (updated.length === 0) throw new AdminActionError(404, "活动不存在");
}

/**
 * 活动审核：两态模型（pending → published），白名单只放行 published；
 * 要下架用 setActivityVisibility，要驳回直接删除该活动。
 */
export async function setActivityReview(slug: string, reviewStatus: ActivityReviewStatus): Promise<void> {
  if (reviewStatus !== "published") {
    throw new AdminActionError(400, "活动审核状态只能是 published");
  }
  const db = getDb();
  const updated = await db
    .update(schema.activities)
    .set({ reviewStatus })
    .where(eq(schema.activities.slug, slug))
    .returning({ id: schema.activities.id });
  if (updated.length === 0) throw new AdminActionError(404, "活动不存在");
}

export async function deleteActivity(slug: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.activities.id, seeded: schema.activities.seeded })
    .from(schema.activities)
    .where(eq(schema.activities.slug, slug));
  if (!row) throw new AdminActionError(404, "活动不存在");
  if (row.seeded) {
    throw new AdminActionError(400, "预置活动由代码同步管理，不能在这里删除；要下线请改为不公开");
  }
  await db.delete(schema.activities).where(eq(schema.activities.id, row.id));
}

export async function listActivitySubmissionsAdmin(activityId: string): Promise<AdminSubmissionRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.submissions.id,
      activityId: schema.submissions.activityId,
      url: schema.submissions.url,
      submittedAt: schema.submissions.submittedAt,
      authorName: schema.submissions.authorName,
      caption: schema.submissions.caption,
      diggCount: schema.submissions.diggCount,
      commentCount: schema.submissions.commentCount,
      shareCount: schema.submissions.shareCount,
      collectCount: schema.submissions.collectCount,
      metricsError: schema.submissions.metricsError,
      reviewStatus: schema.submissions.reviewStatus,
      userEmail: schema.users.email,
      userName: schema.users.name,
    })
    .from(schema.submissions)
    .innerJoin(schema.users, eq(schema.submissions.userId, schema.users.id))
    .where(eq(schema.submissions.activityId, activityId))
    .orderBy(desc(schema.submissions.submittedAt));
  return rows.map((row) => ({
    ...row,
    submittedAt: row.submittedAt.toISOString(),
  }));
}

const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export async function setSubmissionReview(submissionId: string, status: ReviewStatus): Promise<void> {
  if (!REVIEW_STATUSES.includes(status)) {
    throw new AdminActionError(400, "审核状态只能是 pending / approved / rejected");
  }
  const db = getDb();
  const updated = await db
    .update(schema.submissions)
    .set({ reviewStatus: status, reviewedAt: sql`now()` })
    .where(eq(schema.submissions.id, submissionId))
    .returning({ id: schema.submissions.id });
  if (updated.length === 0) throw new AdminActionError(404, "作品不存在");
}

/* ---------------------------------- 用户 ---------------------------------- */

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  activityCount: number;
  joinCount: number;
  submissionCount: number;
};

export async function listUsers(): Promise<AdminUserRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
      activityCount: sql<number>`(select count(*) from ${schema.activities} where ${schema.activities.ownerId} = ${schema.users.id})`,
      joinCount: sql<number>`(select count(*) from ${schema.joins} where ${schema.joins.userId} = ${schema.users.id})`,
      submissionCount: sql<number>`(select count(*) from ${schema.submissions} where ${schema.submissions.userId} = ${schema.users.id})`,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt));
  return rows.map((row) => ({
    ...row,
    activityCount: Number(row.activityCount ?? 0),
    joinCount: Number(row.joinCount ?? 0),
    submissionCount: Number(row.submissionCount ?? 0),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function setUserRole(operatorId: string, userId: string, role: string): Promise<void> {
  if (role !== "admin" && role !== "user" && role !== "agent") {
    throw new AdminActionError(400, "角色只能是 admin、agent 或 user");
  }
  if (userId === operatorId) throw new AdminActionError(400, "不能修改自己的角色");
  const updated = await getDb()
    .update(schema.users)
    .set({ role })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  if (updated.length === 0) throw new AdminActionError(404, "用户不存在");
}

export async function deleteUser(operatorId: string, userId: string): Promise<void> {
  if (userId === operatorId) throw new AdminActionError(400, "不能删除自己的账号");
  const db = getDb();
  // 该用户发起的活动也会级联删除（外键 cascade），报名与作品随之清理。
  const deleted = await db.delete(schema.users).where(eq(schema.users.id, userId)).returning({ id: schema.users.id });
  if (deleted.length === 0) throw new AdminActionError(404, "用户不存在");
}

/* ---------------------------------- 报名 ---------------------------------- */

export type AdminJoinRow = {
  userId: string;
  email: string;
  name: string | null;
  joinedAt: string;
  inviterEmail: string | null;
};

export async function listActivityJoinsAdmin(activityId: string): Promise<AdminJoinRow[]> {
  const db = getDb();
  const inviter = alias(schema.users, "inviter");
  const rows = await db
    .select({
      userId: schema.joins.userId,
      email: schema.users.email,
      name: schema.users.name,
      joinedAt: schema.joins.joinedAt,
      inviterEmail: inviter.email,
    })
    .from(schema.joins)
    .innerJoin(schema.users, eq(schema.joins.userId, schema.users.id))
    .leftJoin(inviter, eq(schema.joins.invitedBy, inviter.id))
    .where(eq(schema.joins.activityId, activityId))
    .orderBy(desc(schema.joins.joinedAt));
  return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
}

export async function removeJoinAdmin(activityId: string, userId: string): Promise<void> {
  const deleted = await getDb()
    .delete(schema.joins)
    .where(sql`${schema.joins.activityId} = ${activityId} and ${schema.joins.userId} = ${userId}`)
    .returning({ userId: schema.joins.userId });
  if (deleted.length === 0) throw new AdminActionError(404, "报名记录不存在");
}

/* ------------------------------- 作品数据刷新 ------------------------------ */

/** 管理员重抓一条作品的抖音指标（captureMetrics 永不抛，失败返回 null 由路由给出提示）。 */
export async function refreshSubmissionAdmin(submissionId: string): Promise<AdminSubmissionRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.submissions.id,
      activityId: schema.submissions.activityId,
      userId: schema.submissions.userId,
      url: schema.submissions.url,
      submittedAt: schema.submissions.submittedAt,
      authorName: schema.submissions.authorName,
      caption: schema.submissions.caption,
      diggCount: schema.submissions.diggCount,
      commentCount: schema.submissions.commentCount,
      shareCount: schema.submissions.shareCount,
      collectCount: schema.submissions.collectCount,
      metricsError: schema.submissions.metricsError,
      reviewStatus: schema.submissions.reviewStatus,
      userEmail: schema.users.email,
      userName: schema.users.name,
    })
    .from(schema.submissions)
    .innerJoin(schema.users, eq(schema.submissions.userId, schema.users.id))
    .where(eq(schema.submissions.id, submissionId))
    .limit(1);
  if (!row) throw new AdminActionError(404, "作品不存在");
  await captureMetrics(row.activityId, row.userId, row.url);
  const rows = await listActivitySubmissionsAdmin(row.activityId);
  return rows.find((item) => item.id === submissionId) ?? null;
}

/* -------------------------------- 外部赛事 -------------------------------- */

export type AdminExternalEventRow = {
  id: string;
  source: string;
  title: string;
  url: string;
  startsAt: string | null;
  deadlineAt: string | null;
  hidden: boolean;
  createdAt: string;
};

export async function listExternalEventsAdmin(): Promise<AdminExternalEventRow[]> {
  const rows = await getDb()
    .select({
      id: schema.externalEvents.id,
      source: schema.externalEvents.source,
      title: schema.externalEvents.title,
      url: schema.externalEvents.url,
      startsAt: schema.externalEvents.startsAt,
      deadlineAt: schema.externalEvents.deadlineAt,
      hidden: schema.externalEvents.hidden,
      createdAt: schema.externalEvents.createdAt,
    })
    .from(schema.externalEvents)
    .orderBy(desc(schema.externalEvents.createdAt))
    .limit(500);
  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    deadlineAt: row.deadlineAt ? row.deadlineAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function setExternalEventHidden(id: string, hidden: boolean): Promise<void> {
  const updated = await getDb()
    .update(schema.externalEvents)
    .set({ hidden })
    .where(eq(schema.externalEvents.id, id))
    .returning({ id: schema.externalEvents.id });
  if (updated.length === 0) throw new AdminActionError(404, "赛事不存在");
}

export async function deleteExternalEventAdmin(id: string): Promise<void> {
  const deleted = await getDb()
    .delete(schema.externalEvents)
    .where(eq(schema.externalEvents.id, id))
    .returning({ id: schema.externalEvents.id });
  if (deleted.length === 0) throw new AdminActionError(404, "赛事不存在");
}
