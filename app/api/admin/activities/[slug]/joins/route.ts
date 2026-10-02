import { NextResponse } from "next/server";
import { getActivityBySlugAdmin } from "@/lib/server/activities";
import { AdminActionError, listActivityJoinsAdmin, removeJoinAdmin } from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 某活动的报名列表 / 移除一条报名。 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { slug } = await params;
    const activity = await getActivityBySlugAdmin(slug);
    if (!activity) return NextResponse.json({ error: "活动不存在" }, { status: 404 });
    return NextResponse.json({ joins: await listActivityJoinsAdmin(activity.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { slug } = await params;
    const activity = await getActivityBySlugAdmin(slug);
    if (!activity) return jsonError(404, "活动不存在");
    const body = (await request.json().catch(() => null)) as { userId?: string } | null;
    if (!body?.userId) return jsonError(400, "缺少 userId");
    await removeJoinAdmin(activity.id, body.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
