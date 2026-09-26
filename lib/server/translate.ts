/**
 * 全球赛事的中文翻译：接 MyMemory 匿名接口（免费、免注册、每日 5000 字符，
 * 我们每天只有十几条赛事的量）。已有中文或翻译失败时返回 null，界面回落
 * 到来源平台原文——失败是可自愈的（第二天入库时会重试缺失的行）。
 */

const MYMEMORY = "https://api.mymemory.translated.net/get";

export function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return text.length > 0 && cjk / text.length > 0.35;
}

export async function translateToChinese(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || isMostlyChinese(trimmed)) return null;
  try {
    const url = `${MYMEMORY}?q=${encodeURIComponent(trimmed)}&langpair=en|zh-CN`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
      quotaFinished?: boolean;
    };
    const translated = payload.responseData?.translatedText?.trim();
    if (!translated) return null;
    if (payload.responseStatus !== 200 || payload.quotaFinished) return null;
    if (translated.includes("MYMEMORY WARNING")) return null; // 额度用尽的提示文本
    if (translated.toUpperCase() === trimmed.toUpperCase()) return null; // 没翻出东西
    return translated;
  } catch {
    return null;
  }
}
