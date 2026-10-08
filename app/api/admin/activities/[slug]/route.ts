import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { getActivityBySlugAdmin } from "@/lib/server/activities";
import { AdminActionError, deleteActivity, setActivityReview, setActivityVisibility } from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";
import type { ActivityReviewStatus, Visibility } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** 活动正文（管理端视角，pending/unlisted 也可读）：供 /manage 审核前查看内容。 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { slug } = await params;
    const activity = await getActivityBySlugAdmin(slug);
    if (!activity) return NextResponse.json({ error: "活动不存在" }, { status: 404 });
    return NextResponse.json({ activity });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 管理员改活动公开状态 / 审核通过 / 删除活动（预置活动拒绝删除）。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { slug } = await params;
    const body = (await request.json().catch(() => null)) as { visibility?: string; reviewStatus?: string } | null;
    if (body?.reviewStatus !== undefined) {
      await setActivityReview(slug, body.reviewStatus as ActivityReviewStatus);
      // 特殊权限使用记录（检查表 7.3c）：谁、何时、把哪场活动审成了什么状态。
      await writeAudit(
        {
          category: "admin",
          action: "admin.activity.review",
          user: admin,
          targetType: "activity",
          targetId: slug,
          detail: { reviewStatus: body.reviewStatus },
        },
        request,
      );
      return NextResponse.json({ ok: true });
    }
    const visibility = body?.visibility as Visibility | undefined;
    if (!visibility) return jsonError(400, "缺少 visibility 或 reviewStatus");
    await setActivityVisibility(slug, visibility);
    await writeAudit(
      {
        category: "admin",
        action: "admin.activity.visibility",
        user: admin,
        targetType: "activity",
        targetId: slug,
        detail: { visibility },
      },
      request,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { slug } = await params;
    await deleteActivity(slug);
    await writeAudit(
      {
        category: "admin",
        action: "admin.activity.delete",
        user: admin,
        targetType: "activity",
        targetId: slug,
        detail: { slug },
      },
      request,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
