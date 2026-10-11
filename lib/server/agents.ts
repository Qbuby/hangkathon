import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { AdminActionError } from "./admin";
import type { ServerUser } from "./users";

/**
 * 代理商（agent）角色与申请审核。
 *
 * 角色模型：users.role ∈ user | agent | admin。
 * 只有代理商能发布活动（admin 是平台运营者，天然包含发布权，否则会出现
 * "能审活动却不能发活动"的割裂）。普通用户在 /create 提交身份声明与联系方式，
 * 管理端审核通过后由 reviewAgentApplication 把 role 提为 agent —— 这是角色
 * 唯一的自动授予路径；直接改库或 setUserRole 也要在审计里留痕。
 */

export type AgentApplicationRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  contactName: string;
  organization: string;
  phone: string;
  email: string;
  statement: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function canPublish(role: string | null | undefined): boolean {
  return role === "agent" || role === "admin";
}

/** 我的申请（没有则 null）。 */
export async function getMyAgentApplication(userId: string): Promise<AgentApplicationRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.agentApplications)
    .where(eq(schema.agentApplications.userId, userId))
    .limit(1);
  return row ? toRow(row, null, null) : null;
}

export type AgentApplyInput = {
  contactName: string;
  organization: string;
  phone: string;
  email: string;
  statement: string;
};

/**
 * 提交（或重新提交）申请：一个用户一份，重复提交即覆盖并回到 pending。
 * 已通过的申请不允许再改 —— 那时身份已经生效，要走收回流程。
 */
export async function submitAgentApplication(
  user: ServerUser,
  input: AgentApplyInput,
): Promise<AgentApplicationRow> {
  const db = getDb();
  const existing = await getMyAgentApplication(user.id);
  if (existing?.status === "approved") {
    throw new AdminActionError(400, "你已经是代理商，无需重复申请");
  }
  const values = {
    userId: user.id,
    contactName: input.contactName.trim(),
    organization: input.organization.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    statement: input.statement.trim(),
    status: "pending",
    reviewNote: null,
    reviewedAt: null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(schema.agentApplications).set(values).where(eq(schema.agentApplications.userId, user.id));
  } else {
    await db.insert(schema.agentApplications).values(values);
  }
  const fresh = await getMyAgentApplication(user.id);
  if (!fresh) throw new AdminActionError(500, "申请写入失败");
  return fresh;
}

/** 管理端：全部申请（带申请人信息），待审核在前。 */
export async function listAgentApplications(): Promise<AgentApplicationRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      application: schema.agentApplications,
      userEmail: schema.users.email,
      userName: schema.users.name,
    })
    .from(schema.agentApplications)
    .leftJoin(schema.users, eq(schema.users.id, schema.agentApplications.userId))
    .orderBy(
      sql`case when ${schema.agentApplications.status} = 'pending' then 0 when ${schema.agentApplications.status} = 'rejected' then 1 else 2 end`,
      desc(schema.agentApplications.updatedAt),
    );
  return rows.map((row) => toRow(row.application, row.userEmail, row.userName));
}

/** 审核一张申请：通过即授予代理商角色；驳回只改申请状态并留理由。 */
export async function reviewAgentApplication(
  operator: ServerUser,
  id: string,
  decision: "approved" | "rejected",
  note: string | null,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.agentApplications)
    .where(eq(schema.agentApplications.id, id))
    .limit(1);
  if (!row) throw new AdminActionError(404, "申请不存在");
  if (row.status !== "pending") throw new AdminActionError(400, "该申请已处理过");

  await db
    .update(schema.agentApplications)
    .set({
      status: decision,
      reviewNote: note,
      reviewedAt: new Date(),
      reviewedBy: operator.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.agentApplications.id, id));

  if (decision === "approved") {
    // 申请通过 = 角色授予。这里的 where 不加 role 条件：管理员本人申请（理论不会）也允许。
    await db.update(schema.users).set({ role: "agent" }).where(eq(schema.users.id, row.userId));
  }
}

export async function countPendingAgentApplications(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.agentApplications)
    .where(eq(schema.agentApplications.status, "pending"));
  return Number(row?.value ?? 0);
}

type ApplicationRow = typeof schema.agentApplications.$inferSelect;

function toRow(
  row: ApplicationRow,
  userEmail: string | null,
  userName: string | null,
): AgentApplicationRow {
  return {
    id: row.id,
    userId: row.userId,
    userEmail,
    userName,
    contactName: row.contactName,
    organization: row.organization,
    phone: row.phone,
    email: row.email,
    statement: row.statement,
    status: row.status as AgentApplicationRow["status"],
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}