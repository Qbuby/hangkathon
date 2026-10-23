/**
 * 统一请求封装。
 *
 * ── 唯一必须做对的事：Bearer ────────────────────────────────────────────
 * `wx.request` 不像浏览器那样自动保存并回放 cookie。服务端虽然有 cookie 会话，
 * 但小程序拿不到可靠的 cookie jar，所以**每次请求都显式带 Authorization**。
 * 服务端在 `lib/server/users.ts` 的 currentUser() 里有 Bearer 兜底。
 *
 * ── 错误处理约定 ────────────────────────────────────────────────────────
 * 服务端所有错误都是 `{ error: string }`（唯一例外是发起活动的 400 会多带
 * `errors: { 字段: 提示 }`）。429 还带 `retry-after` 秒数。
 * 这里把三者统一成 ApiError，页面只处理 `error.status` 与 `error.message`。
 */

/** 服务端地址。改域名只改这一行。 */
const BASE_URL = "https://hangkathon.com";

const TOKEN_KEY = "hk.token";

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setToken(token) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
  } catch {
    /* 存储满了也不该让登录失败 */
  }
}

function clearToken() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.extra = extra || {};
  }
}

/**
 * 发一次请求。
 *
 * options:
 *   method    默认 GET
 *   data      请求体（对象）
 *   noAuth    不附加 token（登录接口用）
 *   silent    失败时不弹 toast（调用方自己处理文案）
 *   timeout   默认 12s（抖音抓取那类接口要更久，调用方可传 30s）
 */
function request(path, options = {}) {
  const token = getToken();
  const header = { "content-type": "application/json" };
  if (token && !options.noAuth) header.Authorization = "Bearer " + token;

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method: options.method || "GET",
      data: options.data,
      header,
      timeout: options.timeout || 12000,
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }

        // 401：token 失效。清掉本地 token，让调用方决定是否静默重登。
        if (res.statusCode === 401) clearToken();

        const message = body.error || "请求失败（" + res.statusCode + "）";
        const extra = { errors: body.errors || null };
        // 429：把 retry-after 一起带出来，页面可以显示"请 X 秒后再试"
        if (res.statusCode === 429) {
          extra.retryAfter = Number(res.header["Retry-After"] || res.header["retry-after"] || 60);
        }
        if (!options.silent) {
          wx.showToast({ title: message, icon: "none" });
        }
        reject(new ApiError(res.statusCode, message, extra));
      },
      fail(err) {
        /**
         * 这里最容易被误判成"网络不好"，实际常见原因有三个，必须能区分：
         *   1. 开发者工具没关「校验合法域名」，而域名还没加进小程序后台白名单
         *      → errMsg 通常是 "request:fail url not in domain list"
         *   2. 手机没网 / 服务器不可达 → "request:fail timeout" 或 "fail"
         *   3. 证书问题 → "request:fail ssl handshake failed"
         * 只显示"网络异常"的话，排查要多花很久，所以把 errMsg 带进 message。
         */
        const detail = String((err && err.errMsg) || "").replace(/^request:fail\s*/, "");
        let message = "网络异常，请检查连接后重试";
        if (/domain list/i.test(detail)) {
          message = "域名未加入小程序白名单：请在小程序后台配置 request 合法域名，或在开发者工具中关闭域名校验";
        } else if (/ssl|handshake|certificate/i.test(detail)) {
          message = "证书校验失败，请确认使用 https 且证书有效";
        } else if (/timeout/i.test(detail)) {
          message = "请求超时，请检查网络后重试";
        }
        if (!options.silent) wx.showToast({ title: message, icon: "none" });
        console.error("[request] 失败", BASE_URL + path, detail);
        reject(new ApiError(0, message, { raw: err, detail }));
      },
    });
  });
}

/** GET / POST 两个便捷方法（POST 会显式带上请求体）。 */
function get(path, options = {}) {
  return request(path, { ...options, method: "GET" });
}

function post(path, data, options = {}) {
  return request(path, { ...options, method: "POST", data });
}

module.exports = {
  BASE_URL,
  TOKEN_KEY,
  ApiError,
  getToken,
  setToken,
  clearToken,
  request,
  get,
  post,
};
