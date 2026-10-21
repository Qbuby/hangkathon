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
  /**
   * 实名信息与最近登录痕迹（检查表 8.4.2a / 9.2.2）：
   * 微信登录拿不到身份证件，默认走「已实名第三方账号」这一档，故 status 默认 unverified，
   * 由用户自行提交姓名 + 证件号、管理员核验后才置 verified。
   */
  realName: text("real_name"),
  realNameStatus: text("real_name_status").notNull().default("unverified"),
  /**
   * 微信开放平台 unionid —— **跨应用认人的唯一稳定键**。
   *
   * 公众号（手机验证码登录）与网站应用（电脑扫码登录）绑在同一个开放平台账号下，
   * 同一个微信号在两边的 openid 不同，但 unionid 相同。把它存在 users 上，
   * 手机登录就能直接找到电脑端建的老账号、继承它的昵称与历史数据，
   * 而不是各建各的。
   *
   * 唯一（Postgres 的唯一索引允许多个 NULL，所以未关联微信的账号不受影响）。
   */
  unionId: text("union_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginIp: text("last_login_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_union_id_unique").on(table.unionId),
]);

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
  /** 活动审核流：pending 只对发起人与管理端可见；与 submissions.review_status 同名不同义（那边审作品）。 */
  reviewStatus: text("review_status").notNull().default("published"),
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
  /** 管理端口手动隐藏：公开列表不再返回，抓取 upsert 不重置此标记。 */
  hidden: boolean("hidden").notNull().default(false),
  /** 最后一轮抓取（含失败轮之外的成功 upsert）见到它的时间，清理以两周没再见为准。 */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("external_events_source_external_unique").on(table.source, table.externalId),
  index("external_events_starts_idx").on(table.startsAt),
]);

/**
 * 审计日志（检查表 8.4）：用户注册、登录登出、内容发布、行为、管理员操作、安全事件全部落一条。
 * 只允许 INSERT —— 0009 迁移里用触发器把 UPDATE/DELETE 全部拒绝，实现「审计进程不能被单独中断、
 * 日志不可删除/修改/覆盖」；hash 字段是前一条的哈希串联，任何一条被改动都能顺着链验出来。
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 事件分类：auth | register | publish | behavior | admin | security | system。 */
  category: text("category").notNull(),
  /** 具体动作，如 auth.login / publish.activity.create / admin.user.role。 */
  action: text("action").notNull(),
  /**
   * 可溯源三件套（8.4.3）：真实用户 ID、网络地址、协议。
   * 刻意不加外键 —— 审计表 append-only，若挂 ON DELETE SET NULL，删用户时
   * Postgres 对本表的 UPDATE 会被防篡改触发器拒绝，用户就永远删不掉；
   * 追溯由 user_email 文本兜底（0011 迁移移除了 0009 误建的外键）。
   */
  userId: uuid("user_id"),
  userEmail: text("user_email"),
  ip: text("ip"),
  port: text("port"),
  protocol: text("protocol"),
  userAgent: text("user_agent"),
  method: text("method"),
  path: text("path"),
  status: integer("status"),
  targetType: text("target_type"),
  targetId: text("target_id"),
  /** 内容标题/摘要与变更明细，JSON。 */
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}),
  result: text("result").notNull().default("success"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  prevHash: text("prev_hash"),
  hash: text("hash"),
}, (table) => [
  index("audit_logs_created_idx").on(table.createdAt),
  index("audit_logs_user_idx").on(table.userId),
  index("audit_logs_action_idx").on(table.action),
  index("audit_logs_category_idx").on(table.category),
]);

/**
 * 用户黑名单（检查表 9.2.2c / 9.3.4）：平台自查或公安通报的账号进名单，
 * 名单内账号不能发起活动、报名、提交作品；生效时间与来源都留痕，供检查时核对。
 */
export const userBlacklist = pgTable("user_blacklist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  reason: text("reason").notNull(),
  /** platform = 平台自查发现；police = 公安机关通报。 */
  source: text("source").notNull().default("platform"),
  /** 触发次数（多次/大量发布违法有害信息才入名单）。 */
  hits: integer("hits").notNull().default(1),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("user_blacklist_email_unique").on(table.email),
  index("user_blacklist_effective_idx").on(table.effectiveFrom),
]);

/**
 * 代理商申请：只有代理商可以发布活动，普通用户在 /create 提交身份声明与联系方式，
 * 管理端审核通过后把 users.role 提为 agent。一个用户一份申请（重新提交即覆盖重审）。
 */
export const agentApplications = pgTable("agent_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contactName: text("contact_name").notNull(),
  organization: text("organization").notNull().default(""),
  phone: text("phone").notNull(),
  email: text("email").notNull().default(""),
  /** 身份声明：你是谁、计划发什么活动。 */
  statement: text("statement").notNull(),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("agent_applications_user_unique").on(table.userId),
  index("agent_applications_status_idx").on(table.status),
]);

/**
 * 公众号验证码登录（2026-10-21）。
 *
 * 为什么用这个方案：账号是**订阅号**，微信对它限制了两条路 ——
 * 带参二维码（仅认证服务号）与网页授权（仅服务号）。但**接收用户消息**是订阅号
 * 的基本能力，所以流程反过来：网页生成 6 位码 → 用户发给公众号 → 公众号把
 * (openid, 验证码) 推给我们的回调 → 前端轮询发现已绑定就换到登录态。
 *
 * 三条状态：
 *   pending   码已生成，等用户在公众号里发过来
 *   bound     已收到消息、拿到了 openid，等前端来取（一次性）
 *   consumed  前端已换走登录态
 *
 * 过期 10 分钟：够用户切到微信再发一条消息，又不至于让泄露的码长期可用。
 */
export const wechatLoginCodes = pgTable("wechat_login_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 6 位数字，全局唯一。存明文而非哈希：它不是密码，是给用户看、让用户手输的一次性口令。 */
  code: text("code").notNull(),
  status: text("status").notNull().default("pending"),
  /** 用户在公众号里发来消息后回填。 */
  openId: text("open_id"),
  /** 公众号 openid 对应的 unionid —— 用来和网站应用扫码登录的老账号合并。 */
  unionId: text("union_id"),
  /** 已解析出的站内用户（绑定成功时才写）。 */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** 生成时的来源 IP，用于限流与审计。 */
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** 前端取走登录态的时刻。取走后不可再取（一次性）。 */
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("wechat_login_codes_code_unique").on(table.code),
  index("wechat_login_codes_status_idx").on(table.status, table.expiresAt),
  index("wechat_login_codes_openid_idx").on(table.openId),
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
