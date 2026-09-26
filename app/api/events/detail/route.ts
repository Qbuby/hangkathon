import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { translateMissingTranslations, updateEventDetails } from "@/lib/server/external-events";

export const dynamic = "force-dynamic";

/**
 * 详情 enrichment 入库口：抓取脚本访问来源详情页后，把海报与正文回传到这里。
 * 与 /api/events/ingest 同一套持有者令牌。
 */
export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const token = process.env.EVENTS_INGEST_TOKEN;
    if (!token) return jsonError(503, "没有配置 EVENTS_INGEST_TOKEN，抓取入库未启用");
    const provided = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${token}`;
    if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return jsonError(401, "令牌不对");
    }
    const body = (await request.json().catch(() => null)) as {
      details?: { source?: string; sourceId?: string; imageUrl?: string; detailText?: string }[];
    } | null;
    if (!body || !Array.isArray(body.details)) return jsonError(400, "缺少 details 数组");
    if (body.details.length > 60) return jsonError(413, "details 超出单轮上限");
    const cleaned = body.details
      .filter((item) => item && typeof item.source === "string" && typeof item.sourceId === "string")
      .map((item) => ({
        source: item.source as string,
        sourceId: item.sourceId as string,
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl.slice(0, 1000) : undefined,
        detailText: typeof item.detailText === "string" ? item.detailText.slice(0, 6000) : undefined,
      }));
    const updated = await updateEventDetails(cleaned);
    // 新正文到了：异步补中文摘要
    void translateMissingTranslations().catch(() => {});
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    return handleRouteError(error);
  }
}
