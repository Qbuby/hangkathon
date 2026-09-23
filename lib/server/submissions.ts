import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** 作品提交：沿用「只有本人看得到自己的提交」的隐私语义，不做公开作品墙。 */

export type ServerSubmission = {
  url: string;
  submittedAt: string;
};

export async function listSubmissions(activityId: string, userId: string): Promise<ServerSubmission[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.submissions)
    .where(and(eq(schema.submissions.activityId, activityId), eq(schema.submissions.userId, userId)))
    .orderBy(desc(schema.submissions.submittedAt));
  return rows.map((row) => ({ url: row.url, submittedAt: row.submittedAt.toISOString() }));
}

export async function addSubmission(activityId: string, userId: string, url: string): Promise<ServerSubmission> {
  const db = getDb();
  const [row] = await db.insert(schema.submissions).values({ activityId, userId, url }).returning();
  return { url: row.url, submittedAt: row.submittedAt.toISOString() };
}

/** 某用户在所有活动里的提交条数（个人主页用）。 */
export async function countSubmissionsForUser(userId: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: schema.submissions.id }).from(schema.submissions).where(eq(schema.submissions.userId, userId));
  return rows.length;
}
