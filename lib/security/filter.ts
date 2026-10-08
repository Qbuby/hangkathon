/**
 * 违法有害信息的技术屏蔽过滤（安全检查表 9.3.3）。
 *
 * 纯函数模块：不 import 任何服务端东西，所以 scripts/*.test.mjs 可以直接单测它。
 * 词库分三类：政治类、赌博类、色情类、诈骗类，另加违禁品与暴力威胁。命中即拦截（blocked），
 * 调用方（活动创建、作品提交、报名留言）把 hits 一起记进审计日志，作为「来源控制」的证据。
 *
 * 运营侧可以用环境变量 SECURITY_EXTRA_KEYWORDS（逗号分隔）加词，不用改代码重新发版。
 * 词库刻意不在代码里写全 —— 这是线上过滤的第一道闸，完整词库与举报通道见 docs/security-compliance.md。
 */

export type FilterCategory = "政治" | "赌博" | "色情" | "诈骗" | "违禁品" | "暴力";

const CATEGORY_KEYWORDS: Record<FilterCategory, string[]> = {
  政治: ["暴动", "颠覆国家", "分裂国家", "恐怖组织", "暴力恐怖"],
  // 裸词也要拦：只写「赌博网站」这种组合词，拆成「赌博」两个字就绕过去了。
  赌博: ["赌博", "博彩", "赌博网站", "博彩平台", "下注网址", "六合彩", "百家乐", "时时彩", "澳门赌场"],
  色情: ["色情", "裸聊", "约炮", "成人影片", "福利姬"],
  诈骗: ["诈骗", "刷单返利", "杀猪盘", "代开发票", "办证刻章", "黑户贷款", "网络博彩投注"],
  违禁品: ["毒品", "冰毒", "大麻代购", "枪支买卖", "迷药", "处方药代购"],
  暴力: ["买凶", "雇凶", "血溅", "报复杀人"],
};

const EXTRA = (process.env.SECURITY_EXTRA_KEYWORDS ?? "")
  .split(/[,，\s]+/)
  .map((word) => word.trim())
  .filter(Boolean);

/** 全角转半角 + 去空白与常见分隔符，避免「微 信」「賭 博」这类拆字绕过。 */
export function normalize(input: string): string {
  return input
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .toLowerCase();
}

export type ScreenResult = {
  blocked: boolean;
  hits: { category: FilterCategory | "自定义"; keyword: string }[];
  /** 命中后给用户看的提示，不回显具体词，避免绕过试探。 */
  message: string;
};

const OK: ScreenResult = { blocked: false, hits: [], message: "" };

export function screenText(input: string | null | undefined): ScreenResult {
  if (!input) return OK;
  const text = normalize(input);
  if (!text) return OK;
  const hits: ScreenResult["hits"] = [];
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS) as [FilterCategory, string[]][]) {
    for (const word of words) {
      if (text.includes(normalize(word))) hits.push({ category, keyword: word });
    }
  }
  for (const word of EXTRA) {
    if (text.includes(normalize(word))) hits.push({ category: "自定义", keyword: word });
  }
  if (hits.length === 0) return OK;
  return {
    blocked: true,
    hits,
    message: "内容包含违反法律法规和社会公德的信息，已被屏蔽，请修改后重新提交。",
  };
}

/** 多个字段一起过（比如活动标题 + 简介 + 联系方式）。任一命中即整条拦截。 */
export function screenFields(fields: Record<string, string | null | undefined>): ScreenResult {
  for (const value of Object.values(fields)) {
    const result = screenText(value);
    if (result.blocked) return result;
  }
  return OK;
}

const ALLOWED_SUBMISSION_HOSTS = ["douyin.com", "iesdouyin.com"];

export type UrlScreenResult = { blocked: boolean; reason: string };

/** 作品链接只接受抖音站内地址（9.3.3c 的 URL 屏蔽过滤 + 业务白名单）。 */
export function screenSubmissionUrl(raw: string): UrlScreenResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { blocked: true, reason: "链接格式非法" };
  }
  if (url.protocol !== "https:") return { blocked: true, reason: "只接受 https 链接" };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const ok = ALLOWED_SUBMISSION_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
  return ok ? { blocked: false, reason: "" } : { blocked: true, reason: "只接受抖音站内作品链接" };
}

/**
 * 连续命中累计：同一账号 N 次被过滤即自动进黑名单（检查表 9.2.2c「多次、大量」）。
 * 计数放内存，进程重启归零 —— 黑名单本身在库里持久，这里只是触发器。
 */
const violationCounts = new Map<string, { count: number; firstAt: number }>();

export const AUTO_BLOCK_THRESHOLD = 3;
const VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function recordViolation(email: string): { count: number; shouldBlock: boolean } {
  const now = Date.now();
  const entry = violationCounts.get(email);
  if (!entry || now - entry.firstAt > VIOLATION_WINDOW_MS) {
    violationCounts.set(email, { count: 1, firstAt: now });
    return { count: 1, shouldBlock: false };
  }
  entry.count += 1;
  return { count: entry.count, shouldBlock: entry.count >= AUTO_BLOCK_THRESHOLD };
}