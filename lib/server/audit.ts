import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ServerUser } from "./users";

/**
 * 审计日志（安全检查表 8.4）。
 *
 * 三条硬要求落到实现上：
 * - 可溯源（8.4.3）：每条都带 userId + email + IP + 端口 + 协议 + UA，写日志时从请求头取，
 *   nginx 透传的 x-forwarded-for 取第一个地址，x-forwarded-proto 取协议。
 * - 不可删改（8.4.4）：表上有 BEFORE UPDATE OR DELETE 的触发器直接抛异常，写入只走 INSERT；
 *   另外每条带 hash = sha256(前一条 hash + 本条关键字段)，改动任何一条都会顺着链验出来。
 * - 留存期（8.4.5）：注册信息永久、用户日志 ≥12 个月、发布内容 ≥6 个月 —— 代码里不做任何清理，
 *   保留期由 verifyAuditChain / 备份策略兜底，见 docs/security-compliance.md。
 *
 * 写日志本身绝不能把请求打挂：任何异常吞掉并打到 stderr，审计失败不能影响业务响应。
 */

export type AuditCategory =
  | "auth"
  | "register"
  | "publish"
  | "behavior"
  | "admin"
  | "security"
  | "system";

export type AuditInput = {
  category: AuditCategory;
  action: string;
  user?: Pick<ServerUser, "id" | "email"> | null;
  ip?: string | null;
  port?: string | null;
  protocol?: string | null;
  userAgent?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
  result?: "success" | "denied" | "failed";
};

/** 从请求头还原可溯源三件套：来源 IP、源端口、协议。 */
export function requestContext(request: Request) {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
  const proto = headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  // 端口：显式头优先（nginx 可以透传 remote_port），否则按协议给默认端口。
  const port = headers.get("x-forwarded-port") ?? (proto === "https" ? "443" : "80");
  return {
    ip,
    port,
    protocol: proto,
    userAgent: headers.get("user-agent"),
    method: request.method,
    path: new URL(request.url).pathname,
  };
}

/** 上一条的哈希；没有日志时用固定创世值。 */
const GENESIS = "0".repeat(64);

function chainHash(prev: string, row: Record<string, unknown>) {
  const canonical = [
    prev,
    row.category,
    row.action,
    row.userEmail ?? "",
    row.ip ?? "",
    row.port ?? "",
    row.protocol ?? "",
    row.targetType ?? "",
    row.targetId ?? "",
    row.result,
    new Date(row.createdAt as Date).toISOString(),
    JSON.stringify(row.detail ?? {}),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

async function lastHash(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ hash: schema.auditLogs.hash })
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(1);
  return row?.hash ?? GENESIS;
}

/** 写一条审计日志。永远不抛错 —— 审计失败只记 stderr，不影响业务响应。 */
export async function writeAudit(input: AuditInput, request?: Request): Promise<void> {
  try {
    const db = getDb();
    const context = request ? requestContext(request) : null;
    const prevHash = await lastHash();
    const createdAt = new Date();
    const payload = {
      category: input.category,
      action: input.action,
      userId: input.user?.id ?? null,
      userEmail: input.user?.email ?? null,
      ip: input.ip ?? context?.ip ?? null,
      port: input.port ?? context?.port ?? null,
      protocol: input.protocol ?? context?.protocol ?? null,
      userAgent: (input.userAgent ?? context?.userAgent ?? null)?.slice(0, 400) ?? null,
      method: input.method ?? context?.method ?? null,
      path: input.path ?? context?.path ?? null,
      status: input.status ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      detail: input.detail ?? {},
      result: input.result ?? "success",
      createdAt,
    };
    await db.insert(schema.auditLogs).values({
      ...payload,
      prevHash,
      hash: chainHash(prevHash, payload),
    });
  } catch (error) {
    console.error("[audit] 写入失败", error);
  }
}

export type AuditRow = {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  userEmail: string | null;
  ip: string | null;
  port: string | null;
  protocol: string | null;
  targetType: string | null;
  targetId: string | null;
  result: string;
  detail: Record<string, unknown>;
  method: string | null;
  path: string | null;
};

/** 管理端/导出用：按时间倒序查，支持分类、动作关键字、用户邮箱、起止时间过滤。 */
export async function listAuditLogs(options: {
  category?: string | null;
  action?: string | null;
  email?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
} = {}): Promise<AuditRow[]> {
  const db = getDb();
  const conditions = [
    options.category ? eq(schema.auditLogs.category, options.category) : null,
    options.action ? sql`${schema.auditLogs.action} ILIKE ${`%${options.action}%`}` : null,
    options.email ? sql`${schema.auditLogs.userEmail} ILIKE ${`%${options.email}%`}` : null,
    options.from ? gte(schema.auditLogs.createdAt, options.from) : null,
    options.to ? sql`${schema.auditLogs.createdAt} <= ${options.to.toISOString()}` : null,
  ].filter(Boolean) as ReturnType<typeof eq>[];

  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(Math.min(options.limit ?? 200, 2000));
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    category: row.category,
    action: row.action,
    userEmail: row.userEmail,
    ip: row.ip,
    port: row.port,
    protocol: row.protocol,
    targetType: row.targetType,
    targetId: row.targetId,
    result: row.result,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    method: row.method,
    path: row.path,
  }));
}

export async function auditOverview() {
  const db = getDb();
  const rows = await db
    .select({
      category: schema.auditLogs.category,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.auditLogs)
    .groupBy(schema.auditLogs.category);
  const byCategory = Object.fromEntries(rows.map((row) => [row.category, Number(row.total)]));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recent] = await db
    .select({ total: count() })
    .from(schema.auditLogs)
    .where(gte(schema.auditLogs.createdAt, since));
  return { byCategory, last24h: recent?.total ?? 0 };
}

/**
 * 完整性自检（8.2c / 8.4.4）：顺着 hash 链重算，报告第一条对不上的记录。
 * 管理端「审计日志」页有按钮跑它，备份脚本也会每日跑一次。
 */
export async function verifyAuditChain(limit = 5000): Promise<{
  ok: boolean;
  checked: number;
  brokenAt: string | null;
}> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .orderBy(schema.auditLogs.createdAt, schema.auditLogs.id)
    .limit(limit);
  let prev = GENESIS;
  for (const row of rows) {
    const expected = chainHash(prev, {
      category: row.category,
      action: row.action,
      userEmail: row.userEmail,
      ip: row.ip,
      port: row.port,
      protocol: row.protocol,
      targetType: row.targetType,
      targetId: row.targetId,
      result: row.result,
      createdAt: row.createdAt,
      detail: row.detail,
    });
    if (row.prevHash !== prev || row.hash !== expected) {
      return { ok: false, checked: rows.length, brokenAt: row.id };
    }
    prev = row.hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}

/** 导出 CSV（8.4.5「按公安机关要求留存指定内容」）。 */
export function auditCsv(rows: AuditRow[]): string {
  const header = [
    "记录时间",
    "分类",
    "动作",
    "用户邮箱",
    "IP地址",
    "端口",
    "协议",
    "对象类型",
    "对象ID",
    "结果",
    "方法",
    "路径",
    "详情",
  ];
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    // 公式注入防护：以 = + - @ 开头的单元格前加单引号
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.category,
      row.action,
      row.userEmail,
      row.ip,
      row.port,
      row.protocol,
      row.targetType,
      row.targetId,
      row.result,
      row.method,
      row.path,
      escape(JSON.stringify(row.detail)),
    ]
      .map(escape)
      .join(","),
  );
  return `${header.join(",")}\n${lines.join("\n")}`;
}