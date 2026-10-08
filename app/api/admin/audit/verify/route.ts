import { NextResponse } from "next/server";
import { verifyAuditChain } from "@/lib/server/audit";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/**
 * 审计日志完整性自检（检查表 8.2c / 8.4.4）：顺着哈希链重算，
 * 报告第一条对不上的记录 —— 有人绕过应用直接改库的话这里会断链。
 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const result = await verifyAuditChain();
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}