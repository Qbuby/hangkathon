import { defineConfig } from "drizzle-kit";

/** 自托管那份用 Postgres；生成迁移时需要 DATABASE_URL（drizzle-kit generate 其实不需要连库）。 */
export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://hangkathon:hangkathon@127.0.0.1:5432/hangkathon",
  },
});
