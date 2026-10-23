/**
 * 登录与会话。
 *
 * ── 小程序的登录为什么这么简单 ──────────────────────────────────────────
 * `wx.login()` 是**静默**的：不弹授权框、用户无感，每次调用给一个新的 code
 * （5 分钟有效、只能用一次）。后端拿它换 openid/unionid，再用 unionid
 * 认到网页端那一行 users —— 所以小程序里"登录"就是一次网络请求。
 *
 * 这也是为什么 401 可以**自动重试**：重新 wx.login() 不需要用户点任何东西。
 * 但只在明确 401 时重试，且只重试一次 —— 避免服务端故障时打成死循环。
 */

const { get, post, getToken, setToken, clearToken, ApiError } = require("./request");

const USER_KEY = "hk.user";

function getCachedUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null;
  } catch {
    return null;
  }
}

function cacheUser(user) {
  try {
    if (user) wx.setStorageSync(USER_KEY, user);
    else wx.removeStorageSync(USER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 调 wx.login 拿 code（Promise 化）。
 * 失败通常是小程序环境异常，正常用户几乎不会遇到。
 */
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code);
        else reject(new ApiError(0, "获取微信登录凭证失败"));
      },
      fail() {
        reject(new ApiError(0, "微信登录失败，请重试"));
      },
    });
  });
}

/**
 * 用当前微信身份登录，成功后 token 落到 storage。
 * 返回 { token, email, name, expiresAt }。
 */
async function login() {
  const code = await wxLogin();
  const data = await post(
    "/api/auth/wechat-mini",
    { code },
    // 登录接口本身不需要 token；失败文案由调用方给，避免和 wx.login 的提示打架
    { noAuth: true, silent: true },
  );
  if (!data || !data.token) throw new ApiError(0, "登录失败，请重试");
  setToken(data.token);
  cacheUser({ email: data.email, name: data.name });
  const app = getApp();
  if (app) {
    app.invalidateSession();
    app.globalData.user = null;
  }
  return data;
}

/**
 * 读服务端当前身份（不触发登录）。
 * 返回 { id, email, name, role } | null。
 */
async function fetchSession() {
  if (!getToken()) return null;
  try {
    const data = await get("/api/auth/wechat-mini/session", { silent: true });
    cacheUser(data.user || null);
    return data.user || null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearToken();
      cacheUser(null);
    }
    return null;
  }
}

/**
 * 确保已登录：有有效 token 就直接返回用户，否则静默登录一次。
 * `force` 为 true 时跳过缓存（401 重试用）。
 */
async function ensureLogin(force = false) {
  if (!force && getToken()) {
    const cached = getCachedUser();
    if (cached && cached.email) return cached;
    const user = await fetchSession();
    if (user) return user;
  }
  await login();
  return await fetchSession();
}

function logout() {
  clearToken();
  cacheUser(null);
  const app = getApp();
  if (app) {
    app.invalidateSession();
    app.globalData.user = null;
  }
}

module.exports = {
  login,
  logout,
  fetchSession,
  ensureLogin,
  getCachedUser,
};
