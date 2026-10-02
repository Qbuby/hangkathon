import { count, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Visibility } from "@/lib/activity";

/**
 * 管理端口的服务端能力：全量活动、全量作品、总览计数与审核/下线操作。
 * 只有 requireAdmin() 通过后的路由才会走到这里；错误统一由 handleRouteError 出口。
 */

export type AdminOverview = {
  users: number;
  activities: number;
  joins: number;
  submissions: number;
  pendingReviews: number;
};

export type AdminActivityRow = {
  id: string;
  slug: string;
  title: string;
  district: string;
  visibility: Visibility;
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
  return {
    users: Number(usersRow?.value ?? 0),
    activities: Number(activitiesRow?.value ?? 0),
    joins: Number(joinsRow?.value ?? 0),
    submissions: Number(submissionsRow?.value ?? 0),
    pendingReviews: Number(pendingRow?.value ?? 0),
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
