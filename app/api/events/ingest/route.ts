import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import {
  cleanupExternalEvents,
  detailNeededRows,
  translateMissingTranslations,
  upsertExternalEvents,
} from "@/lib/server/external-events";

export const dynamic = "force-dynamic";

/**
 * 宿主机每日抓取脚本（deploy/events-fetch.sh）的入库口。
 * 不对浏览器开放语义：靠 .env 里的 EVENTS_INGEST_TOKEN 做持有者鉴权，没有这个令牌的部署一律拒绝。
 */
export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const token = process.env.EVENTS_INGEST_TOKEN;
    if (!token) return jsonError(503, "没有配置 EVENTS_INGEST_TOKEN，抓取入库未启用");

    const provided = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${token}`;
    const same = provided.length === expected.length
      && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!same) return jsonError(401, "令牌不对");

    const body = (await request.json().catch(() => null)) as { events?: unknown[] } | null;
    if (!body || !Array.isArray(body.events)) return jsonError(400, "缺少 events 数组");
    if (body.events.length > 5000) return jsonError(413, "events 超出单轮上限");

    const { received, stored } = await upsertExternalEvents(body.events);
    const removed = await cleanupExternalEvents();
    // 机翻缺失的行异步补齐：不阻塞抓取脚本的响应，失败由明天的入库重试
    void translateMissingTranslations().catch(() => {});
    // 还没做过详情 enrichment 的赛事清单，交给抓取脚本补抓正文与海报
    const needDetail = await detailNeededRows(30);
    return NextResponse.json({ ok: true, received, stored, removed, needDetail });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 冒烟检查：确认这个部署的抓取入库是否启用。 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.EVENTS_INGEST_TOKEN),
    database: !databaseRequired(),
  });
}
