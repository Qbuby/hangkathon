import { NextResponse } from "next/server";
import { listAllActivities } from "@/lib/server/admin";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 全部活动（含不公开），带发起人与报名/作品计数。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return NextResponse.json({ activities: await listAllActivities() });
  } catch (error) {
    return handleRouteError(error);
  }
}
