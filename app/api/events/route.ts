import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { listExternalEvents } from "@/lib/server/external-events";

export const dynamic = "force-dynamic";

/** 公开读接口：窗口内的全球赛事列表。没配数据库的部署返回 503，前端降级为整块不渲染。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    return NextResponse.json({ events: await listExternalEvents() });
  } catch (error) {
    return handleRouteError(error);
  }
}
