import { NextResponse } from "next/server";
import { auditCsv, auditOverview, listAuditLogs } from "@/lib/server/audit";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/**
 * 审计日志查询（检查表 8.4.5：可按公安机关要求留存指定内容的查询与导出）。
 * 支持 category / action / email / from / to 过滤；format=csv 直接下载。
 */
export async function GET(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const rows = await listAuditLogs({
      category: url.searchParams.get("category"),
      action: url.searchParams.get("action"),
      email: url.searchParams.get("email"),
      from: url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : null,
      to: url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : null,
      limit: Number(url.searchParams.get("limit") ?? 200),
    });
    if (url.searchParams.get("format") === "csv") {
      return new NextResponse(`﻿${auditCsv(rows)}`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="audit-${Date.now()}.csv"`,
        },
      });
    }
    return NextResponse.json({ logs: rows, overview: await auditOverview() });
  } catch (error) {
    return handleRouteError(error);
  }
}