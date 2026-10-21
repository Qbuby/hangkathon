import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, schema } from "@/db";
import { requireNotBlacklisted } from "./blacklist";

/**
 * 服务端身份解析：会话里的 email 是唯一身份来源，users 表按 email upsert。
 * 只有配了 DATABASE_URL 的部署才有数据库；没有时这些函数会抛错，路由层统一回 503。
 * 管理员：users.role='admin'，由 ADMIN_EMAILS 环境变量引导提权（ensureAdminSeed，幂等）。
 */

export type ServerUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "无管理员权限") {
    super(message);
    this.name = "ForbiddenError";
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** 当前登录用户（未登录返回 null）。 */
export async function currentUser(): Promise<ServerUser | null> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;
  return ensureUser(email, session?.user?.name ?? null);
}

/**
 * 按 email upsert 一行 user，返回它。
 *
 * **必须处理 name 为 null 的情形**：drizzle 对 `set({ name: undefined })`
 * 会抛 `No values to set`，整个 upsert 直接失败。微信账号恰好就是这种情况 ——
 * 公众号侧不返回昵称，会话里的 name 恒为 null。
 * 线上症状：登录成功、/api/session 正常，但 /api/agent/session、/api/me、
 * /api/admin/session 全部 500，前端只能把用户当成"未登录"。
 */
export async function ensureUser(email: string, name: string | null): Promise<ServerUser> {
  const db = getDb();
  const trimmed = name?.trim() || null;
  const [row] = await db
    .insert(schema.users)
    .values({ email, name: trimmed })
    .onConflictDoUpdate({
      target: schema.users.email,
      // 只有拿到非空昵称才覆盖 —— 微信占位会话不能把扫码时存下的昵称抹成 null。
      set: trimmed ? { name: trimmed } : { lastLoginAt: new Date() },
    })
    .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role });
  return row;
}

/**
 * 按 email **查**（不创建）一行 user；不存在返回 null。
 *
 * 与 ensureUser 的区别是这里绝不 upsert —— 飞书机器人用它把 open_id 解析成操作者，
 * 那里必须"查不到就是查不到"，不能因为有人往群里发了个陌生邮箱就凭空造出一个账号。
 */
export async function getUserByEmail(email: string): Promise<ServerUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [row] = await getDb()
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);
  return row ?? null;
}

/** 供路由用：未登录时抛 401 语义的错误。 */
export async function requireUser(): Promise<ServerUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  // 黑名单来源控制（检查表 9.3.4）：名单内账号一律不能发起活动、报名、提交作品。
  // 读接口不经过这里，所以他们仍可浏览公开内容。
  await requireNotBlacklisted(user.email);
  return user;
}

export async function isAdminUser(user: ServerUser | null): Promise<boolean> {
  return user?.role === "admin";
}

/**
 * 发布权门禁：只有代理商（和平台管理员）能发活动。
 * 代理商来自管理端授权或申请审核通过 —— 见 lib/server/agents.ts。
 */
export function isPublisher(user: ServerUser | null): boolean {
  return canPublishRole(user?.role);
}

export function canPublishRole(role: string | null | undefined): boolean {
  return role === "agent" || role === "admin";
}

/** 供路由用：未登录 401、黑名单/无发布权 403。 */
export async function requirePublisher(): Promise<ServerUser> {
  const user = await requireUser();
  if (!isPublisher(user)) throw new ForbiddenError("只有代理商可以发布活动，请先提交代理商申请");
  return user;
}

/** 供路由用：未登录 401、非管理员 403。 */
export async function requireAdmin(): Promise<ServerUser> {
  const user = await requireUser();
  if (!isAdminUser(user)) throw new ForbiddenError();
  return user;
}

/**
 * ADMIN_EMAILS（逗号分隔）里的邮箱提权为 admin；幂等且不降级名单外的人。
 * 部署后想换/加管理员改环境变量重建即可。
 */
export async function ensureAdminSeed(): Promise<void> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  const emails = raw.split(",").map(normalizeEmail).filter(Boolean);
  if (emails.length === 0) return;
  const db = getDb();
  for (const email of emails) {
    // 登录过的直接提权；没登录过的预置一行，首次 OAuth 登录时按 email 命中这一行。
    await db
      .insert(schema.users)
      .values({ email, name: null, role: "admin" })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { role: "admin" },
      });
  }
}
