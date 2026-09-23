import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import type { Activity, Award, Category, Criterion, JoinPolicy, Judging, Visibility } from "@/lib/activity";

/**
 * 活动：库里的行 ↔ 前端用的 Activity 形状。
 * 预置活动（lib/published-activities.ts）在首次读取时幂等入库，归属一个系统账号。
 */

const SEED_EMAIL = "seed@hangkathon.local";

type Row = typeof schema.activities.$inferSelect;

export type ActivityWithOwner = Activity & {
  /** 当前登录用户是不是发起人（前端用来决定要不要显示「我发起的」）。 */
  mine: boolean;
  /** 平台预置活动。 */
  seeded: boolean;
  ownerName: string | null;
};

export function rowToActivity(row: Row, viewerId: string | null, ownerName: string | null = null): ActivityWithOwner {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    overview: row.overview,
    host: row.host,
    contact: row.contact,
    district: row.district,
    format: row.format === "online" ? "online" : "offline",
    venue: row.venue,
    pricing: row.pricing === "paid" ? "paid" : "free",
    fee: row.fee,
    category: row.category as Category,
    prizePool: row.prizePool,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    submissionTypes: row.submissionTypes,
    judging: row.judging as Judging,
    criteria: row.criteria as Criterion[],
    awardsEnabled: row.awardsEnabled,
    awards: row.awards as Award[],
    visibility: row.visibility as Visibility,
    joinPolicy: row.joinPolicy as JoinPolicy,
    emailDomain: row.emailDomain,
    createdAt: row.createdAt.toISOString(),
    mine: Boolean(viewerId && row.ownerId === viewerId),
    seeded: row.seeded,
    ownerName,
  };
}

/** 预置活动幂等入库：把 lib/published-activities.ts 的内容当作种子数据。 */
export async function ensureSeed() {
  const db = getDb();
  const [owner] = await db
    .insert(schema.users)
    .values({ email: SEED_EMAIL, name: "杭客松" })
    .onConflictDoUpdate({ target: schema.users.email, set: { name: "杭客松" } })
    .returning({ id: schema.users.id });

  for (const activity of PUBLISHED_ACTIVITIES) {
    await db
      .insert(schema.activities)
      .values({
        slug: activity.slug,
        ownerId: owner.id,
        title: activity.title,
        subtitle: activity.subtitle,
        overview: activity.overview,
        host: activity.host,
        contact: activity.contact,
        district: activity.district,
        format: activity.format,
        venue: activity.venue,
        pricing: activity.pricing,
        fee: activity.fee,
        category: activity.category,
        prizePool: activity.prizePool,
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        submissionTypes: activity.submissionTypes,
        judging: activity.judging,
        criteria: activity.criteria,
        awardsEnabled: activity.awardsEnabled,
        awards: activity.awards,
        visibility: activity.visibility,
        joinPolicy: activity.joinPolicy,
        emailDomain: activity.emailDomain,
        seeded: true,
      })
      .onConflictDoNothing({ target: schema.activities.slug });
  }
}

export async function listActivities(viewerId: string | null): Promise<ActivityWithOwner[]> {
  const db = getDb();
  await ensureSeed();
  const rows = await db
    .select({ activity: schema.activities, ownerName: schema.users.name })
    .from(schema.activities)
    .leftJoin(schema.users, eq(schema.users.id, schema.activities.ownerId))
    .orderBy(schema.activities.createdAt);
  return rows
    .map(({ activity, ownerName }) => rowToActivity(activity, viewerId, ownerName))
    .filter((activity) => activity.visibility === "public" || activity.mine);
}

export async function getActivityBySlug(slug: string, viewerId: string | null): Promise<ActivityWithOwner | null> {
  const db = getDb();
  await ensureSeed();
  const [row] = await db
    .select({ activity: schema.activities, ownerName: schema.users.name })
    .from(schema.activities)
    .leftJoin(schema.users, eq(schema.users.id, schema.activities.ownerId))
    .where(eq(schema.activities.slug, slug))
    .limit(1);
  if (!row) return null;
  const activity = rowToActivity(row.activity, viewerId, row.ownerName);
  if (activity.visibility !== "public" && !activity.mine) return null;
  return activity;
}

export async function createActivity(ownerId: string, activity: Activity): Promise<ActivityWithOwner> {
  const db = getDb();
  const [row] = await db
    .insert(schema.activities)
    .values({
      slug: activity.slug,
      ownerId,
      title: activity.title,
      subtitle: activity.subtitle,
      overview: activity.overview,
      host: activity.host,
      contact: activity.contact,
      district: activity.district,
      format: activity.format,
      venue: activity.venue,
      pricing: activity.pricing,
      fee: activity.fee,
      category: activity.category,
      prizePool: activity.prizePool,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      submissionTypes: activity.submissionTypes,
      judging: activity.judging,
      criteria: activity.criteria,
      awardsEnabled: activity.awardsEnabled,
      awards: activity.awards,
      visibility: activity.visibility,
      joinPolicy: activity.joinPolicy,
      emailDomain: activity.emailDomain,
      seeded: false,
    })
    .returning();
  return rowToActivity(row, ownerId);
}

/** 活动代号重复时给一个带后缀的可用代号。 */
export async function uniqueSlug(base: string): Promise<string> {
  const db = getDb();
  const existing = await db.select({ slug: schema.activities.slug }).from(schema.activities);
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
