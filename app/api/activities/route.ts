import { NextResponse } from "next/server";
import { toActivity, validateAll, type Draft } from "@/lib/activity";
import { screenFields, recordViolation } from "@/lib/security/filter";
import { addToBlacklist } from "@/lib/server/blacklist";
import { writeAudit } from "@/lib/server/audit";
import { createActivity, listActivities, uniqueSlug } from "@/lib/server/activities";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { clientIp, enforceRateLimit, RULES } from "@/lib/server/rate-limit";
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
    await enforceRateLimit("write", `activity:${user.id}`, RULES.write);
    const values = (await request.json()) as Draft;
    const errors = validateAll(values);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ error: "表单校验未通过", errors }, { status: 400 });
    }
    // 违法有害信息屏蔽过滤（检查表 9.3.3）：标题/简介/主办方/联系方式逐字段过一遍。
    const screened = screenFields({
      title: String(values.title ?? ""),
      overview: String(values.overview ?? ""),
      host: String(values.host ?? ""),
      contact: String(values.contact ?? ""),
      venue: String(values.venue ?? ""),
    });
    if (screened.blocked) {
      const violation = recordViolation(user.email);
      await writeAudit(
        {
          category: "security",
          action: "content.blocked",
          user,
          targetType: "activity",
          result: "denied",
          detail: { hits: screened.hits, violations: violation.count, ip: clientIp(request) },
        },
        request,
      );
      if (violation.shouldBlock) {
        await addToBlacklist({
          email: user.email,
          reason: `24 小时内 ${violation.count} 次发布违法有害信息`,
          source: "platform",
          hits: violation.count,
          createdBy: null,
        });
        await writeAudit(
          {
            category: "security",
            action: "blacklist.auto",
            user,
            targetType: "user",
            targetId: user.email,
            detail: { reason: "连续命中内容过滤", violations: violation.count },
          },
          request,
        );
      }
      return jsonError(422, screened.message);
    }
    const draft = toActivity(values);
    const activity = await createActivity(user.id, { ...draft, slug: await uniqueSlug(draft.slug) });
    // 发布日志（检查表 8.4.2d）：谁、何时、从哪个 IP、发了什么。
    await writeAudit(
      {
        category: "publish",
        action: "activity.create",
        user,
        targetType: "activity",
        targetId: activity.id,
        detail: {
          title: activity.title,
          summary: activity.subtitle,
          host: activity.host,
          contact: activity.contact,
          reviewStatus: "pending",
        },
      },
      request,
    );
    return NextResponse.json({ activity }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError(400, "请求体不是合法 JSON");
    return handleRouteError(error);
  }
}
