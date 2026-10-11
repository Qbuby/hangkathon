import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { AdminActionError } from "@/lib/server/admin";
import { reviewAgentApplication } from "@/lib/server/agents";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 审核一张代理商申请：通过 = 授予代理商角色；驳回 = 留理由，用户可改后重提。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      decision?: string;
      note?: string;
    } | null;
    const decision = body?.decision;
    if (decision !== "approved" && decision !== "rejected") {
      return jsonError(400, "decision 只能是 approved 或 rejected");
    }
    const note = body?.note?.trim() || null;
    await reviewAgentApplication(admin, id, decision, note);
    // 角色授予/驳回都是管理动作，必须留痕（检查表 7.2 / 7.3c）
    await writeAudit(
      {
        category: "admin",
        action: "admin.agent.review",
        user: admin,
        targetType: "agent_application",
        targetId: id,
        detail: { decision, note },
      },
      request,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}