import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { AdminActionError, setSubmissionReview, type ReviewStatus } from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 管理员审核一条作品：pending / approved / rejected。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status as ReviewStatus | undefined;
    if (!status) return jsonError(400, "缺少 status");
    await setSubmissionReview(id, status);
    // 逐条审核留痕（检查表 9.3.2）：谁在何时审了哪条作品、结论是什么。
    await writeAudit(
      {
        category: "admin",
        action: "admin.submission.review",
        user: admin,
        targetType: "submission",
        targetId: id,
        detail: { status },
      },
      request,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
