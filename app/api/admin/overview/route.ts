import { NextResponse } from "next/server";
import { adminOverview } from "@/lib/server/admin";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 总览计数：用户 / 活动 / 报名 / 作品 / 待审核作品 / 待审核活动。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return NextResponse.json(await adminOverview());
  } catch (error) {
    return handleRouteError(error);
  }
}
