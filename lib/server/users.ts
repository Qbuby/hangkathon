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
  constructor() {
    super("无管理员权限");
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

/** 按 email upsert 一行 user，返回它。 */
export async function ensureUser(email: string, name: string | null): Promise<ServerUser> {
  const db = getDb();
  const [row] = await db
    .insert(schema.users)
    .values({ email, name })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { name: name ?? undefined },
    })
    .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role });
  return row;
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
