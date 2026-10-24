import { and, asc, eq, gte, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { translateToChinese } from "./translate";
import { CURATED_EVENTS } from "../curated-events";
import { CURATED_SOURCE, isIngestSource } from "../external-events";
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
  if (row.titleZh) event.titleZh = row.titleZh;
  if (row.descriptionZh) event.descriptionZh = row.descriptionZh;
  if (row.detailText) event.detailText = row.detailText;
  if (row.detailTextZh) event.detailTextZh = row.detailTextZh;
  if (row.imageUrl) event.imageUrl = row.imageUrl;
  return event;
}

const DAY_MS = 86_400_000;
const BATCH_SIZE = 200;

/**
 * 人工精选幂等入库：把 lib/curated-events.ts 当作种子数据。
 *
 * 与抓取 upsert 的三点差异，都是刻意的：
 *   · 只写 curated 来源的行，不碰抓取内容；
 *   · 每次都覆盖文案与日期（代码是唯一事实来源），但**不覆盖 hidden** ——
 *     管理端把某条隐藏后，下次部署不该悄悄复活它；
 *   · lastSeenAt 每次刷新，配合清理任务的 source 豁免形成双保险（其实不刷也不会被删）。
 */
export async function ensureCuratedEvents(): Promise<number> {
  if (CURATED_EVENTS.length === 0) return 0;
  const db = getDb();
  let stored = 0;
  for (const event of CURATED_EVENTS) {
    await db
      .insert(schema.externalEvents)
      .values({
        source: CURATED_SOURCE,
        externalId: event.sourceId,
        title: event.title,
        titleZh: event.titleZh,
        url: event.url,
        category: event.category,
        location: event.location ?? null,
        online: event.online ?? null,
        startsAt: event.startsAt ? new Date(event.startsAt) : null,
        endsAt: event.endsAt ? new Date(event.endsAt) : null,
        deadlineAt: event.deadlineAt ? new Date(event.deadlineAt) : null,
        prize: event.prize ?? null,
        description: event.description ?? null,
        descriptionZh: event.descriptionZh ?? null,
        detailText: event.detailText ?? null,
        detailTextZh: event.detailTextZh ?? null,
        imageUrl: event.imageUrl ?? null,
        tags: event.tags,
      })
      .onConflictDoUpdate({
        target: [schema.externalEvents.source, schema.externalEvents.externalId],
        set: {
          title: sql`excluded.title`,
          titleZh: sql`excluded.title_zh`,
          url: sql`excluded.url`,
          category: sql`excluded.category`,
          location: sql`excluded.location`,
          online: sql`excluded.online`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          deadlineAt: sql`excluded.deadline_at`,
          prize: sql`excluded.prize`,
          description: sql`excluded.description`,
          descriptionZh: sql`excluded.description_zh`,
          detailText: sql`excluded.detail_text`,
          detailTextZh: sql`excluded.detail_text_zh`,
          imageUrl: sql`excluded.image_url`,
          tags: sql`excluded.tags`,
          lastSeenAt: sql`now()`,
        },
      });
    stored += 1;
  }
  // 代码里已删除的精选条目一并下线（与预置活动同一套「代码即事实」口径）；
  // 抓取来源的行不受影响。
  const keep = CURATED_EVENTS.map((event) => event.sourceId);
  await db
    .delete(schema.externalEvents)
    .where(and(eq(schema.externalEvents.source, CURATED_SOURCE), notInArray(schema.externalEvents.externalId, keep)));
  return stored;
}

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
      imageUrl: event.imageUrl ?? null,
      titleZh: null,
      descriptionZh: null,
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
          // 抓取脚本不带翻译：保留库里已有的机翻，缺的由 translateMissingTranslations 异步补
          titleZh: sql`coalesce(excluded.title_zh, external_events.title_zh)`,
          descriptionZh: sql`coalesce(excluded.description_zh, external_events.description_zh)`,
          imageUrl: sql`coalesce(excluded.image_url, external_events.image_url)`,
          tags: sql`excluded.tags`,
          lastSeenAt: sql`now()`,
        },
      });
  }
  return { received: rawEvents.length, stored: events.length };
}

/**
 * 展示口径：
 *   · 抓取来源与抓取窗口一致 —— 开始日期在 [now-7d, now+90d]，或已在进行、
 *     结束/截止日期在 [now, now+90d]（Deadline 驱动的目录站与长期进行中的赛事）；
 *   · 人工精选（curated）不受窗口限制，只要还没结束就展示 —— 它们的周期本来
 *     就可能长达半年（迪拜那场从 2026-10 跑到 2027-05），套 90 天窗口等于永远看不到。
 */
export async function listExternalEvents(): Promise<ExternalEvent[]> {
  const db = getDb();
  await ensureCuratedEventsOnce();
  const now = new Date();
  const past = new Date(now.getTime() - WINDOW_PAST_DAYS * DAY_MS);
  const future = new Date(now.getTime() + WINDOW_FUTURE_DAYS * DAY_MS);
  const endsSoon = (column: AnyPgColumn) => and(gte(column, now), lte(column, future));
  const rows = await db
    .select()
    .from(schema.externalEvents)
    .where(
      and(
        eq(schema.externalEvents.hidden, false),
        or(
          and(gte(schema.externalEvents.startsAt, past), lte(schema.externalEvents.startsAt, future)),
          endsSoon(schema.externalEvents.endsAt),
          endsSoon(schema.externalEvents.deadlineAt),
          // 人工精选：开始时间可以很久以前、结束时间可以很久以后，只看「是否已结束」。
          // 与 lib/curated-events.ts 的 curatedVisibleAt 同口径：结束/截止哪个晚按哪个，
          // 两者都没有就长期有效。
          and(
            eq(schema.externalEvents.source, CURATED_SOURCE),
            or(
              and(isNull(schema.externalEvents.endsAt), isNull(schema.externalEvents.deadlineAt)),
              gte(schema.externalEvents.endsAt, now),
              gte(schema.externalEvents.deadlineAt, now),
            ),
          ),
        ),
      ),
    )
    .orderBy(sql`${schema.externalEvents.startsAt} asc nulls last`, asc(schema.externalEvents.endsAt))
    .limit(500);
  return rows.map(toEvent);
}

/**
 * 进程级「精选已入库」标记：public GET /api/events 每次访问都会走到这里，
 * 不该每次都写库。首次成功后置位；失败时不置位，下一次请求自动重试。
 * （多实例部署时每个进程各跑一次，upsert 是幂等的，没有副作用。）
 */
let curatedSeeded = false;
async function ensureCuratedEventsOnce(): Promise<void> {
  if (curatedSeeded) return;
  try {
    await ensureCuratedEvents();
    curatedSeeded = true;
  } catch (error) {
    console.error("[events] 人工精选入库失败，下次请求重试", error);
  }
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
      // curated 由代码管理，不进清理 —— 它不参与每日抓取，last_seen_at 不会被刷新
      and(
        ne(schema.externalEvents.source, CURATED_SOURCE),
        or(
          sql`coalesce(${schema.externalEvents.endsAt}, ${schema.externalEvents.deadlineAt}, ${schema.externalEvents.startsAt}) < ${cutoff}`,
          lt(schema.externalEvents.lastSeenAt, staleSeen),
        ),
      ),
    )
    .returning({ id: schema.externalEvents.id });
  return gone.length;
}

/**
 * 详情页用：按主键取单条全球赛事（窗口过滤不适用——详情页照常展示）。
 *
 * 这里也要走一次精选入库：精选详情页是可直接分享的链接，用户可能**没先打开
 * 活动列表**就点进来。若只在列表接口里入库，冷启动后的第一个请求会 404。
 */
export async function getExternalEventById(id: string): Promise<ExternalEvent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await ensureCuratedEventsOnce();
  const db = getDb();
  const [row] = await db.select().from(schema.externalEvents).where(eq(schema.externalEvents.id, id)).limit(1);
  return row ? toEvent(row) : null;
}

/**
 * 给还没有中文标题的赛事补机翻（MyMemory 免费接口）。由 ingest 路由在入库后
 * 异步触发（不阻塞抓取脚本的响应）；失败留给明天的入库重试，可自愈。
 */
export async function translateMissingTranslations(limit = 16): Promise<number> {
  const db = getDb();
  let budget = limit;
  let translated = 0;

  // 标题优先（短、显眼）
  const untitled = await db
    .select()
    .from(schema.externalEvents)
    .where(isNull(schema.externalEvents.titleZh))
    .limit(budget);
  for (const row of untitled) {
    if (budget <= 0) break;
    const titleZh = await translateToChinese(row.title);
    budget -= 1;
    if (!titleZh && !row.description) continue;
    const descriptionZh = row.description && !row.detailText ? await translateToChinese(row.description) : null;
    await db.update(schema.externalEvents).set({ titleZh, descriptionZh }).where(eq(schema.externalEvents.id, row.id));
    if (titleZh) translated += 1;
  }

  // 详情正文：一次请求译不完长文，只译前 380 字符作中文摘要，原文在详情页折叠展示
  if (budget > 0) {
    const unexplained = await db
      .select()
      .from(schema.externalEvents)
      .where(and(isNotNull(schema.externalEvents.detailText), isNull(schema.externalEvents.detailTextZh)))
      .limit(budget);
    for (const row of unexplained) {
      if (budget <= 0) break;
      const summaryZh = await translateToChinese((row.detailText ?? "").slice(0, 380));
      budget -= 1;
      await db
        .update(schema.externalEvents)
        .set({ detailTextZh: summaryZh ?? "" })
        .where(eq(schema.externalEvents.id, row.id));
      if (summaryZh) translated += 1;
    }
  }
  return translated;
}

/** 还没做过详情 enrichment 的赛事（ingest 响应里带给抓取脚本）。 */
export async function detailNeededRows(limit = 30) {
  const db = getDb();
  const rows = await db
    .select({ source: schema.externalEvents.source, sourceId: schema.externalEvents.externalId, url: schema.externalEvents.url })
    .from(schema.externalEvents)
    .where(isNull(schema.externalEvents.detailText))
    .limit(limit);
  return rows;
}

/** 详情 enrichment 入库：按 (source, external_id) 更新海报与正文，并让中文摘要重翻。 */
export async function updateEventDetails(
  details: { source: string; sourceId: string; imageUrl?: string; detailText?: string }[],
): Promise<number> {
  const db = getDb();
  let updated = 0;
  for (const item of details) {
    // 只允许抓取来源：curated 的文案与海报由代码管理，不能被 enrichment 覆盖
    if (!isIngestSource(item.source)) continue;
    const patch: Record<string, unknown> = {};
    if (item.imageUrl) patch.imageUrl = item.imageUrl;
    if (item.detailText) {
      patch.detailText = item.detailText;
      patch.detailTextZh = null;
    }
    if (Object.keys(patch).length === 0) continue;
    const gone = await db
      .update(schema.externalEvents)
      .set(patch)
      .where(and(eq(schema.externalEvents.source, item.source), eq(schema.externalEvents.externalId, item.sourceId)))
      .returning({ id: schema.externalEvents.id });
    updated += gone.length;
  }
  return updated;
}
