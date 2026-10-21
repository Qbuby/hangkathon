import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { InviteEvent } from "@/lib/invites";
import { displayName, identityName } from "@/lib/display-name";

/**
 * 邀请事件：inviter/invitee 存 user id（原来是显示名字符串）。
 * 返回给前端时把 id 换成**展示名**，前端现有的 settleFactionLeaders / inviteCount 逻辑不用改。
 *
 * 2026-10-21：展示名统一走 lib/display-name。此前是 `name || email`，
 * 微信账号没有昵称时会把 `<openid>@wechat.user` 原样当成名字 ——
 * 它既会出现在页面上，也会被编进邀请链接的 `by=` 参数里。
 */

export type ServerInviteEvent = InviteEvent & { inviterId: string; inviteeId: string };

export async function listInviteEvents(viewerId: string): Promise<ServerInviteEvent[]> {
  const db = getDb();
  const rows = await db.select().from(schema.inviteEvents);
  const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users);
  const nameOf = new Map(users.map((user) => [user.id, identityName(user, "未知用户")]));
  const activities = await db.select({ id: schema.activities.id }).from(schema.activities);
  const activityIds = new Set(activities.map((row) => row.id));
  return rows
    .filter((row) => activityIds.has(row.activityId))
    .map((row) => ({
      activityId: row.activityId,
      factionId: row.factionId,
      teamId: row.teamId ?? undefined,
      inviter: nameOf.get(row.inviterId) ?? "未知用户",
      invitee: nameOf.get(row.inviteeId) ?? "未知用户",
      at: row.at.toISOString(),
      inviterId: row.inviterId,
      inviteeId: row.inviteeId,
    }))
    .filter((event) => event.inviterId === viewerId || event.inviteeId === viewerId);
}

export async function recordInviteEvent(
  input: { activityId: string; factionId: string; teamId?: string | null; inviterId: string; inviteeId: string },
): Promise<ServerInviteEvent> {
  const db = getDb();
  const [row] = await db
    .insert(schema.inviteEvents)
    .values({
      activityId: input.activityId,
      factionId: input.factionId,
      teamId: input.teamId ?? null,
      inviterId: input.inviterId,
      inviteeId: input.inviteeId,
    })
    .returning();
  const [inviter] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.inviterId));
  const [invitee] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.inviteeId));
  return {
    activityId: row.activityId,
    factionId: row.factionId,
    teamId: row.teamId ?? undefined,
    inviter: inviter ? identityName(inviter, "未知用户") : "未知用户",
    invitee: invitee ? identityName(invitee, "未知用户") : "未知用户",
    at: row.at.toISOString(),
    inviterId: row.inviterId,
    inviteeId: row.inviteeId,
  };
}

/**
 * 按显示名找用户（邀请链接里带的是 `by=<展示名>`）。
 *
 * 同时接受原始 name 与 email：一是兼容改版前已发出去的链接，
 * 二是展示名对普通账号可能被截断，原文仍应命中。
 */
export async function findUserByNameOrEmail(value: string) {
  const db = getDb();
  const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users);
  return (
    users.find(
      (user) =>
        user.name === value || user.email === value || identityName(user, "\u0000") === value || displayName(user, "\u0000") === value,
    ) ?? null
  );
}
