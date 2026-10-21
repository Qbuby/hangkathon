/**
 * 品牌名的唯一出处。
 *
 * 2026-10-21 用户定的**全局严格约束**：杭客松的英文名只能是 **Hangkathon**。
 * 之前「关于」页的小标题用了另一套罗马化拼法（与拼音首字母式的地名写法混用），
 * 与 logo 字样、域名、结构化数据全对不上。
 *
 * 为什么要有这个文件而不是各处写字符串：
 *   · 品牌名出现在页面文案、顶栏 alt、JSON-LD、llms.txt、测试断言等多处，
 *     每处各写一份就一定会漂移（这次漂移的代价是用户直接看到错的名字）；
 *   · `scripts/brand.test.mjs` 会扫描整个仓库，任何另一种拼法都会让 CI 变红，
 *     新增页面时也不可能再写错。
 *
 * 大小写约定：
 *   · 正文/alt/结构化数据 → `Hangkathon`（与 logo 字样一致，也是英文专名惯例）
 *   · 全大写小标题（eyebrow）→ `HANGKATHON`，与 `HONOR` / `SIGN IN` 等风格统一
 */
export const BRAND = {
  zh: "杭客松",
  /** 正文、alt、JSON-LD 用 */
  en: "Hangkathon",
  /** 全大写小标题用（eyebrow 样式本身就是大写字母间距） */
  upper: "HANGKATHON",
  /** 域名（不带协议） */
  domain: "hangkathon.com",
} as const;
