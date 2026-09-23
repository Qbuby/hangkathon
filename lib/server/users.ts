import { auth } from "@/auth";
import { getDb, schema } from "@/db";

/**
 * 服务端身份解析：会话里的 email 是唯一身份来源，users 表按 email upsert。
 * 只有配了 DATABASE_URL 的部署才有数据库；没有时这些函数会抛错，路由层统一回 503。
 */

export type ServerUser = {
  id: string;
  email: string;
  name: string | null;
};

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
    .returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name });
  return row;
}

/** 供路由用：未登录时抛 401 语义的错误。 */
export async function requireUser(): Promise<ServerUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录");
    this.name = "UnauthorizedError";
  }
}
