import { NextResponse } from "next/server";
import { listUsers } from "@/lib/server/admin";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 全部用户（含角色与计数）。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return NextResponse.json({ users: await listUsers() });
  } catch (error) {
    return handleRouteError(error);
  }
}
