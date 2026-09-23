/**
 * 杭客松核心机制的数值定义与贡献数据入口。规则全文见 docs/prize-mechanism.md。
 */

export const MECHANISM = {
  /** 正式阶段每日算力券：基础 ¥100，每成功邀请一位新用户 +¥5，封顶 ¥200，当日有效。 */
  voucher: { base: 100, perInvite: 5, dailyCap: 200 },
  /** 产出物质量审核：24 小时内出档，每日最多 3 份有效提交。 */
  review: {
    hours: 24,
    dailySubmissions: 3,
    grades: [
      { label: "优", points: 100 },
      { label: "良", points: 60 },
      { label: "合格", points: 30 },
      { label: "未通过", points: 0 },
    ] as const,
  },
  /** 邀请激励：活动期间任何报名用户都可分享邀请链接，对方接受并加入后双方各得贡献值。 */
  invite: { inviterBonus: 50, inviteeBonus: 20 },
  /** 活动结束时邀请人数最多者获得区长称号，个人贡献值额外 +5%。 */
  leaderBonusPct: 0.05,
  /** 活动结束的荣誉结算（折算为平台贡献值）。 */
  honor: {
    organizerRate: 0.1, // 举办者 = 活动总贡献值 × 10%
    top10Bonus: 200, // 个人贡献前 10%
    top30Bonus: 100, // 个人贡献前 11–30%
    championFactionBonus: 150, // 冠军战队每人
    runnerUpFactionBonus: 80, // 亚军战队每人（需 ≥2 支战队有贡献）
    finisherBonus: 50, // 至少 1 份合格提交
  },
} as const;

/** 「数字杭州市民」勋章：平台唯一，按平台贡献值定星级，只升不降。 */
export const HONOR_LEVELS = [
  { stars: 1, min: 0, title: "初来数字市民" },
  { stars: 2, min: 500, title: "常驻数字市民" },
  { stars: 3, min: 2000, title: "活跃数字市民" },
  { stars: 4, min: 6000, title: "共建数字市民" },
  { stars: 5, min: 15000, title: "荣誉数字市民" },
] as const;

export function honorLevel(points: number) {
  let index = 0;
  for (let i = 0; i < HONOR_LEVELS.length; i += 1) {
    if (points >= HONOR_LEVELS[i].min) index = i;
  }
  const level = HONOR_LEVELS[index];
  const next = HONOR_LEVELS[index + 1] ?? null;
  const progress = next
    ? Math.min(100, Math.max(0, ((points - level.min) / (next.min - level.min)) * 100))
    : 100;
  return { ...level, next, progress };
}

export type TeamPoints = { id: string; name: string; color: string; points: number; /** 队长（成员用户名）：只有队长可以邀请用户加入战队。 */ captain?: string };
export type MemberPoints = { name: string; teamId: string; points: number };
export type ActivityContribution = { teams: TeamPoints[]; members: MemberPoints[] };

/** 某成员担任队长的战队（一场活动中最多领一支；不是队长返回 undefined）。 */
export function teamByCaptain(teams: TeamPoints[], name: string): TeamPoints | undefined {
  return teams.find((team) => team.captain === name);
}

/** 当前没有已核验的战队与个人贡献记录；收到真实结算数据后写入此数据源。 */
export const CONTRIBUTIONS: Record<string, ActivityContribution> = {};

export function getContribution(activityId: string): ActivityContribution | null {
  return CONTRIBUTIONS[activityId] ?? null;
}

export type TeamShare = { team: TeamPoints; points: number; share: number; prize: number };

/** 战队贡献占比；有奖金时同时算出各战队按两层比例公式应得的奖金。区不计入贡献统计。 */
export function teamShares(contribution: ActivityContribution | null, prizePool: number): TeamShare[] {
  if (!contribution) return [];
  const total = contribution.teams.reduce((sum, item) => sum + item.points, 0);
  return contribution.teams
    .map((team) => {
      const share = total > 0 ? team.points / total : 0;
      return team.points > 0
        ? { team, points: team.points, share, prize: Math.round(prizePool * share) }
        : null;
    })
    .filter((row): row is TeamShare => row !== null)
    .sort((a, b) => b.points - a.points);
}

export type CitizenRow = { name: string; team: TeamPoints | null; points: number; activities: number };

/** 平台总览：总贡献值、活动数、数字市民数、战队贡献榜、个人贡献榜（徽标 = 贡献最多的战队）。 */
export function platformTotals() {
  const teamTotals = new Map<string, TeamPoints>();
  const citizens = new Map<string, { points: number; activities: number; teams: Map<string, number> }>();

  for (const contribution of Object.values(CONTRIBUTIONS)) {
    for (const team of contribution.teams) {
      const acc = teamTotals.get(team.id) ?? { ...team, points: 0 };
      acc.points += team.points;
      teamTotals.set(team.id, acc);
    }
    for (const member of contribution.members) {
      const row = citizens.get(member.name) ?? { points: 0, activities: 0, teams: new Map<string, number>() };
      row.points += member.points;
      row.activities += 1;
      row.teams.set(member.teamId, (row.teams.get(member.teamId) ?? 0) + member.points);
      citizens.set(member.name, row);
    }
  }

  const total = [...citizens.values()].reduce((sum, value) => sum + value.points, 0);
  const teams = [...teamTotals.values()].sort((a, b) => b.points - a.points);
  const users: CitizenRow[] = [...citizens.entries()]
    .map(([name, row]) => {
      // 跨活动换过战队的数字市民，徽标展示其贡献最多的战队
      const top = [...row.teams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const team = teamTotals.get(top) ?? null;
      return { name, team, points: row.points, activities: row.activities };
    })
    .sort((a, b) => b.points - a.points);

  return {
    total,
    activityCount: Object.keys(CONTRIBUTIONS).length,
    citizenCount: users.length,
    teams,
    users,
  };
}

/** 本机报名记录：按活动（key = activity.id）。参与者以个人账户参赛，无阵营字段。invitedBy = 邀请人用户名。 */
export type JoinRecord = { joinedAt: string; invitedBy?: string };

const JOINS_KEY = "hangkathon.joins.v1";

export function loadJoins(): Record<string, JoinRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(JOINS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const joins: Record<string, JoinRecord> = {};
    for (const [activityId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === "object" && typeof (value as JoinRecord).joinedAt === "string") {
        const record = value as JoinRecord;
        joins[activityId] = {
          joinedAt: record.joinedAt,
          ...(typeof record.invitedBy === "string" && record.invitedBy ? { invitedBy: record.invitedBy } : {}),
        };
      }
    }
    return joins;
  } catch {
    return {};
  }
}

export function loadJoin(activityId: string): JoinRecord | null {
  return loadJoins()[activityId] ?? null;
}

export function saveJoin(
  activityId: string,
  extra?: { invitedBy?: string },
): JoinRecord {
  const record: JoinRecord = {
    joinedAt: new Date().toISOString(),
    ...(extra?.invitedBy ? { invitedBy: extra.invitedBy } : {}),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(JOINS_KEY, JSON.stringify({ ...loadJoins(), [activityId]: record }));
  }
  return record;
}

/**
 * 数字区长不再在报名时认领：活动期间任何成员都可分享邀请链接，
 * 活动结束时由 lib/invites.ts 按成功邀请数结算（见 MECHANISM.invite / leaderBonusPct）。
 */
