/**
 * 展示层格式化。口径必须与网页端一致，否则同一个人在两个端看到的名字不一样。
 *
 * 网页端的规则在 lib/display-name.ts：
 *   · 有昵称 → 昵称（超 16 字截断）
 *   · 微信占位邮箱 → 「微信用户 · XXXXXX」（openid 的 FNV-1a 散列前 6 位）
 *   · 普通邮箱 → 原样
 * 这里**必须逐字复刻**散列算法：服务端已经把展示名算好放在 name 字段里了，
 * 但 /api/me 之类接口返回的是原始 email，某些地方仍需要在本地兜底计算。
 */

const WECHAT_EMAIL_SUFFIX = "@wechat.user";
const DISPLAY_NAME_MAX = 16;

function isWechatPlaceholderEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(WECHAT_EMAIL_SUFFIX);
}

/** FNV-1a 32 位，取前 6 位十六进制。与 lib/display-name.ts 完全一致。 */
function wechatDisplayTag(email) {
  const source = email.slice(0, -WECHAT_EMAIL_SUFFIX.length);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
}

/** 按字符截断（不是码元），避免把 emoji 劈成半个。 */
function truncate(value, max) {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("") + "…";
}

function displayName(user, fallback) {
  const fb = fallback === undefined ? "数字市民" : fallback;
  const name = user && user.name ? String(user.name).trim() : "";
  if (name) return truncate(name, DISPLAY_NAME_MAX);

  const email = user && user.email ? String(user.email).trim() : "";
  if (!email) return fb;
  if (isWechatPlaceholderEmail(email)) return "微信用户 · " + wechatDisplayTag(email);
  return truncate(email, 32);
}

function displayEmail(email) {
  const value = email ? String(email).trim() : "";
  if (!value) return null;
  return isWechatPlaceholderEmail(value) ? "微信账号" : value;
}

/** 头像首字：微信账号固定「微」。 */
function avatarInitial(user) {
  if (isWechatPlaceholderEmail(user && user.email)) return "微";
  const name = displayName(user, "");
  return name ? Array.from(name)[0].toUpperCase() : "·";
}

/** 活动日期（库里是纯文本 YYYY-MM-DD）。 */
function formatDate(value) {
  if (!value) return "待定";
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : String(value);
}

function formatDateRange(start, end) {
  if (!start && !end) return "待定";
  if (start && end) return formatDate(start) + " 至 " + formatDate(end);
  return formatDate(start || end);
}

/** 相对时间：报名时间、提交时间等用。 */
function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return mins + " 分钟前";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + " 小时前";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + " 天前";
  return new Date(iso).toLocaleDateString("zh-CN");
}

/** 数字千分位（贡献值、奖金）。 */
function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-CN");
}

/** 抖音互动数据用「万」更好读。 */
function formatCount(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万" : String(n);
}

/** 勋章档位：与服务端 HONOR_LEVELS 同源，这里只做计算。 */
function honorLevel(points, levels) {
  const list = levels && levels.length ? levels : [{ stars: 1, min: 0, title: "初来数字市民" }];
  let index = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (points >= list[i].min) index = i;
  }
  const level = list[index];
  const next = list[index + 1] || null;
  const progress = next
    ? Math.min(100, Math.max(0, ((points - level.min) / (next.min - level.min)) * 100))
    : 100;
  return { stars: level.stars, min: level.min, title: level.title, next: next, progress: progress };
}

module.exports = {
  isWechatPlaceholderEmail,
  wechatDisplayTag,
  displayName,
  displayEmail,
  avatarInitial,
  formatDate,
  formatDateRange,
  timeAgo,
  formatNumber,
  formatCount,
  honorLevel,
};
