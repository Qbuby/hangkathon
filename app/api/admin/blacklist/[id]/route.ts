import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { revokeBlacklist } from "@/lib/server/blacklist";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 解除黑名单：留操作人，审计里能查到谁在什么时候放的。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const removed = await revokeBlacklist(id, admin.id);
    if (removed) {
      await writeAudit(
        {
          category: "security",
          action: "blacklist.revoke",
          user: admin,
          targetType: "blacklist",
          targetId: id,
          detail: { id },
        },
        request,
      );
    }
    return NextResponse.json({ ok: removed });
  } catch (error) {
    return handleRouteError(error);
  }
}