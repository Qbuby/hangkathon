/**
 * 作品提交：本机存储的抖音视频分享链接，按活动分组。
 * 校验只认抖音系域名；提交入口在活动接受「演示视频」时出现。
 */

export type SubmissionRecord = { url: string; submittedAt: string };

const SUBMISSIONS_KEY = "hangkathon.submissions.v1";

/**
 * 校验抖音视频分享链接。接受 http/https：
 * - v.douyin.com/<id>/ 分享短链（路径即分享 id）
 * - www.douyin.com/video/<digits> 长链
 * - iesdouyin.com/share/video/<digits> 分享站长链
 */
export function isValidDouyinUrl(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");
  if (host === "v.douyin.com") return path.length > 1;
  if (host === "www.douyin.com" || host === "douyin.com") return /^\/video\/\d+/.test(path);
  if (host === "iesdouyin.com") return /^\/share\/video\/\d+/.test(path);
  return false;
}

export function normalizeUrl(raw: string): string {
  const text = raw.trim();
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

export function loadSubmissions(): Record<string, SubmissionRecord[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SUBMISSIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const all: Record<string, SubmissionRecord[]> = {};
    for (const [activityId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const records = value
        .filter(
          (item): item is SubmissionRecord =>
            !!item &&
            typeof item === "object" &&
            typeof (item as SubmissionRecord).url === "string" &&
            typeof (item as SubmissionRecord).submittedAt === "string",
        )
        .slice(-20);
      if (records.length) all[activityId] = records;
    }
    return all;
  } catch {
    return {};
  }
}

export function loadActivitySubmissions(activityId: string): SubmissionRecord[] {
  return loadSubmissions()[activityId] ?? [];
}

export function addSubmission(activityId: string, url: string): SubmissionRecord[] {
  const record: SubmissionRecord = { url: normalizeUrl(url), submittedAt: new Date().toISOString() };
  const all = loadSubmissions();
  const list = [...(all[activityId] ?? []), record].slice(-20);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify({ ...all, [activityId]: list }));
  }
  return list;
}
