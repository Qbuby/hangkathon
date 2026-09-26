import { and, asc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import {
  WINDOW_FUTURE_DAYS,
  WINDOW_PAST_DAYS,
  type EventSourceId,
  type ExternalEvent,
  normalizeEventInput,
} from "../external-events";

/** 全球赛事（external_events）：由宿主机每日抓取脚本经 /api/events/ingest 写入，页面只读。 */

type Row = typeof schema.externalEvents.$inferSelect;

function toEvent(row: Row): ExternalEvent {
  const event: ExternalEvent = {
    id: row.id,
    source: row.source as EventSourceId,
    sourceId: row.externalId,
    title: row.title,
    url: row.url,
    category: row.category as ExternalEvent["category"],
    tags: row.tags ?? [],
  };
  if (row.startsAt) event.startsAt = row.startsAt.toISOString();
  if (row.endsAt) event.endsAt = row.endsAt.toISOString();
  if (row.deadlineAt) event.deadlineAt = row.deadlineAt.toISOString();
  if (row.location) event.location = row.location;
  if (row.online !== null) event.online = row.online;
  if (row.prize) event.prize = row.prize;
  if (row.description) event.description = row.description;
  return event;
}

const DAY_MS = 86_400_000;
const BATCH_SIZE = 200;

/**
 * 一轮抓取的入库：逐条校验、按 (source, external_id) upsert、更新 last_seen_at。
 * last_seen 让清理有依据 —— 某个源连续两周不再产出某条，就说明它下线了。
 */
export async function upsertExternalEvents(rawEvents: unknown[]): Promise<{ received: number; stored: number }> {
  const events = rawEvents
    .map((item) => normalizeEventInput(item))
    .filter((item): item is ExternalEvent => item !== null);
  if (events.length === 0) return { received: rawEvents.length, stored: 0 };

  const db = getDb();
  for (let start = 0; start < events.length; start += BATCH_SIZE) {
    const batch = events.slice(start, start + BATCH_SIZE).map((event) => ({
      source: event.source,
      externalId: event.sourceId,
      title: event.title,
      url: event.url,
      category: event.category,
      location: event.location ?? null,
      online: event.online ?? null,
      startsAt: event.startsAt ? new Date(event.startsAt) : null,
      endsAt: event.endsAt ? new Date(event.endsAt) : null,
      deadlineAt: event.deadlineAt ? new Date(event.deadlineAt) : null,
      prize: event.prize ?? null,
      description: event.description ?? null,
      tags: event.tags,
    }));
    await db
      .insert(schema.externalEvents)
      .values(batch)
      .onConflictDoUpdate({
        target: [schema.externalEvents.source, schema.externalEvents.externalId],
        set: {
          title: sql`excluded.title`,
          url: sql`excluded.url`,
          category: sql`excluded.category`,
          location: sql`excluded.location`,
          online: sql`excluded.online`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          deadlineAt: sql`excluded.deadline_at`,
          prize: sql`excluded.prize`,
          description: sql`excluded.description`,
          tags: sql`excluded.tags`,
          lastSeenAt: sql`now()`,
        },
      });
  }
  return { received: rawEvents.length, stored: events.length };
}

/**
 * 展示口径与抓取窗口一致：开始日期在 [now-7d, now+90d]；或已在进行、
 * 结束/截止日期在 [now, now+90d]（Deadline 驱动的目录站与长期进行中的赛事）。
 */
export async function listExternalEvents(): Promise<ExternalEvent[]> {
  const db = getDb();
  const now = new Date();
  const past = new Date(now.getTime() - WINDOW_PAST_DAYS * DAY_MS);
  const future = new Date(now.getTime() + WINDOW_FUTURE_DAYS * DAY_MS);
  const endsSoon = (column: AnyPgColumn) => and(gte(column, now), lte(column, future));
  const rows = await db
    .select()
    .from(schema.externalEvents)
    .where(
      or(
        and(gte(schema.externalEvents.startsAt, past), lte(schema.externalEvents.startsAt, future)),
        endsSoon(schema.externalEvents.endsAt),
        endsSoon(schema.externalEvents.deadlineAt),
      ),
    )
    .orderBy(sql`${schema.externalEvents.startsAt} asc nulls last`, asc(schema.externalEvents.endsAt))
    .limit(500);
  return rows.map(toEvent);
}

/** 过期清理：整场活动（结束/截止/开始取最晚的）过去两周、或两周没被任何一轮抓取再见到，删掉。 */
export async function cleanupExternalEvents(): Promise<number> {
  const db = getDb();
  // raw sql 模板里的参数要走 ISO 字符串：Date 直接绑定会被驱动序列化成不可比较的格式
  const cutoff = new Date(Date.now() - 14 * DAY_MS).toISOString();
  const staleSeen = new Date(Date.now() - 14 * DAY_MS);
  const gone = await db
    .delete(schema.externalEvents)
    .where(
      or(
        sql`coalesce(${schema.externalEvents.endsAt}, ${schema.externalEvents.deadlineAt}, ${schema.externalEvents.startsAt}) < ${cutoff}`,
        lt(schema.externalEvents.lastSeenAt, staleSeen),
      ),
    )
    .returning({ id: schema.externalEvents.id });
  return gone.length;
}

/** 详情页用：按主键取单条全球赛事（窗口过滤不适用——详情页照常展示）。 */
export async function getExternalEventById(id: string): Promise<ExternalEvent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = getDb();
  const [row] = await db.select().from(schema.externalEvents).where(eq(schema.externalEvents.id, id)).limit(1);
  return row ? toEvent(row) : null;
}
