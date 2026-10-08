import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

/**
 * 用户黑名单（安全检查表 9.2.2c / 9.3.4）。
 *
 * 名单内的账号：不能发起活动、不能报名、不能提交作品，也不能登录管理端口。
 * 生效时间与来源都留痕（平台自查 / 公安通报），解除要留操作人 —— 检查时按「黑名单生效时间」
 * 一栏逐条核对。查询走一个 5 秒的进程内缓存，避免每个写请求都打一次库。
 */

export class BlacklistedError extends Error {
  constructor(readonly reason: string) {
    super("账号已被列入黑名单");
    this.name = "BlacklistedError";
  }
}

type Entry = { id: string; email: string; reason: string; effectiveUntil: Date | null };

let cache: { until: number; map: Map<string, Entry> } = { until: 0, map: new Map() };
const CACHE_MS = 5000;

async function activeEntries(): Promise<Map<string, Entry>> {
  if (Date.now() < cache.until) return cache.map;
  const db = getDb();
  const rows = await db
    .select({
      id: schema.userBlacklist.id,
      email: schema.userBlacklist.email,
      reason: schema.userBlacklist.reason,
      effectiveUntil: schema.userBlacklist.effectiveUntil,
    })
    .from(schema.userBlacklist)
    .where(
      and(
        isNull(schema.userBlacklist.revokedAt),
        or(
          sql`${schema.userBlacklist.effectiveUntil} IS NULL`,
          lte(schema.userBlacklist.effectiveUntil, sql`now()`),
        ) as never,
      ),
    );
  const map = new Map(rows.map((row) => [row.email.toLowerCase(), row]));
  cache = { until: Date.now() + CACHE_MS, map };
  return map;
}

export async function blacklistEntry(email: string | null | undefined): Promise<Entry | null> {
  if (!email) return null;
  return (await activeEntries()).get(email.trim().toLowerCase()) ?? null;
}

export async function isBlacklisted(email: string | null | undefined): Promise<boolean> {
  return (await blacklistEntry(email)) !== null;
}

/** 写操作前调用：命中名单直接抛错，路由层映射成 403。 */
export async function requireNotBlacklisted(email: string | null | undefined): Promise<void> {
  const entry = await blacklistEntry(email);
  if (entry) throw new BlacklistedError(entry.reason);
}

export async function addToBlacklist(input: {
  email: string;
  reason: string;
  source?: "platform" | "police";
  hits?: number;
  effectiveUntil?: Date | null;
  createdBy?: string | null;
}): Promise<void> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  await db
    .insert(schema.userBlacklist)
    .values({
      email,
      reason: input.reason,
      source: input.source ?? "platform",
      hits: input.hits ?? 1,
      effectiveUntil: input.effectiveUntil ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: schema.userBlacklist.email,
      set: {
        reason: input.reason,
        source: input.source ?? "platform",
        hits: input.hits ?? 1,
        effectiveUntil: input.effectiveUntil ?? null,
        revokedAt: null,
        revokedBy: null,
      },
    });
  cache = { until: 0, map: new Map() };
}

export async function revokeBlacklist(id: string, by: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(schema.userBlacklist)
    .set({ revokedAt: new Date(), revokedBy: by })
    .where(eq(schema.userBlacklist.id, id))
    .returning({ id: schema.userBlacklist.id });
  cache = { until: 0, map: new Map() };
  return rows.length > 0;
}

export type BlacklistRow = {
  id: string;
  email: string;
  reason: string;
  source: string;
  hits: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export async function listBlacklist(): Promise<BlacklistRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.userBlacklist)
    .orderBy(desc(schema.userBlacklist.createdAt));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    reason: row.reason,
    source: row.source,
    hits: row.hits,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}