import { RateLimitError } from "./http";

/**
 * 限流 / 登录防爆破（检查表 8.2b「7×24 预防、检测与响应」的第一道技术措施）。
 *
 * 有数据库时计数落表（多实例共享、重启不丢），没有数据库时回落到进程内计数。
 * 登录、注册类接口按 IP 限，口径是「窗口内最多 N 次」，超了抛 RateLimitError → 429。
 * nginx 那层还有 limit_req 兜底，两层是独立的：nginx 挡脚本，本模块留审计痕迹。
 */

type Bucket = { count: number; resetAt: number };

const memory = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = 0;

function cleanupMemory(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of memory) {
    if (bucket.resetAt <= now) memory.delete(key);
  }
}

export type RateLimitRule = {
  /** 每分钟最多多少次。 */
  limit: number;
  windowMs?: number;
};

export const RULES = {
  /** 第三方登录跳转：正常人一分钟点一次足够，脚本会很快打满。 */
  signin: { limit: 10, windowMs: 60_000 },
  /** 写接口（发活动、报名、提交作品）：正常人一分钟 5 次封顶。 */
  write: { limit: 5, windowMs: 60_000 },
  /** 读取接口：宽松一些，只挡明显的爬取。 */
  read: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

/**
 * 命中即抛 RateLimitError。key 建议 `${scope}:${ip}` 或 `${scope}:${userId}`。
 * 数据库不可用时静默放行 —— 限流不能成为单点故障。
 */
export async function enforceRateLimit(
  scope: string,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  const windowMs = rule.windowMs ?? 60_000;
  const now = Date.now();

  if (process.env.DATABASE_URL) {
    try {
      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();
      const nowIso = new Date(now).toISOString();
      // 窗口过期时刻 = now - windowMs。只有「已存窗口早于过期时刻」才算过期。
      // 之前写成 window_start < now() —— 那个条件恒真，每来一次请求就重置成 1，限流形同虚设。
      const cutoffIso = new Date(now - windowMs).toISOString();
      // 一条 SQL 做「插入或自增 + 过期重置」，避免读改写竞态。
      // raw sql 模板里不能绑 Date（会被序列化成不可比较的字符串），所以一律传 ISO 串。
      const rows = await db.execute(sql`
        INSERT INTO rate_limits ("key", window_start, hits) VALUES (${key}, ${nowIso}, 1)
        ON CONFLICT ("key") DO UPDATE SET
          hits = CASE WHEN rate_limits.window_start < ${cutoffIso} THEN 1 ELSE rate_limits.hits + 1 END,
          window_start = CASE WHEN rate_limits.window_start < ${cutoffIso} THEN ${nowIso} ELSE rate_limits.window_start END
        RETURNING hits
      `);
      const row = Array.from(rows as unknown as { hits: number }[])[0];
      if (Number(row?.hits ?? 0) > rule.limit) {
        throw new RateLimitError(Math.ceil(windowMs / 1000));
      }
      return;
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      // 表不存在或库不可用：回落到内存计数。
    }
  }

  cleanupMemory(now);
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > rule.limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
  }
}

/** 请求方标识：优先 x-forwarded-for 第一个地址，回落到 x-real-ip。 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}