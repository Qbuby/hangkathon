import { NextResponse } from "next/server";
import { toActivity, validateAll, type Draft } from "@/lib/activity";
import { createActivity, listActivities, uniqueSlug } from "@/lib/server/activities";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { currentUser, requireUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 公开列表：服务端强制可见性过滤（unlisted 与待审核只对发起人可见）。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    return NextResponse.json({ activities: await listActivities(user?.id ?? null) });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 登录后创建活动，归属当前用户。 */
export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const values = (await request.json()) as Draft;
    const errors = validateAll(values);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: "表单校验未通过", errors }, { status: 400 });
    }
    const draft = toActivity(values);
    const activity = await createActivity(user.id, { ...draft, slug: await uniqueSlug(draft.slug) });
    return NextResponse.json({ activity }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError(400, "请求体不是合法 JSON");
    return handleRouteError(error);
  }
}
