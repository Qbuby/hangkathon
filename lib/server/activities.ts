import { and, eq, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import { ensureAdminSeed } from "./users";
import type { Activity, ActivityReviewStatus, Award, Category, Criterion, JoinPolicy, Judging, Visibility } from "@/lib/activity";

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
    // 库里 NOT NULL DEFAULT 'published'，恒有值；防御式归一到两态，避免脏值外泄。
    reviewStatus: (row.reviewStatus === "pending" ? "pending" : "published") as ActivityReviewStatus,
    joinPolicy: row.joinPolicy as JoinPolicy,
    emailDomain: row.emailDomain,
    image: row.image ?? undefined,
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

  await ensureAdminSeed();

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
        image: activity.image ?? null,
        seeded: true,
      })
      // 预置活动是平台内容：部署时以代码为准覆盖同名 slug 的行，文案修正会随
      // 部署自动生效（owner 保持不变）；用户自己建的活动 slug 不同，永远不会被碰。
      // visibility 不在覆盖之列：它是管理端口里的运行时状态（下线活动），
      // 若随种子回写，管理员的「不公开」会在下一次列表读取时被冲掉。
      .onConflictDoUpdate({
        target: schema.activities.slug,
        set: {
          title: sql`excluded.title`,
          subtitle: sql`excluded.subtitle`,
          overview: sql`excluded.overview`,
          host: sql`excluded.host`,
          contact: sql`excluded.contact`,
          district: sql`excluded.district`,
          format: sql`excluded.format`,
          venue: sql`excluded.venue`,
          pricing: sql`excluded.pricing`,
          fee: sql`excluded.fee`,
          category: sql`excluded.category`,
          prizePool: sql`excluded.prize_pool`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          submissionTypes: sql`excluded.submission_types`,
          judging: sql`excluded.judging`,
          criteria: sql`excluded.criteria`,
          awardsEnabled: sql`excluded.awards_enabled`,
          awards: sql`excluded.awards`,
          joinPolicy: sql`excluded.join_policy`,
          emailDomain: sql`excluded.email_domain`,
          image: sql`excluded.image`,
          seeded: sql`excluded.seeded`,
        },
      });
  }

  // 种子同步下线：代码里已移除的预置活动（如被替换掉的旧活动）把行一并删掉，
  // 报名/作品因外键级联随之清理；用户自建活动 seeded=false，永远不受影响。
  if (PUBLISHED_ACTIVITIES.length > 0) {
    await db.delete(schema.activities).where(
      and(
        eq(schema.activities.seeded, true),
        notInArray(
          schema.activities.slug,
          PUBLISHED_ACTIVITIES.map((activity) => activity.slug),
        ),
      ),
    );
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
  // 公开列表 = 已发布且公开；pending 只对发起人可见（管理端走 listAllActivities）。
  return rows
    .map(({ activity, ownerName }) => rowToActivity(activity, viewerId, ownerName))
    .filter((activity) => (activity.visibility === "public" && activity.reviewStatus !== "pending") || activity.mine);
}

/** 按 slug 查活动行（不做任何可见性过滤），列表与详情共用。 */
async function findActivityRow(slug: string) {
  const db = getDb();
  await ensureSeed();
  const [row] = await db
    .select({ activity: schema.activities, ownerName: schema.users.name })
    .from(schema.activities)
    .leftJoin(schema.users, eq(schema.users.id, schema.activities.ownerId))
    .where(eq(schema.activities.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function getActivityBySlug(slug: string, viewerId: string | null): Promise<ActivityWithOwner | null> {
  const row = await findActivityRow(slug);
  if (!row) return null;
  const activity = rowToActivity(row.activity, viewerId, row.ownerName);
  // 对非发起人完全不可见：不公开或待审核都按 404 处理；join/作品等子路由共用本入口，一并被拦。
  if ((activity.visibility !== "public" || activity.reviewStatus === "pending") && !activity.mine) return null;
  return activity;
}

/**
 * 管理端取活动：requireAdmin 之后的路由用，跳过公开可见性门——
 * pending/unlisted 活动在 /manage 的作品、报名面板里必须可读，否则审核只能盲审。
 */
export async function getActivityBySlugAdmin(slug: string): Promise<ActivityWithOwner | null> {
  const row = await findActivityRow(slug);
  return row ? rowToActivity(row.activity, null, row.ownerName) : null;
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
      // 用户发起一律先入审核；不从 payload 读取，客户端无法影响。
      reviewStatus: "pending",
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
