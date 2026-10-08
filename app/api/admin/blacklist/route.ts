import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { addToBlacklist, listBlacklist } from "@/lib/server/blacklist";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 黑名单列表（检查表 9.2.2c：有黑名单列表、记录生效时间）。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    return NextResponse.json({ entries: await listBlacklist() });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** 手工加入黑名单：平台自查或公安通报都走这里，来源必须写清楚。 */
export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const body = (await request.json().catch(() => null)) as {
      email?: string;
      reason?: string;
      source?: "platform" | "police";
      hits?: number;
      effectiveUntil?: string | null;
    } | null;
    const email = body?.email?.trim().toLowerCase();
    if (!email || !body?.reason) return jsonError(400, "缺少 email 或 reason");
    await addToBlacklist({
      email,
      reason: body.reason,
      source: body.source ?? "platform",
      hits: body.hits ?? 1,
      effectiveUntil: body.effectiveUntil ? new Date(body.effectiveUntil) : null,
      createdBy: admin.id,
    });
    await writeAudit(
      {
        category: "security",
        action: "blacklist.add",
        user: admin,
        targetType: "user",
        targetId: email,
        detail: { email, reason: body.reason, source: body.source ?? "platform", hits: body.hits ?? 1 },
      },
      request,
    );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}