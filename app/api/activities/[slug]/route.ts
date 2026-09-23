import { NextResponse } from "next/server";
import { getActivityBySlug } from "@/lib/server/activities";
import { countJoins, getJoin } from "@/lib/server/joins";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { currentUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 公开详情：unlisted 活动只有发起人能取到；登录时附带「我是否已报名」。 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const { slug } = await params;
    const user = await currentUser();
    const activity = await getActivityBySlug(slug, user?.id ?? null);
    if (!activity) return NextResponse.json({ error: "活动不存在" }, { status: 404 });
    const join = user ? await getJoin(activity.id, user.id) : null;
    return NextResponse.json({
      activity,
      joined: Boolean(join),
      joinedAt: join?.joinedAt ?? null,
      joinCount: await countJoins(activity.id),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
