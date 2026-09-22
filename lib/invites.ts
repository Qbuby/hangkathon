/**
 * 邀请激励与数字区长结算。
 *
 * 活动期间任何报名成员都可分享邀请链接；被邀请者接受并加入后记录一条邀请事件，
 * 双方各得贡献值激励（数值在 lib/contribution.ts 的 MECHANISM.invite）。
 * 活动结束时，每个阵营成功邀请人数最多的成员结算为该阵营数字区长（MECHANISM.leaderBonusPct 额外奖励）。
 *
 * 邀请事件独立于报名记录存储：同一浏览器里多个账号先后接受邀请也不会互相覆盖。
 */

export type InviteEvent = {
  activityId: string;
  factionId: string;
  inviter: string;
  invitee: string;
  at: string;
};

export type InviteStanding = { name: string; invites: number; earliestInviteAt: string };

const INVITES_KEY = "hangkathon.invites.v1";
const MAX_EVENTS = 200;

export function loadInviteEvents(): InviteEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(INVITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is InviteEvent =>
          !!item &&
          typeof item === "object" &&
          typeof (item as InviteEvent).activityId === "string" &&
          typeof (item as InviteEvent).factionId === "string" &&
          typeof (item as InviteEvent).inviter === "string" &&
          typeof (item as InviteEvent).invitee === "string" &&
          typeof (item as InviteEvent).at === "string",
      )
      .slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

export function recordInviteEvent(event: InviteEvent): InviteEvent[] {
  const events = [...loadInviteEvents(), event].slice(-MAX_EVENTS);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(INVITES_KEY, JSON.stringify(events));
  }
  return events;
}

/**
 * 结算某活动的数字区长：按阵营统计邀请事件，邀请数最多者胜出；
 * 并列时以最早一条受邀记录决胜。只统计有受邀记录的阵营。
 */
export function settleFactionLeaders(events: InviteEvent[], activityId: string): Record<string, InviteStanding> {
  // key = factionId::inviter；普通对象而非 Map，避免低转译目标下的迭代差异。
  const standings: Record<string, InviteStanding> = {};
  for (const event of events) {
    if (event.activityId !== activityId) continue;
    const key = `${event.factionId}::${event.inviter}`;
    const standing = standings[key] ?? {
      name: event.inviter,
      invites: 0,
      earliestInviteAt: event.at,
    };
    standing.invites += 1;
    if (event.at < standing.earliestInviteAt) standing.earliestInviteAt = event.at;
    standings[key] = standing;
  }
  const leaders: Record<string, InviteStanding> = {};
  for (const key of Object.keys(standings)) {
    const standing = standings[key];
    const factionId = key.slice(0, key.lastIndexOf("::"));
    const current = leaders[factionId];
    if (
      !current ||
      standing.invites > current.invites ||
      (standing.invites === current.invites && standing.earliestInviteAt < current.earliestInviteAt)
    ) {
      leaders[factionId] = standing;
    }
  }
  return leaders;
}

/** 某人在某活动某阵营的成功邀请数。 */
export function inviteCount(events: InviteEvent[], activityId: string, factionId: string, name: string): number {
  let count = 0;
  for (const event of events) {
    if (event.activityId === activityId && event.factionId === factionId && event.inviter === name) count += 1;
  }
  return count;
}
