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

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  owner: one(users, { fields: [activities.ownerId], references: [users.id] }),
  joins: many(joins),
  submissions: many(submissions),
}));

export const joinsRelations = relations(joins, ({ one }) => ({
  activity: one(activities, { fields: [joins.activityId], references: [activities.id] }),
  user: one(users, { fields: [joins.userId], references: [users.id] }),
}));
