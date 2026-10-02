import { NextResponse } from "next/server";
import { getActivityBySlugAdmin } from "@/lib/server/activities";
import { listActivitySubmissionsAdmin } from "@/lib/server/admin";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 某活动全部用户的提交（管理端视角，含作者与审核状态）。 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { slug } = await params;
    const activity = await getActivityBySlugAdmin(slug);
    if (!activity) return NextResponse.json({ error: "活动不存在" }, { status: 404 });
    return NextResponse.json({ submissions: await listActivitySubmissionsAdmin(activity.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}
