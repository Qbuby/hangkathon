import { NextResponse } from "next/server";
import { AdminActionError, setSubmissionReview, type ReviewStatus } from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 管理员审核一条作品：pending / approved / rejected。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status as ReviewStatus | undefined;
    if (!status) return jsonError(400, "缺少 status");
    await setSubmissionReview(id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
