/**
 * 结构化数据（JSON-LD）的**安全序列化**与站点级常量。
 *
 * 为什么这个文件非有不可（2026-10-13 用受控实验确认，不是推测）：
 *
 *   1. `JSON.stringify` **不转义 `<`**。活动标题来自用户（代理商可自由填写），一旦
 *      里面出现 `</script>`，浏览器会认为脚本块到此结束，后面的内容被当作**真实标记**解析。
 *      实测：`{"name":"</script><meta name="robots" content="noindex">…<script>…"}` 嵌进去后，
 *      页面里真的出现了那个 robots meta、一个隐藏 div、一条指向外站的垃圾链接。
 *      （脚本本身被 CSP 的 nonce 挡住 —— 所以在当前配置下不影响自己的站点安全，
 *        但 robots meta 与垃圾链接是静态标记、CSP 管不着。）
 *
 *   2. 同一个实验证明 **CSP 不会拦 `application/ld+json`**：带 nonce 与不带 nonce 的
 *      数据块都能被解析读取。所以给它补 nonce 是没必要的，而这正说明**转义是唯一的防线**。
 *
 * 正确做法是把 `U+003C` 以 `\u003c` 形式写出（JSON 里等价，HTML 解析器不再认为它是标签起始）。
 * 顺带也转义 `U+2028/U+2029`（JSON 合法但旧版 JS 里是行终止符）与 `&`。
 *
 * 测试：scripts/seo-jsonld.test.mjs
 */

/** 站点根地址（末尾无斜杠）。子页面与结构化数据一律用它拼绝对 URL —— schema.org 要求绝对地址。 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");

export const SITE_NAME = "杭客松";
export const SITE_NAME_EN = "Hangkathon";
export const SITE_LOGO = `${SITE_URL}/brand/icon-512.png`;

/** 稳定实体 ID：让 WebSite / Organization / 各页 WebPage 通过 @id 互指，形成实体图而不是散块。 */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** 运营主体。用于 Organization 的 legalName（"关于"页与备案信息一致）。 */
export const ORG_LEGAL_NAME = "杭州智共体人工智能科技有限公司";

/** 对外联系方式。与 /about 页展示的邮箱保持一致。 */
export const ORG_EMAIL = "taotaisheng@proton.me";

/**
 * 把对象序列化成可安全嵌入 `<script type="application/ld+json">` 的字符串。
 *
 * 三个转义各有理由：
 *   - `<` → `\u003c`：堵住上面说的标记注入。这是**唯一**防止数据突破脚本块的手段。
 *   - `\u2028` / `\u2029` → 转义：JSON 允许，但 JavaScript 里它们是行终止符，
 *     在 <script> 里会引发难以定位的语法错误。
 *   - `&` → `\u0026`：防止产物经过任何 HTML 实体解码环节时被二次解释。
 */
export function toJsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** 把相对路径补成绝对 URL（schema.org 的 image/url 要求绝对地址）。已绝对的原样返回。 */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/**
 * 日期规范化：schema.org 的 startDate/endDate 要 ISO 8601。
 * 数据源里有 `2026-10-01` 这种纯日期，保持原样（合法）；带时间的转成 ISO 串。
 * 空值返回 undefined —— 让调用方在组装对象时直接丢掉该属性，而不是留下 null。
 */
export function isoDate(value: string | null | undefined): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** 去掉对象里值为 undefined / null / 空数组的键 —— 结构化数据里留空属性是常见告警来源。 */
export function compact<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
}
