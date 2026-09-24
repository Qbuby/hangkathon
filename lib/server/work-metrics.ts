import { fetchWorkMetrics } from "./douyin";
import { setMetricsForUrl, type ServerSubmission } from "./submissions";

/**
 * 抓一次作品数据并写回这条提交。
 *
 * **永不抛异常**：作品在调用之前就已经入库了，抓取只是增值。抓不到（上游 403、
 * 作品被删、这个部署没装 python）或者写不进去（数据库抖了一下），都只该让这条
 * 记录少几个字段，不该让一次成功的提交变成 500。
 *
 * 返回更新后的记录；写不进去时返回 undefined，调用方按原样返回即可。
 */
export async function captureMetrics(
  activityId: string,
  userId: string,
  url: string,
): Promise<ServerSubmission | undefined> {
  try {
    const result = await fetchWorkMetrics(url);
    const list = await setMetricsForUrl(activityId, userId, url, result);
    return list.find((item) => item.url === url);
  } catch {
    return undefined;
  }
}
