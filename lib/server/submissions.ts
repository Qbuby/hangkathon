import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MetricsResult } from "./douyin";

/** 作品提交：沿用「只有本人看得到自己的提交」的隐私语义，不做公开作品墙。 */

export type ServerSubmission = {
  url: string;
  submittedAt: string;
  awemeId?: string;
  caption?: string;
  authorName?: string;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  collectCount?: number;
  fetchedAt?: string;
  metricsError?: string;
};

type Row = typeof schema.submissions.$inferSelect;

/** 指标列全部可空，缺席就整个字段不出现，页面按缺席渲染。 */
function toRecord(row: Row): ServerSubmission {
  const record: ServerSubmission = { url: row.url, submittedAt: row.submittedAt.toISOString() };
  if (row.awemeId) record.awemeId = row.awemeId;
  if (row.caption) record.caption = row.caption;
  if (row.authorName) record.authorName = row.authorName;
  // 0 是合法值（一条没人点赞的作品），所以判 null 而不是判真假。
  if (row.diggCount !== null) record.diggCount = row.diggCount;
  if (row.commentCount !== null) record.commentCount = row.commentCount;
  if (row.shareCount !== null) record.shareCount = row.shareCount;
  if (row.collectCount !== null) record.collectCount = row.collectCount;
  if (row.fetchedAt) record.fetchedAt = row.fetchedAt.toISOString();
  if (row.metricsError) record.metricsError = row.metricsError;
  return record;
}

export async function listSubmissions(activityId: string, userId: string): Promise<ServerSubmission[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.activityId, activityId), eq(schema.submissions.userId, userId)))
    .orderBy(desc(schema.submissions.submittedAt));
  return rows.map(toRecord);
}

export async function addSubmission(activityId: string, userId: string, url: string): Promise<ServerSubmission> {
  const db = getDb();
  const [row] = await db.insert(schema.submissions).values({ activityId, userId, url }).returning();
  return toRecord(row);
}

/**
 * 把一次抓取的结果写回这个 (活动, 用户, 链接) 的所有记录。
 *
 * 按 url 而不是按 id 定位：客户端拿到的一直是 { url, submittedAt }，没有 id，
 * 而 localStorage 那份也不会有 id —— 为了刷新功能把 id 捅到接口上，会平白让
 * 两种存储的记录形状分叉。同一链接重复提交时这几行本来也是同一条作品。
 *
 * 抓取失败时**只写 metricsError，不抹掉已有的数字**：一次网络抖动不该让用户
 * 丢掉上次抓到的数据，fetchedAt 不变本身就能说明数字是旧的。
 */
export async function setMetricsForUrl(
  activityId: string,
  userId: string,
  url: string,
  result: MetricsResult,
): Promise<ServerSubmission[]> {
  const db = getDb();
  await db
    .update(schema.submissions)
    .set(
      "metrics" in result
        ? {
            awemeId: result.metrics.awemeId ?? null,
            caption: result.metrics.caption ?? null,
            authorName: result.metrics.authorName ?? null,
            diggCount: result.metrics.diggCount ?? null,
            commentCount: result.metrics.commentCount ?? null,
            shareCount: result.metrics.shareCount ?? null,
            collectCount: result.metrics.collectCount ?? null,
            fetchedAt: new Date(result.metrics.fetchedAt),
            metricsError: null,
          }
        : { metricsError: result.error },
    )
    .where(
      and(
        eq(schema.submissions.activityId, activityId),
        eq(schema.submissions.userId, userId),
        eq(schema.submissions.url, url),
      ),
    );
  return listSubmissions(activityId, userId);
}

/** 某用户在所有活动里的提交条数（个人主页用）。 */
export async function countSubmissionsForUser(userId: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: schema.submissions.id }).from(schema.submissions).where(eq(schema.submissions.userId, userId));
  return rows.length;
}
