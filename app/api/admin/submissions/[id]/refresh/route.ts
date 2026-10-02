import { NextResponse } from "next/server";
import { AdminActionError, refreshSubmissionAdmin } from "@/lib/server/admin";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 管理员重抓一条作品的抖音指标。抓取失败返回 200 + submission（metricsError 里有原因）。 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { id } = await params;
    const submission = await refreshSubmissionAdmin(id);
    return NextResponse.json({ submission });
  } catch (error) {
    if (error instanceof AdminActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error);
  }
}
