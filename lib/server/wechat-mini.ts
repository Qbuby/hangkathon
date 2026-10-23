/**
 * 微信小程序（原生 wx.login）服务端对接。
 *
 * ── 它解决什么问题 ──────────────────────────────────────────────────────
 * 网页端的登录是「网站应用扫码」或「公众号 6 位验证码」。小程序里两者都用不了：
 * 小程序没有浏览器 cookie 语义、也不能让用户去扫自己屏幕上的码。
 * 但小程序有 `wx.login()` —— 一次静默调用就能拿到一个 code，后端拿它换 openid。
 *
 * ── 为什么 openid 不能直接当身份 ────────────────────────────────────────
 * 同一个人在同一开放平台账号下的**三个应用**里有**三个不同的 openid**：
 *   网站应用（扫码）  → owu1v2…
 *   公众号（验证码）  → oe8Tr3…
 *   小程序（wx.login）→ 又是另一个
 * 只有 **unionid 相同**。所以这里返回的 openId 只用于给"从未登录过的人"造占位邮箱，
 * 真正的跨端认人永远走 unionid（见 wechat-identity.ts）。
 *
 * ── 为什么不用 jscode2session 的 session_key ──────────────────────────────
 * session_key 只在解密 `encryptedData`（手机号、用户信息）时才需要。
 * 本期不取手机号，所以**拿到也立刻丢掉**：多存一份密钥就多一份泄露面。
 */

const SNS_API = "https://api.weixin.qq.com/sns";

export type MiniProgramIdentity = {
  openId: string;
  /** 小程序绑定了开放平台才会返回；没有它就无法和网页账号打通。 */
  unionId: string | null;
};

/**
 * 用 `wx.login()` 拿到的 code 换 openid（可能还有 unionid）。
 *
 * 注意 code 的约束（微信文档原文）：**5 分钟内有效，且只能使用一次**。
 * 所以调用方不能重试同一个 code —— 失败就让小程序重新 `wx.login()`。
 *
 * 返回 null 表示「微信说这个 code 不认」（过期/已用/appid 不对），
 * 由调用方回 401 让小程序重新登录；抛错只在配置缺失时发生。
 */
export async function exchangeMiniProgramCode(
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MiniProgramIdentity | null> {
  const appId = env.WECHAT_MINI_ID?.trim();
  const secret = env.WECHAT_MINI_SECRET?.trim();
  if (!appId || !secret) throw new Error("缺少 WECHAT_MINI_ID / WECHAT_MINI_SECRET");
  if (!code.trim()) return null;

  const url =
    `${SNS_API}/jscode2session?appid=${encodeURIComponent(appId)}` +
    `&secret=${encodeURIComponent(secret)}` +
    `&js_code=${encodeURIComponent(code.trim())}` +
    `&grant_type=authorization_code`;

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  const data = (await res.json()) as {
    openid?: string;
    unionid?: string;
    session_key?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!data.openid) {
    // 常见 errcode：40029 code 无效/已用、40163 code 已被使用、40013 appid 错误、
    // 45011 频率限制。全部按"这次登录失败"处理，让小程序重新 wx.login()。
    console.error(`[wechat-mini] jscode2session 失败 errcode=${data.errcode} errmsg=${data.errmsg}`);
    return null;
  }

  // session_key 故意不返回、不落库：本期不需要解密任何东西。
  return { openId: data.openid, unionId: data.unionid?.trim() || null };
}
