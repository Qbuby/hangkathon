import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * 服务端数据库入口。只有配了 DATABASE_URL 才有数据库 —— Vercel 那份没有，
 * 于是 hasDatabase() 为 false，前端回落到 localStorage（行为与改动前一致）。
 */

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

let client: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — this deployment has no server-side database.");
  }
  if (!db) {
    client = postgres(url, { max: 8, idle_timeout: 20, connect_timeout: 10 });
    db = drizzle(client, { schema });
  }
  return db;
}

export { schema };
