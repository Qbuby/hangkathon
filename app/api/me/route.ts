import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { listJoinsForUser } from "@/lib/server/joins";
import { countSubmissionsForUser } from "@/lib/server/submissions";
import { currentUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 个人主页用：当前用户 + 我的报名 + 我的提交条数。未登录返回空。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return NextResponse.json({ user: null, joins: [], submissionCount: 0 });
    const [joins, submissionCount] = await Promise.all([
      listJoinsForUser(user.id),
      countSubmissionsForUser(user.id),
    ]);
    return NextResponse.json({ user, joins, submissionCount });
  } catch (error) {
    return handleRouteError(error);
  }
}
