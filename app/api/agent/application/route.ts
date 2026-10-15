import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { AdminActionError } from "@/lib/server/admin";
import { submitAgentApplication } from "@/lib/server/agents";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { enforceRateLimit, RULES } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/users";
import { notifyAgentApplication } from "@/lib/server/feishu-webhook";

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

    const { application, previousStatus } = await submitAgentApplication(user, {
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

    /**
     * 飞书群通知是**旁路**：申请已经写库、已经记审计，这里之后无论成功失败都照常返回 201。
     * 所以刻意不 await —— 慢或者挂都不该让申请人多等几秒（notifyAgentApplication 自身
     * 永不抛异常，内部 5 秒超时）。
     *
     * 「上一份还是待审核」就不通知：那次提交没有带来新信息，只是刷新了时间戳，
     * 而用户可以在 60 秒内点 5 次（write 限流），不去重就是往通知群里刷 5 条一模一样的。
     * 首次提交与被驳回后的重交都会通知 —— 那两种是真有新内容要人看。
     */
    if (previousStatus !== "pending") {
      void notifyAgentApplication({
        id: application.id,
        contactName: application.contactName,
        organization: application.organization,
        phone: application.phone,
        email: application.email,
        statement: application.statement,
        userEmail: application.userEmail,
        userName: application.userName,
        createdAt: application.createdAt,
        previousStatus,
      }).then((result) => {
        if (!result.sent) console.error(`[feishu] 代理商申请通知未送达：${result.reason ?? "未知原因"}`);
      });
    }

    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
