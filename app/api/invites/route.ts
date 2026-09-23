import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { listInviteEvents, recordInviteEvent } from "@/lib/server/invites";
import { getActivityBySlug } from "@/lib/server/activities";
import { requireUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 与当前用户相关的邀请事件（他邀请的 + 他被邀请的）。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    return NextResponse.json({ events: await listInviteEvents(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 记录一次邀请：inviter 是当前登录用户，invitee 由被邀请人接受时带上。 */
export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => null)) as
      | { activityId?: string; factionId?: string; teamId?: string | null; inviterId?: string; inviteeId?: string }
      | null;
    if (!body?.activityId || !body.factionId) return jsonError(400, "缺少 activityId 或 factionId");

    const activity = await getActivityBySlug(body.activityId, user.id);
    const activityId = activity?.id ?? body.activityId;

    const inviterId = body.inviterId ?? user.id;
    const inviteeId = body.inviteeId ?? user.id;
    if (inviterId !== user.id && inviteeId !== user.id) {
      return jsonError(403, "只能记录与自己相关的邀请");
    }

    const event = await recordInviteEvent({
      activityId,
      factionId: body.factionId,
      teamId: body.teamId ?? null,
      inviterId,
      inviteeId,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
