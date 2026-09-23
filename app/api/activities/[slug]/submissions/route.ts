import { NextResponse } from "next/server";
import { isValidDouyinUrl, normalizeUrl } from "@/lib/submission";
import { getActivityBySlug } from "@/lib/server/activities";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { addSubmission, listSubmissions } from "@/lib/server/submissions";
import { requireUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 只返回本人的提交（沿用「只有自己看得到」的隐私语义）。 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { slug } = await params;
    const activity = await getActivityBySlug(slug, user.id);
    if (!activity) return jsonError(404, "活动不存在");
    return NextResponse.json({ submissions: await listSubmissions(activity.id, user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 提交作品链接：先校验是不是抖音分享链接，再入库。 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { slug } = await params;
    const activity = await getActivityBySlug(slug, user.id);
    if (!activity) return jsonError(404, "活动不存在");

    const body = (await request.json().catch(() => null)) as { url?: string } | null;
    const url = body?.url ?? "";
    if (!isValidDouyinUrl(url)) {
      return jsonError(400, "请输入有效的抖音视频分享链接，如 https://v.douyin.com/xxxx 或 https://www.douyin.com/video/数字ID");
    }
    const submission = await addSubmission(activity.id, user.id, normalizeUrl(url));
    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
