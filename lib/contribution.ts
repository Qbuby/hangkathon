import { factionById, type Faction } from "./factions";

/**
 * 杭客松核心机制的数值定义与演示数据。规则全文见 docs/prize-mechanism.md。
 * 所有数据目前是演示数据；接入数据库后，把 CONTRIBUTIONS 换成服务端查询即可，页面代码不变。
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
  /** 活动结束的荣誉结算（折算为平台贡献值）。 */
  honor: {
    organizerRate: 0.1, // 举办者 = 活动总贡献值 × 10%
    top10Bonus: 200, // 个人贡献前 10%
    top30Bonus: 100, // 个人贡献前 11–30%
    championFactionBonus: 150, // 冠军阵营每人
    runnerUpFactionBonus: 80, // 亚军阵营每人（需 ≥2 个阵营有贡献）
    finisherBonus: 50, // 至少 1 份合格提交
  },
} as const;

/** 「数字杭州市民」勋章：平台唯一，按平台贡献值定星级，只升不降。 */
export const HONOR_LEVELS = [
  { stars: 1, min: 0, title: "初来市民" },
  { stars: 2, min: 500, title: "常驻市民" },
  { stars: 3, min: 2000, title: "活跃市民" },
  { stars: 4, min: 6000, title: "共建市民" },
  { stars: 5, min: 15000, title: "荣誉市民" },
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

export type FactionPoints = { factionId: string; points: number };
export type MemberPoints = { name: string; factionId: string; points: number };
export type ActivityContribution = { factions: FactionPoints[]; members: MemberPoints[] };

/** 三场演示活动的阵营与个人贡献演示数据（虚构市民与分值）。 */
export const CONTRIBUTIONS: Record<string, ActivityContribution> = {
  demo_midautumn_poetry: {
    factions: [
      { factionId: "xihu", points: 1520 },
      { factionId: "shangcheng", points: 1150 },
      { factionId: "gongshu", points: 880 },
      { factionId: "binjiang", points: 690 },
      { factionId: "yuhang", points: 460 },
    ],
    members: [
      { name: "lakeside_verses", factionId: "xihu", points: 560 },
      { name: "broken_bridge", factionId: "xihu", points: 480 },
      { name: "longjing_tea", factionId: "xihu", points: 480 },
      { name: "osmanthus_lane", factionId: "shangcheng", points: 520 },
      { name: "qiantang_tide", factionId: "shangcheng", points: 380 },
      { name: "wushan_wind", factionId: "shangcheng", points: 250 },
      { name: "canal_oars", factionId: "gongshu", points: 470 },
      { name: "qiaoxi_street", factionId: "gongshu", points: 410 },
      { name: "binjiang_ferry", factionId: "binjiang", points: 390 },
      { name: "code_osmanthus", factionId: "binjiang", points: 300 },
      { name: "liangzhu_jade", factionId: "yuhang", points: 280 },
      { name: "future_town_coder", factionId: "yuhang", points: 180 },
    ],
  },
  demo_shop_assistant: {
    factions: [
      { factionId: "gongshu", points: 2100 },
      { factionId: "binjiang", points: 1680 },
      { factionId: "shangcheng", points: 1450 },
      { factionId: "xiaoshan", points: 920 },
      { factionId: "linping", points: 640 },
    ],
    members: [
      { name: "shopkeeper_hz", factionId: "gongshu", points: 860 },
      { name: "qiaoxi_street", factionId: "gongshu", points: 640 },
      { name: "dadou_kitchen", factionId: "gongshu", points: 600 },
      { name: "code_osmanthus", factionId: "binjiang", points: 880 },
      { name: "binjiang_ferry", factionId: "binjiang", points: 800 },
      { name: "osmanthus_lane", factionId: "shangcheng", points: 730 },
      { name: "zhongshan_road", factionId: "shangcheng", points: 720 },
      { name: "xianghu_night", factionId: "xiaoshan", points: 540 },
      { name: "shixin_square", factionId: "xiaoshan", points: 380 },
      { name: "yishang_town", factionId: "linping", points: 360 },
      { name: "linping_north", factionId: "linping", points: 280 },
    ],
  },
  demo_city_memory: {
    factions: [
      { factionId: "xihu", points: 1180 },
      { factionId: "shangcheng", points: 940 },
      { factionId: "gongshu", points: 760 },
      { factionId: "fuyang", points: 420 },
      { factionId: "tonglu", points: 300 },
    ],
    members: [
      { name: "broken_bridge", factionId: "xihu", points: 620 },
      { name: "lakeside_verses", factionId: "xihu", points: 560 },
      { name: "qiantang_tide", factionId: "shangcheng", points: 540 },
      { name: "nanxing_bridge", factionId: "shangcheng", points: 400 },
      { name: "xiaohe_street", factionId: "gongshu", points: 460 },
      { name: "canal_oars", factionId: "gongshu", points: 300 },
      { name: "guanshan_view", factionId: "fuyang", points: 420 },
      { name: "fuchun_villa", factionId: "tonglu", points: 300 },
    ],
  },
};

export function getContribution(activityId: string): ActivityContribution | null {
  return CONTRIBUTIONS[activityId] ?? null;
}

export type FactionShare = { faction: Faction; points: number; share: number; prize: number };

/** 阵营贡献占比；有奖金时同时算出各阵营按两层比例公式应得的奖金。 */
export function factionShares(contribution: ActivityContribution | null, prizePool: number): FactionShare[] {
  if (!contribution) return [];
  const total = contribution.factions.reduce((sum, item) => sum + item.points, 0);
  return contribution.factions
    .map((item) => {
      const faction = factionById(item.factionId);
      const share = total > 0 ? item.points / total : 0;
      return faction && item.points > 0
        ? { faction, points: item.points, share, prize: Math.round(prizePool * share) }
        : null;
    })
    .filter((row): row is FactionShare => row !== null)
    .sort((a, b) => b.points - a.points);
}

export type CitizenRow = { name: string; faction: Faction; points: number; activities: number };

export function platformTotals() {
  const factionTotals = new Map<string, number>();
  const citizens = new Map<string, { points: number; activities: number; factions: Map<string, number> }>();

  for (const contribution of Object.values(CONTRIBUTIONS)) {
    for (const item of contribution.factions) {
      factionTotals.set(item.factionId, (factionTotals.get(item.factionId) ?? 0) + item.points);
    }
    for (const member of contribution.members) {
      const row = citizens.get(member.name) ?? { points: 0, activities: 0, factions: new Map<string, number>() };
      row.points += member.points;
      row.activities += 1;
      row.factions.set(member.factionId, (row.factions.get(member.factionId) ?? 0) + member.points);
      citizens.set(member.name, row);
    }
  }

  const total = [...factionTotals.values()].reduce((sum, value) => sum + value, 0);
  const factions = factionShares(
    { factions: [...factionTotals.entries()].map(([factionId, points]) => ({ factionId, points })), members: [] },
    0,
  );
  const users: CitizenRow[] = [...citizens.entries()]
    .map(([name, row]) => {
      // 跨活动换过阵营的市民，徽标展示其贡献最多的阵营
      const top = [...row.factions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const faction = factionById(top);
      return faction ? { name, faction, points: row.points, activities: row.activities } : null;
    })
    .filter((row): row is CitizenRow => row !== null)
    .sort((a, b) => b.points - a.points);

  return {
    total,
    activityCount: Object.keys(CONTRIBUTIONS).length,
    citizenCount: users.length,
    factions,
    users,
  };
}

/** 本机报名记录：按活动锁定阵营（key = activity.id）。 */
export type JoinRecord = { factionId: string; joinedAt: string };

const JOINS_KEY = "hangkathon.joins.v1";

export function loadJoins(): Record<string, JoinRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(JOINS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const joins: Record<string, JoinRecord> = {};
    for (const [activityId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as JoinRecord).factionId === "string" &&
        factionById((value as JoinRecord).factionId) &&
        typeof (value as JoinRecord).joinedAt === "string"
      ) {
        joins[activityId] = { factionId: (value as JoinRecord).factionId, joinedAt: (value as JoinRecord).joinedAt };
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

export function saveJoin(activityId: string, factionId: string): JoinRecord {
  const record: JoinRecord = { factionId, joinedAt: new Date().toISOString() };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(JOINS_KEY, JSON.stringify({ ...loadJoins(), [activityId]: record }));
  }
  return record;
}
