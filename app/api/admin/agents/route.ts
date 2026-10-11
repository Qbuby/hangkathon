import { NextResponse } from "next/server";
import { listAgentApplications } from "@/lib/server/agents";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 全部代理商申请（待审核在前），带申请人信息。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return NextResponse.json({ applications: await listAgentApplications() });
  } catch (error) {
    return handleRouteError(error);
  }
}