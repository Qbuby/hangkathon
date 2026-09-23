import { NextResponse } from "next/server";
import { getActivityBySlug } from "@/lib/server/activities";
import { createJoin, getJoin } from "@/lib/server/joins";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { findUserByNameOrEmail } from "@/lib/server/invites";
import { currentUser, requireUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 报名（幂等）。带 invitedBy（邀请人的显示名）时记录邀请关系。 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { slug } = await params;
    const activity = await getActivityBySlug(slug, user.id);
    if (!activity) return jsonError(404, "活动不存在");

    let invitedBy: string | null = null;
    try {
      const body = (await request.json()) as { invitedBy?: string };
      if (body?.invitedBy) {
        const inviter = await findUserByNameOrEmail(body.invitedBy);
        if (inviter && inviter.id !== user.id) invitedBy = inviter.id;
      }
    } catch {
      /* 没有请求体也算合法：普通报名 */
    }

    const join = await createJoin(activity.id, user.id, invitedBy);
    return NextResponse.json({ joined: true, join }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 只读：当前用户在这场活动的报名状态。 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ joined: false });
    const { slug } = await params;
    const activity = await getActivityBySlug(slug, user.id);
    if (!activity) return jsonError(404, "活动不存在");
    const join = await getJoin(activity.id, user.id);
    return NextResponse.json({ joined: Boolean(join), join });
  } catch (error) {
    return handleRouteError(error);
  }
}
