/**
 * 容器启动前跑迁移。用 .mjs 而不是 .ts，因为运行镜像里没有 TypeScript 工具链。
 * 没有 DATABASE_URL（例如 Vercel 那份）就直接跳过，不影响启动。
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] DATABASE_URL 未设置，跳过迁移");
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 数据库容器刚起来时可能还没接受连接，重试几次再放弃
for (let attempt = 1; attempt <= 10; attempt += 1) {
  const sql = postgres(url, { max: 1, connect_timeout: 8 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log(`[migrate] 迁移已应用（第 ${attempt} 次尝试）`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[migrate] 第 ${attempt} 次尝试失败：${message}`);
    await sql.end({ timeout: 5 }).catch(() => {});
    if (attempt === 10) {
      console.error("[migrate] 重试耗尽，放弃");
      process.exit(1);
    }
    await sleep(3000);
  }
}
