/**
 * 微信身份合并的**纯决策逻辑**（不碰数据库，便于单测）。
 *
 * 为什么把决策单独抽出来：合并方向写反这类错误不会让程序报错 ——
 * 它会安静地把两个人并成一个、或者把同一个人拆成两行。
 * 这类分支只有靠单测锁住，靠读代码是看不出来的。
 */

export type WechatIdentityRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /** 注册时间：合并时用它决定保留哪一行。 */
  createdAt?: Date | string;
};

export type IdentityPlan =
  /** 只命中 unionid：直接复用 */
  | { action: "reuse"; row: WechatIdentityRow }
  /** 只命中本应用占位邮箱：复用并补 unionid */
  | { action: "attach-union"; row: WechatIdentityRow }
  /** 两行都命中且不同：把 loser 并进 keeper */
  | { action: "merge"; keeper: WechatIdentityRow; loser: WechatIdentityRow }
  /** 都没有：新建 */
  | { action: "create" };

function timeOf(row: WechatIdentityRow): number {
  if (!row.createdAt) return Number.POSITIVE_INFINITY;
  const value = row.createdAt instanceof Date ? row.createdAt.getTime() : Date.parse(row.createdAt);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * 决定这次登录该怎么落库。
 *
 * **keeper 必须是注册更早的那一行**（这就是"老账号"——昵称、报名、作品都在它名下），
 * 而不是"本次登录应用对应的行"。理由：
 *   1. 合并的语义就是"把新号并进老号"，反过来会让老账号的 id 消失、
 *      任何引用它的旧数据都得重写，风险大且没有收益。
 *   2. 会话身份由 `resolveWechatUser` 返回的 email 决定（两边登录都会用 keeper 的
 *      email 签 JWT），所以 Auth.js 按 email upsert 时落到的仍是 keeper，
 *      不会因为 keeper 不是"本应用的行"而另建一行。
 *   3. 稳定性：被删掉的 loser 如果正好是某个尚未过期的 JWT 的 email，那条会话
 *      下次请求会 upsert 出一个空行；keeper 取更早的行时通常会先被合并进来、
 *      也就先被删除，不会留下这种"僵尸会话复活"的入口。
 * 时间完全相同（同一毫秒建的两行）时按 id 排序，保证结果确定 —— 否则两个实例
 * 可能各自选出不同的 keeper，来回删对方。
 */
export function planIdentity(input: {
  byUnion: WechatIdentityRow | null;
  byEmail: WechatIdentityRow | null;
}): IdentityPlan {
  const { byUnion, byEmail } = input;

  if (byUnion && byEmail) {
    if (byUnion.id === byEmail.id) return { action: "reuse", row: byEmail };
    const unionTime = timeOf(byUnion);
    const emailTime = timeOf(byEmail);
    const unionOlder = unionTime < emailTime || (unionTime === emailTime && byUnion.id < byEmail.id);
    return unionOlder
      ? { action: "merge", keeper: byUnion, loser: byEmail }
      : { action: "merge", keeper: byEmail, loser: byUnion };
  }
  if (byUnion) return { action: "reuse", row: byUnion };
  if (byEmail) return { action: "attach-union", row: byEmail };
  return { action: "create" };
}

/**
 * 合并时该给 keeper 补哪些字段。
 *
 * **返回空对象是合法结果**，调用方必须跳过这次 UPDATE ——
 * drizzle 对 `set({})` 直接抛 `No values to set`，会让整个合并事务回滚。
 * 线上真实踩过：keeper 已有昵称、loser 又没有任何可补字段（最常见的情形，
 * 因为公众号侧从不给昵称），合并就静默失败、下次登录再失败一次。
 */
export function mergeProfilePatch(
  keeper: { name: string | null; image: string | null },
  loser: { name: string | null; image: string | null; role: string } | null | undefined,
): { name?: string; image?: string; role?: string } {
  const patch: { name?: string; image?: string; role?: string } = {};
  if (!keeper.name && loser?.name) patch.name = loser.name;
  if (!keeper.image && loser?.image) patch.image = loser.image;
  // 角色只升不降：管理员身份不能因为合并到另一行而丢失
  if (loser?.role === "admin") patch.role = "admin";
  return patch;
}
/**
 * 昵称/头像的取舍：**本次的非空值优先**（用户可能刚在微信里改过），
 * 空值不回写（公众号侧 2021-12-27 起恒返回空串，不能拿它抹掉扫码拿到的昵称）。
 */
export function preferredProfile(
  current: { name: string | null; image: string | null },
  incoming: { nickname?: string | null; image?: string | null },
): { name: string | null; image: string | null } {
  const incomingName = incoming.nickname?.trim() || null;
  const incomingImage = incoming.image?.trim() || null;
  return {
    name: incomingName ?? current.name,
    image: incomingImage ?? current.image,
  };
}
