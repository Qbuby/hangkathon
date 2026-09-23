import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

/** 报名：一个用户对一场活动最多一行（唯一索引兜底），重复报名是幂等的。 */

export type ServerJoin = {
  activityId: string;
  joinedAt: string;
  invitedBy: string | null;
};

export async function getJoin(activityId: string, userId: string): Promise<ServerJoin | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.joins)
    .where(and(eq(schema.joins.activityId, activityId), eq(schema.joins.userId, userId)))
    .limit(1);
  return row ? { activityId: row.activityId, joinedAt: row.joinedAt.toISOString(), invitedBy: row.invitedBy } : null;
}

export async function listJoinsForUser(userId: string): Promise<ServerJoin[]> {
  const db = getDb();
  const rows = await db.select().from(schema.joins).where(eq(schema.joins.userId, userId));
  return rows.map((row) => ({
    activityId: row.activityId,
    joinedAt: row.joinedAt.toISOString(),
    invitedBy: row.invitedBy,
  }));
}

/** 幂等报名；已存在时保持原记录（不刷新 joinedAt）。 */
export async function createJoin(activityId: string, userId: string, invitedBy?: string | null): Promise<ServerJoin> {
  const db = getDb();
  const [row] = await db
    .insert(schema.joins)
    .values({ activityId, userId, invitedBy: invitedBy ?? null })
    .onConflictDoUpdate({
      target: [schema.joins.activityId, schema.joins.userId],
      set: { invitedBy: invitedBy ?? null },
    })
    .returning();
  return { activityId: row.activityId, joinedAt: row.joinedAt.toISOString(), invitedBy: row.invitedBy };
}

/** 活动下的报名人数（活动详情页展示用）。 */
export async function countJoins(activityId: string): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: schema.joins.id }).from(schema.joins).where(eq(schema.joins.activityId, activityId));
  return rows.length;
}
