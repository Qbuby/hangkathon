/**
 * 展示用的身份名 —— **只负责显示，不参与身份判定**。
 *
 * 背景（2026-10-21 用户反馈）：微信登录没有昵称时，站内身份是合成的占位邮箱
 * `<openid>@wechat.user`。个人主页等位置直接 `name ?? email` 就把整串 openid
 * 打在了页面上（截图里是 `oe8Tr3AQMIN1Y2qFWb…`）。openid 是账号标识，不该当昵称展示。
 *
 * 规则：
 *   1. 有昵称就用昵称（过长截断，避免把整段营销文案塞进标题）；
 *   2. 占位邮箱 → 「微信用户 · XXXX」，XXXX 是 openid 的稳定散列，**不泄露原串**；
 *      同一个 openid 每次得到同一个标签，用户能认出"这是我的号"；
 *   3. 普通邮箱照旧展示（GitHub/Google 登录的部署仍有这类账号）；
 *   4. 都没有才用调用方给的兜底文案。
 *
 * 为什么用散列而不是截取 openid 前/后几位：openid 是微信侧的稳定身份，
 * 哪怕露 4 位也等于把身份键的一部分公开在页面上；散列只保留"可区分"这一个性质。
 */

export type DisplayIdentity = {
  name?: string | null;
  email?: string | null;
};

/** auth.ts 与公众号换票路由共用的占位邮箱后缀。 */
export const WECHAT_EMAIL_SUFFIX = "@wechat.user";

/** 昵称展示上限：超出用省略号，保证标题不换行、不撑破卡片。 */
export const DISPLAY_NAME_MAX = 16;

export function isWechatPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(WECHAT_EMAIL_SUFFIX);
}

/**
 * FNV-1a 32 位散列，取前 6 位十六进制。
 *
 * 不追求密码学强度 —— 这里的目标只是"同一个 openid 稳定得到同一个短标签，
 * 且从标签反推不出 openid"。6 位 = 1677 万个标签：100 个用户时碰撞概率
 * 约 0.03%（4 位是 7%）。碰撞只会让两个陌生人的**展示名/邀请归属**相同，
 * 不影响身份与权限 —— 那些始终按 email/userId 判定。
 */
export function wechatDisplayTag(email: string): string {
  const source = email.slice(0, -WECHAT_EMAIL_SUFFIX.length);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
}

/** 按字符（而不是 UTF-16 码元）截断，避免把 emoji / 中文劈成半个。 */
function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max).join("")}…`;
}

/** 展示名。传入 `fallback: ""` 可让"没有可展示的名字"返回空串（表单预填用）。 */
export function displayName(user: DisplayIdentity | null | undefined, fallback = "数字市民"): string {
  const name = user?.name?.trim();
  if (name) return truncate(name, DISPLAY_NAME_MAX);

  const email = user?.email?.trim();
  if (!email) return fallback;
  if (isWechatPlaceholderEmail(email)) return `微信用户 · ${wechatDisplayTag(email)}`;
  return truncate(email, 32);
}

/**
 * 身份名：**用于邀请链接的 `by=` 参数与邀请事件匹配**，不做省略。
 *
 * 和 displayName 分离的原因：displayName 会截断长昵称，两个前 16 字相同的人
 * 就会撞成同一个邀请人；而这里要的是"能唯一定位到某个人"的字符串。
 * 微信占位邮箱仍然换成短标签（否则 openid 会顺着邀请链接公开）。
 */
export function identityName(user: DisplayIdentity | null | undefined, fallback = "数字市民"): string {
  const name = user?.name?.trim();
  if (name) return name;

  const email = user?.email?.trim();
  if (!email) return fallback;
  if (isWechatPlaceholderEmail(email)) return `微信用户 · ${wechatDisplayTag(email)}`;
  return email;
}

/**
 * 邮箱的展示形态：占位邮箱不展示原始 openid，其余原样返回。
 * 返回 null 表示"没有邮箱可展示"，由调用方决定文案。
 */
export function displayEmail(email: string | null | undefined, wechatLabel = "微信账号"): string | null {
  const value = email?.trim();
  if (!value) return null;
  return isWechatPlaceholderEmail(value) ? wechatLabel : value;
}

/** 头像里的那个字：微信账号用「微」，其余取展示名首字。 */
export function avatarInitial(user: DisplayIdentity | null | undefined): string {
  if (isWechatPlaceholderEmail(user?.email)) return "微";
  const name = displayName(user, "");
  return Array.from(name)[0]?.toUpperCase() ?? "·";
}
