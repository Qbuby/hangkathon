import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { AdminActionError } from "@/lib/server/admin";
import { submitAgentApplication } from "@/lib/server/agents";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { enforceRateLimit, RULES } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 我的代理商申请状态。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { getMyAgentApplication } = await import("@/lib/server/agents");
    return NextResponse.json({ application: await getMyAgentApplication(user.id) });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 提交（或重新提交）代理商申请：身份声明 + 联系方式，进入管理端审核。 */
export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    await enforceRateLimit("write", `agent-apply:${user.id}`, RULES.write);
    const body = (await request.json().catch(() => null)) as {
      contactName?: string;
      organization?: string;
      phone?: string;
      email?: string;
      statement?: string;
    } | null;

    const contactName = body?.contactName?.trim() ?? "";
    const phone = body?.phone?.trim() ?? "";
    const statement = body?.statement?.trim() ?? "";
    if (!contactName) return jsonError(400, "请填写联系人姓名");
    if (!/^[\d\s+\-()]{5,20}$/.test(phone)) return jsonError(400, "请填写有效的联系电话");
    if (statement.length < 10) return jsonError(400, "身份声明至少 10 个字，请说明你是谁、计划发什么活动");
    if (statement.length > 2000) return jsonError(400, "身份声明过长（上限 2000 字）");
    const email = (body?.email ?? user.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, "邮箱格式不正确");

    const application = await submitAgentApplication(user, {
      contactName,
      organization: body?.organization?.trim() ?? "",
      phone,
      email,
      statement,
    });
    await writeAudit(
      {
        category: "behavior",
        action: "agent.apply",
        user,
        targetType: "agent_application",
        targetId: application.id,
        detail: { contactName, organization: application.organization, phone },
      },
      request,
    );
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
