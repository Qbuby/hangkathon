import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { getExternalEventById } from "@/lib/server/external-events";

export const dynamic = "force-dynamic";

/** 单条全球赛事（详情页用）。没有数据库的部署返回 503。 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const { id } = await params;
    const event = await getExternalEventById(id);
    if (!event) return jsonError(404, "没有找到这条赛事");
    return NextResponse.json({ event });
  } catch (error) {
    return handleRouteError(error);
  }
}
