import { NextResponse } from "next/server";
import { isValidDouyinUrl, normalizeUrl } from "@/lib/submission";
import { screenSubmissionUrl, screenText } from "@/lib/security/filter";
import { writeAudit } from "@/lib/server/audit";
import { getActivityBySlug } from "@/lib/server/activities";
import { addToBlacklist } from "@/lib/server/blacklist";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { enforceRateLimit, RULES } from "@/lib/server/rate-limit";
import { addSubmission, listSubmissions } from "@/lib/server/submissions";
import { requireUser } from "@/lib/server/users";
import { captureMetrics } from "@/lib/server/work-metrics";

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
    await enforceRateLimit("write", `submission:${user.id}`, RULES.write);
    const { slug } = await params;
    const activity = await getActivityBySlug(slug, user.id);
    if (!activity) return jsonError(404, "活动不存在");

    const body = (await request.json().catch(() => null)) as { url?: string } | null;
    const url = body?.url ?? "";
    if (!isValidDouyinUrl(url)) {
      return jsonError(400, "请输入有效的抖音视频分享链接，如 https://v.douyin.com/xxxx 或 https://www.douyin.com/video/数字ID");
    }
    // URL 屏蔽过滤（检查表 9.3.3c）：只放行抖音站内地址，其余一律拦。
    const urlScreen = screenSubmissionUrl(normalizeUrl(url));
    if (urlScreen.blocked) {
      await writeAudit(
        {
          category: "security",
          action: "content.url_blocked",
          user,
          targetType: "submission",
          result: "denied",
          detail: { url, reason: urlScreen.reason },
        },
        request,
      );
      return jsonError(422, urlScreen.reason);
    }
    const normalized = normalizeUrl(url);
    const submission = await addSubmission(activity.id, user.id, normalized);
    // 作品文案一并过关键词过滤（抓回来的 caption 是用户发布内容，同样要审）。
    const captionScreen = screenText(submission.caption ?? "");
    if (captionScreen.blocked) {
      await writeAudit(
        {
          category: "security",
          action: "content.blocked",
          user,
          targetType: "submission",
          targetId: submission.url,
          result: "denied",
          detail: { hits: captionScreen.hits },
        },
        request,
      );
      await addToBlacklist({
        email: user.email,
        reason: `提交的作品文案命中违法有害信息词库（${captionScreen.hits[0]?.category}）`,
        source: "platform",
        createdBy: null,
      });
      return jsonError(422, captionScreen.message);
    }
    // 发布日志（检查表 8.4.2d）。
    await writeAudit(
      {
        category: "publish",
        action: "submission.create",
        user,
        targetType: "submission",
        targetId: submission.url,
        detail: { activity: activity.title, activityId: activity.id, url: normalized },
      },
      request,
    );
    // 入库之后再抓数据，所以抓取失败不影响这次提交的成功。
    const withMetrics = await captureMetrics(activity.id, user.id, submission.url);
    return NextResponse.json({ submission: withMetrics ?? submission }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
