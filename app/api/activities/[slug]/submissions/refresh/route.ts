import { NextResponse } from "next/server";
import { getActivityBySlug } from "@/lib/server/activities";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { listSubmissions } from "@/lib/server/submissions";
import { requireUser } from "@/lib/server/users";
import { captureMetrics } from "@/lib/server/work-metrics";

export const dynamic = "force-dynamic";

/** 手动刷新一条提交的作品数据。刻意不做自动轮询：省调用，也少一个被风控的理由。 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { slug } = await params;
    const activity = await getActivityBySlug(slug, user.id);
    if (!activity) return jsonError(404, "活动不存在");

    const body = (await request.json().catch(() => null)) as { url?: string } | null;
    const url = (body?.url ?? "").trim();
    if (!url) return jsonError(400, "缺少作品链接");

    // 只允许刷新自己的、已经提交过的链接。否则这个接口就是一个「拿我们的服务器
    // 去抓任意抖音链接」的代理，等于把抓取能力和它的风险一起对外开放。
    const mine = await listSubmissions(activity.id, user.id);
    if (!mine.some((item) => item.url === url)) return jsonError(404, "没有找到这条作品提交");

    await captureMetrics(activity.id, user.id, url);
    return NextResponse.json({ submissions: await listSubmissions(activity.id, user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}
