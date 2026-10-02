import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 服务端存储：自托管那份用 Postgres；Vercel 那份没有 DATABASE_URL，继续走 localStorage。
 * 归属一律用 user id —— 活动属于发起人，报名/作品/邀请事件属于具体用户。
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  image: text("image"),
  /** user | admin；管理员由 ADMIN_EMAILS 引导提权，后续可在管理端口调整。 */
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  overview: text("overview").notNull().default(""),
  host: text("host").notNull().default(""),
  contact: text("contact").notNull().default(""),
  district: text("district").notNull().default(""),
  format: text("format").notNull().default("online"),
  venue: text("venue").notNull().default(""),
  pricing: text("pricing").notNull().default("free"),
  fee: text("fee").notNull().default(""),
  category: text("category").notNull().default("creation"),
  prizePool: integer("prize_pool").notNull().default(0),
  startsAt: text("starts_at").notNull().default(""),
  endsAt: text("ends_at").notNull().default(""),
  submissionTypes: jsonb("submission_types").$type<string[]>().notNull().default([]),
  judging: text("judging").notNull().default("judges"),
  criteria: jsonb("criteria").$type<{ name: string; weight: number }[]>().notNull().default([]),
  awardsEnabled: boolean("awards_enabled").notNull().default(false),
  awards: jsonb("awards").$type<{ name: string; slots: number; reward: string }[]>().notNull().default([]),
  visibility: text("visibility").notNull().default("public"),
  joinPolicy: text("join_policy").notNull().default("anyone"),
  emailDomain: text("email_domain").notNull().default(""),
  /** 海报图（竖版），仅平台预置活动配置。 */
  image: text("image"),
  /** 平台预置活动（lib/published-activities.ts）为 true，用户创建的为 false。 */
  seeded: boolean("seeded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("activities_slug_unique").on(table.slug)]);

export const joins = pgTable("joins", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("joins_activity_user_unique").on(table.activityId, table.userId),
  index("joins_user_idx").on(table.userId),
]);

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * 作品数据由 scripts/douyin/fetch.py 抓取，全部可空：
   * 抓取失败（或这个部署没装 python）只写 metricsError，提交本身照样成立。
   */
  awemeId: text("aweme_id"),
  caption: text("caption"),
  authorName: text("author_name"),
  diggCount: integer("digg_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  collectCount: integer("collect_count"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  metricsError: text("metrics_error"),
  /** 管理员审核状态：pending | approved | rejected；贡献值入账由后续流程消费。 */
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [index("submissions_activity_user_idx").on(table.activityId, table.userId)]);

export const inviteEvents = pgTable("invite_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
  factionId: text("faction_id").notNull(),
  teamId: text("team_id"),
  inviterId: uuid("inviter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteeId: uuid("invitee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("invite_events_activity_idx").on(table.activityId)]);

/**
 * 全球赛事：scripts/events/fetch.py 每日在宿主机抓取，经 /api/events/ingest（令牌）upsert 进来。
 * (source, external_id) 唯一；starts_at 可空（Deadline 驱动的目录站只有截止日期）。
 */
export const externalEvents = pgTable("external_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  category: text("category").notNull().default("competition"),
  location: text("location"),
  online: boolean("online"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  prize: text("prize"),
  description: text("description"),
  /** 机翻中文（MyMemory），入库时异步补齐；没有就回落到原文。 */
  titleZh: text("title_zh"),
  descriptionZh: text("description_zh"),
  /** 详情 enrichment：来源详情页的正文与海报图，由每日抓取脚本补齐。 */
  detailText: text("detail_text"),
  detailTextZh: text("detail_text_zh"),
  imageUrl: text("image_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  /** 最后一轮抓取（含失败轮之外的成功 upsert）见到它的时间，清理以两周没再见为准。 */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("external_events_source_external_unique").on(table.source, table.externalId),
  index("external_events_starts_idx").on(table.startsAt),
]);

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  owner: one(users, { fields: [activities.ownerId], references: [users.id] }),
  joins: many(joins),
  submissions: many(submissions),
}));

export const joinsRelations = relations(joins, ({ one }) => ({
  activity: one(activities, { fields: [joins.activityId], references: [activities.id] }),
  user: one(users, { fields: [joins.userId], references: [users.id] }),
}));
