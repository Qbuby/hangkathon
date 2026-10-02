import { NextResponse } from "next/server";
import {
  AdminActionError,
  deleteExternalEventAdmin,
  listExternalEventsAdmin,
  setExternalEventHidden,
} from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 外部赛事管理：全量列表 / 隐藏显示 / 删除。隐藏只是不进公开列表，抓取不会重置。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return NextResponse.json({ events: await listExternalEventsAdmin() });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => null)) as { id?: string; hidden?: boolean } | null;
    if (!body?.id || typeof body.hidden !== "boolean") return jsonError(400, "缺少 id 或 hidden");
    await setExternalEventHidden(body.id, body.hidden);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) return jsonError(400, "缺少 id");
    await deleteExternalEventAdmin(body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
