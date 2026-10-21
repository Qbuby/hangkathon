/**
 * 微信身份 → 站内用户：**两种登录方式共用的唯一入口**。
 *
 * 背景（2026-10-21）：
 *   · 电脑扫码走「网站应用」，拿到的是网站应用的 openid；
 *   · 手机走公众号验证码，拿到的是公众号的 openid；
 *   · 同一个微信号在这两个应用里 openid **不同**，但 unionid **相同**。
 *
 * 之前只把 unionid 存在一次性验证码表里，users 上没有，于是：
 *   - 手机登录找不到电脑端建的老账号 → 另建一行，昵称/报名全丢；
 *   - 反过来先在手机登录、再回电脑扫码，同样会裂号。
 *
 * 现在 users.union_id 是跨应用认人的稳定键。解析顺序：
 *   1. unionid 命中 → 复用那行（唯一正确的合并依据）
 *   2. 占位邮箱命中 → 复用，并顺手补上 unionid（历史数据自愈）
 *   3. 两行都命中但不是同一行 → **合并**：把较新的那行折进较早的老账号
 *   4. 都没有 → 新建
 */

import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { mergeProfilePatch, planIdentity, preferredProfile } from "./wechat-identity-pure";

export type ResolvedWechatUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /** 本次调用是否新建了用户行（审计用："首次登录即注册"）。 */
  created: boolean;
  /** 本次是否把另一行合并进来（跨端首登时会发生）。 */
  merged?: boolean;
};

export type WechatIdentityInput = {
  openId: string;
  unionId: string | null;
  /** 扫码登录才有（sns/userinfo 仍返回）；公众号侧 2021-12-27 起恒为空。 */
  nickname?: string | null;
  image?: string | null;
};

const PLACEHOLDER_SUFFIX = "@wechat.user";

/**
 * 与 auth.ts / 换票路由共用的占位邮箱约定。
 *
 * **必须转小写**：`currentUser()` 读会话时会把 email 转小写再按 email upsert，
 * 而 openid 本身是大小写敏感的（`oe8Tr3AQMIN1...` 里就有大写）。
 * 如果建号时保留原始大小写，下一次任何接口调用都会因 exact-match 查不到而**再建一行** ——
 * 线上真的这样裂过号：同一个微信用户两行，昵称/报名落在其中一行，另一行永远空着。
 * 站内身份统一小写，原始 openid 只作为微信协议参数使用（它不经过这层）。
 */
export function wechatEmail(openId: string): string {
  return `${openId}${PLACEHOLDER_SUFFIX}`.toLowerCase();
}

/** 所有 email 比较都走这个，避免大小写差异被当成两个账号。 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type IdentityRow = { id: string; email: string; name: string | null; image: string | null; createdAt: Date };

const identityColumns = {
  id: schema.users.id,
  email: schema.users.email,
  name: schema.users.name,
  image: schema.users.image,
  createdAt: schema.users.createdAt,
};

async function findByUnionId(unionId: string): Promise<IdentityRow | null> {
  const [row] = await getDb().select(identityColumns).from(schema.users).where(eq(schema.users.unionId, unionId)).limit(1);
  return row ?? null;
}

async function findByEmail(email: string): Promise<IdentityRow | null> {
  // 历史数据里有大小写混杂的占位邮箱（建号时没归一化），这里按 lower 比，
  // 才能把它们认成同一个账号而不是各建一行。迁移 0014 会把这些行合并并归一化。
  const [row] = await getDb()
    .select(identityColumns)
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return row ?? null;
}

/**
 * 按合并别名找存活账号。
 *
 * 合并后旧 email 的 users 行已删除，`findByEmail` 查不到。若这里不查别名，
 * 下一次登录就会**再建一个空号** —— 迁移里刚清理掉的那种行正是这么长出来的。
 */
async function findByAlias(email: string): Promise<IdentityRow | null> {
  const [row] = await getDb()
    .select(identityColumns)
    .from(schema.users)
    .innerJoin(schema.userEmailAliases, eq(schema.userEmailAliases.userId, schema.users.id))
    .where(sql`lower(${schema.userEmailAliases.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return row ?? null;
}

/**
 * 把 unionid 写到某行用户上（用户行上还没有时）。
 *
 * 唯一索引冲突（另一行已经持有这个 unionid）时**静默放弃**：
 * 说明并发首登的另一路已经赢了这个身份，调用方会重新按 unionid 查回来。
 */
async function attachUnionId(userId: string, unionId: string): Promise<void> {
  try {
    await getDb()
      .update(schema.users)
      .set({ unionId })
      .where(sql`${schema.users.id} = ${userId} AND ${schema.users.unionId} IS NULL`);
  } catch (error) {
    console.error("[wechat-identity] 写入 unionid 失败（忽略，按 unionid 重查）", error);
  }
}

/** 昵称/头像：本次的非空值更新到库里，空值**不回写**（公众号侧永远是空串，不能抹掉扫码拿到的昵称）。 */
async function refreshProfile(userId: string, input: WechatIdentityInput): Promise<void> {
  const name = input.nickname?.trim();
  const image = input.image?.trim();
  if (!name && !image) return;
  await getDb()
    .update(schema.users)
    .set({
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
    })
    .where(eq(schema.users.id, userId));
}

/**
 * 把 loser 这个账号折进 keeper，然后删掉 loser。
 *
 * 为什么需要它：历史上同一个微信号可能已经裂成两行 ——
 * 手机先登录建了 `<公众号 openid>@wechat.user`，电脑扫码又建了
 * `<网站应用 openid>@wechat.user`（老版本没存 unionid，认不出来）。
 * 等到某次登录同时拿到「本应用的 openid」和「unionid」，就足以证明
 * 这两行是同一个人，此时把数据并到当前应用这一行，用户不会丢报名/作品。
 *
 * 业务表对 users 的外键就这几处（见 db/schema.ts）；audit_logs 刻意不持有
 * 外键（迁移 0011），所以历史审计不受影响、也不会被改。
 *
 * **一定要把 loser 的 email 写进别名表**：合并之后用户在另一台设备上
 * 握着的 JWT 里还留着被删掉的 email，不记别名就会 upsert 出空白新号
 * （线上真实故障：手机端变成「微信用户 · 6B1B67」，数据全丢）。
 */
async function mergeUsers(
  keeper: Pick<IdentityRow, "id" | "email" | "name" | "image">,
  loser: Pick<IdentityRow, "id" | "email" | "name" | "image">,
): Promise<void> {
  const db = getDb();
  const k = keeper.id;
  const l = loser.id;

  await db.transaction(async (tx) => {
    // 报名：同一活动两边都报过时，保留 keeper 那条，先删掉 loser 的重复行
    await tx.execute(sql`
      DELETE FROM joins l
      USING joins k
      WHERE l.user_id = ${l} AND k.user_id = ${k} AND l.activity_id = k.activity_id
    `);
    await tx.update(schema.joins).set({ userId: k }).where(eq(schema.joins.userId, l));
    await tx.update(schema.joins).set({ invitedBy: k }).where(eq(schema.joins.invitedBy, l));

    await tx.update(schema.submissions).set({ userId: k }).where(eq(schema.submissions.userId, l));
    await tx.update(schema.inviteEvents).set({ inviterId: k }).where(eq(schema.inviteEvents.inviterId, l));
    await tx.update(schema.inviteEvents).set({ inviteeId: k }).where(eq(schema.inviteEvents.inviteeId, l));
    await tx.update(schema.activities).set({ ownerId: k }).where(eq(schema.activities.ownerId, l));

    // 代理商申请：一人一份（唯一索引），keeper 已有就删掉 loser 的
    const existing = await tx
      .select({ id: schema.agentApplications.id })
      .from(schema.agentApplications)
      .where(eq(schema.agentApplications.userId, k))
      .limit(1);
    if (existing.length > 0) {
      await tx.delete(schema.agentApplications).where(eq(schema.agentApplications.userId, l));
    } else {
      await tx.update(schema.agentApplications).set({ userId: k }).where(eq(schema.agentApplications.userId, l));
    }

    await tx.update(schema.wechatLoginCodes).set({ userId: k }).where(eq(schema.wechatLoginCodes.userId, l));

    /**
     * 黑名单按 **email** 存、按当前会话 email 判。合并后登录身份会变成 keeper 的 email，
     * 所以 loser 名下的条目必须跟着迁移 —— 否则一个因违规被拉黑的人，
     * 只要换一种登录方式（另一条 email）就能绕过限制。
     * keeper 已有条目时保留它（不覆盖管理员填的理由与期限），只删 loser 的。
     */
    const [blacklisted] = await tx
      .select({ id: schema.userBlacklist.id })
      .from(schema.userBlacklist)
      .where(eq(schema.userBlacklist.email, keeper.email))
      .limit(1);
    if (blacklisted) {
      await tx.delete(schema.userBlacklist).where(eq(schema.userBlacklist.email, loser.email));
    } else {
      await tx.update(schema.userBlacklist).set({ email: keeper.email }).where(eq(schema.userBlacklist.email, loser.email));
    }
    await tx.update(schema.userBlacklist).set({ createdBy: k }).where(eq(schema.userBlacklist.createdBy, l));
    await tx.update(schema.userBlacklist).set({ revokedBy: k }).where(eq(schema.userBlacklist.revokedBy, l));
    await tx.update(schema.agentApplications).set({ reviewedBy: k }).where(eq(schema.agentApplications.reviewedBy, l));

    /**
     * 记录别名：loser 的 email 从此失效，但它的旧 JWT 还在用户浏览器里。
     * `ensureUser()` 会先查这张表，把旧会话解析到 keeper，而不是新建空号。
     * ON CONFLICT DO NOTHING：同一对账号被重复合并时不该报错。
     */
    await tx
      .insert(schema.userEmailAliases)
      .values({ email: normalizeEmail(loser.email), userId: k })
      .onConflictDoNothing();

    // 昵称/头像/角色：只在有东西可补时才 UPDATE ——
    // drizzle 对 `set({})` 抛 "No values to set"，会让整个事务回滚（线上真踩过）。
    const [loserRow] = await tx
      .select({
        name: schema.users.name,
        image: schema.users.image,
        role: schema.users.role,
        unionId: schema.users.unionId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, l));
    const patch = mergeProfilePatch(keeper, loserRow);
    if (Object.keys(patch).length > 0) {
      await tx.update(schema.users).set(patch).where(eq(schema.users.id, k));
    }

    await tx.delete(schema.users).where(eq(schema.users.id, l));

    /**
     * unionid 必须**先删 loser 再写 keeper**：唯一索引在同一事务里也是即时校验的，
     * 反过来写会撞上还没删掉的那一行。
     */
    if (loserRow?.unionId) {
      await tx.update(schema.users).set({ unionId: loserRow.unionId }).where(eq(schema.users.id, k));
    }
  });
}

export async function resolveWechatUser(input: WechatIdentityInput): Promise<ResolvedWechatUser> {
  const db = getDb();
  const unionId = input.unionId?.trim() || null;
  const email = wechatEmail(input.openId);

  const byUnion = unionId ? await findByUnionId(unionId) : null;
  /**
   * 先按当前 email 找，找不到再查**合并别名**。
   *
   * 为什么两步都要：合并之后被并掉那行的 email 已经不是任何 users 行，
   * 但它仍是这台设备的登录身份。只查 users 会建空号（迁移 0015 清理的就是这种），
   * 查别名才能落回存活账号（带昵称、带数据）。
   */
  const byEmail = (await findByEmail(email)) ?? (await findByAlias(email));
  const plan = planIdentity({ byUnion, byEmail });

  // 两行都命中且不是同一行 → 同一个人（unionid 与本次 openid 同时由微信给出），合并。
  // keeper/loser 的取舍见 planIdentity 的注释（keeper = 注册更早的那行，即老账号）。
  if (plan.action === "merge") {
    const { keeper, loser } = plan;
    try {
      await mergeUsers(keeper, loser);
      const merged = {
        ...keeper,
        ...preferredProfile({ name: keeper.name ?? loser.name, image: keeper.image ?? loser.image }, input),
      };
      await refreshProfile(merged.id, input);
      return { ...merged, created: false, merged: true };
    } catch (error) {
      // 合并失败不阻断登录：先用 unionid 那一行（同一个人，数据还在），
      // 下次登录会再试一次合并。
      console.error("[wechat-identity] 合并账号失败，暂用 unionid 命中行", error);
      const row = byUnion ?? keeper;
      await refreshProfile(row.id, input);
      return { ...row, ...preferredProfile(row, input), created: false };
    }
  }

  // unionid 命中：跨应用认人的正路
  if (plan.action === "reuse") {
    await refreshProfile(plan.row.id, input);
    return { ...plan.row, ...preferredProfile(plan.row, input), created: false };
  }

  // 本应用的占位邮箱命中（unionid 还没落库的历史账号）→ 顺手补上 unionid
  if (plan.action === "attach-union") {
    if (unionId) await attachUnionId(plan.row.id, unionId);
    await refreshProfile(plan.row.id, input);
    return { ...plan.row, ...preferredProfile(plan.row, input), created: false };
  }

  // 新建。email 冲突（并发首登）时退回按 email/unionid 查，而不是再插一次。
  try {
    const [created] = await db
      .insert(schema.users)
      .values({
        email,
        name: input.nickname?.trim() || null,
        image: input.image?.trim() || null,
        unionId,
      })
      .returning(identityColumns);
    if (created) return { ...created, created: true };
  } catch (error) {
    console.error("[wechat-identity] 新建用户失败，按邮箱/unionid 重查", error);
  }

  if (unionId) {
    const again = await findByUnionId(unionId);
    if (again) return { ...again, created: false };
  }
  const fallback = (await findByEmail(email)) ?? (await findByAlias(email));
  if (!fallback) throw new Error("微信身份解析失败：用户既未创建也无法回查");
  return { ...fallback, created: false };
}

/**
 * 按 id 取会话要用的身份字段。
 *
 * 公众号换票时用它签 JWT：`name`/`image` 必须来自 users 行，
 * 否则手机登录拿到的会话永远是匿名的 —— 而微信侧从 2021-12-27 起
 * 不再返回昵称，只有这里能把扫码时存下的昵称带进手机端会话。
 *
 * 顺带把 email 归一化：历史行里可能保留着含大写的 openid，
 * 而 `currentUser()` 一律按小写 email upsert —— 不归一化就会在下次请求时再建一行。
 */
export async function getWechatSessionIdentity(userId: string): Promise<IdentityRow | null> {
  const db = getDb();
  const [row] = await db.select(identityColumns).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!row) return null;
  const normalized = normalizeEmail(row.email);
  if (normalized === row.email) return row;

  // 就地修好这一行，避免"换个接口就多一个账号"。email 唯一索引冲突说明
  // 小写那行已经存在（历史裂号），此时返回小写行 —— 与下次登录的解析结果一致。
  const existing = await findByEmail(normalized);
  if (existing && existing.id !== row.id) return existing;
  try {
    await db.update(schema.users).set({ email: normalized }).where(eq(schema.users.id, row.id));
  } catch (error) {
    console.error("[wechat-identity] 归一化 email 失败（忽略，本次仍用小写身份）", error);
  }
  return { ...row, email: normalized };
}
