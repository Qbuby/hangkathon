/**
 * 数据库层测试：把 8 个迁移在一个**真实的 Postgres** 上跑一遍，并断言那些
 * 只存在于 SQL 里的安全不变量确实生效。
 *
 * 为什么之前是空白、现在必须有：
 *   - 全仓 41 个用例都是"把 TS 源码转译后在 node 里跑纯函数"，没有一条碰过数据库；
 *   - 而安全检查表 8.4.4（审计日志不可改不可删）、8.2b（限流）的**实现全在 SQL 里**：
 *     append-only 触发器、rate_limits 的窗口重置表达式。
 *   - 结果就是：删掉那个触发器、或者把窗口条件写反（本项目真写反过，
 *     条件恒真导致限流形同虚设），全部测试依然全绿。
 *
 * 没有 DATABASE_URL 时**显式跳过**（node:test 的 skip 会计入 skipped 计数），
 * 不伪装成通过。CI 上由 postgres service container 提供 DATABASE_URL。
 *
 * 本地跑：
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=t postgres:18-alpine
 *   DATABASE_URL=postgres://t:t@127.0.0.1:55432/t node --test scripts/db-schema.test.mjs
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SHOULD_RUN = Boolean(DATABASE_URL);
const SKIP_REASON = "未设置 DATABASE_URL：数据库层测试跳过（CI 上由 postgres service 提供）";

const MIGRATION_DIR = new URL("../drizzle/", import.meta.url);

/** 按文件名顺序读出全部迁移（drizzle 的 0001_xxx.sql 命名天然可排序）。 */
function migrationFiles() {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * 迁移文件里的 `--> statement-breakpoint` 是 drizzle-kit 给迁移器看的标记，
 * 直接整文件交给 Postgres 的简单查询协议会被它当成语法错误。
 * 但它只出现在语句之间的行尾，删掉即可（`$$` 块内的行不含这个标记）。
 */
function loadMigration(name) {
  return readFileSync(new URL(name, MIGRATION_DIR), "utf8").replaceAll("--> statement-breakpoint", "");
}

/**
 * 每个用例在一个**全新重建的 public schema** 上跑迁移，用完清掉。
 *
 * 不用「建一个新 schema 再 SET search_path」的写法：`SET` 是会话级的，
 * 而 postgres.js 是连接池（即使 max:1，语句之间的连接归属也不由调用方保证），
 * 表现为"迁移建到了 mig_test_x，查询却去 public 找表" —— 正是本文件要防的那种
 * "看起来在测、其实测的是别的东西"。重建 public 不依赖任何会话状态，行为确定。
 */
async function withFreshSchema(sql, _label, fn) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
  await sql.unsafe(`CREATE SCHEMA public`);
  await sql.unsafe(`GRANT ALL ON SCHEMA public TO CURRENT_USER`);
  try {
    return await fn();
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE`).catch(() => {});
    await sql.unsafe(`CREATE SCHEMA public`).catch(() => {});
  }
}

test("全部迁移可在空库上按序应用（含反复执行幂等）", { skip: SHOULD_RUN ? false : SKIP_REASON }, async () => {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  const drizzleClient = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const files = migrationFiles();
    assert.ok(files.length >= 12, `至少应有 12 个迁移，实际 ${files.length}`);

    await withFreshSchema(sql, "first", async () => {
      for (const name of files) {
        await sql.unsafe(loadMigration(name));
      }
      const tables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name
      `;
      const names = tables.map((row) => row.table_name);
      for (const expected of ["users", "activities", "submissions", "audit_logs", "user_blacklist", "rate_limits", "agent_applications"]) {
        assert.ok(names.includes(expected), `迁移后应存在表 ${expected}（实际有 ${names.join(", ")}）`);
      }
    });

    // 幂等：容器每次启动都会跑 db/migrate.mjs，所以"重复执行不报错"是生产路径的硬要求。
    //
    // 注意这里必须用 **drizzle 的 migrate()** 而不是重放 SQL：
    // 迁移 SQL 本身并不幂等（0000 里是裸 CREATE TABLE），真正的幂等保证来自
    // drizzle 的记账表（默认建在 `drizzle` schema 里）。用重放 SQL 去测会得到一个
    // "CREATE TABLE already exists" 的假失败 —— 测的不是生产行为。
    await withFreshSchema(sql, "idem", async () => {
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const { migrate } = await import("drizzle-orm/postgres-js/migrator");
      const folder = new URL("../drizzle", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
      await migrate(drizzle(drizzleClient), { migrationsFolder: folder });
      const first = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
      await migrate(drizzle(drizzleClient), { migrationsFolder: folder });
      const second = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
      assert.equal(second[0].n, first[0].n, `重复 migrate() 不应重复应用（${first[0].n} → ${second[0].n}）`);
      assert.ok(first[0].n >= files.length, `记账表应记录全部 ${files.length} 个迁移，实际 ${first[0].n}`);
    });
  } finally {
    await sql.end();
    await drizzleClient.end();
  }
});

test("审计日志 append-only：UPDATE 与 DELETE 都必须被触发器拒绝", { skip: SHOULD_RUN ? false : SKIP_REASON }, async () => {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await withFreshSchema(sql, "mig_test_append", async () => {
      for (const name of migrationFiles()) await sql.unsafe(loadMigration(name));

      await sql`INSERT INTO audit_logs (category, action, result) VALUES ('auth', 'login', 'success')`;
      const rows = await sql`SELECT count(*)::int AS n FROM audit_logs`;
      assert.equal(rows[0].n, 1);

      // 触发器存在性：少了它这条防线就没了，而所有纯函数测试都发现不了
      const triggers = await sql`
        SELECT tgname FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'audit_logs' AND NOT t.tgisinternal
      `;
      assert.ok(
        triggers.some((row) => row.tgname === "audit_logs_no_mutation"),
        `audit_logs 上应有 audit_logs_no_mutation 触发器，实际：[${triggers.map((t) => t.tgname).join(", ")}]`,
      );

      await assert.rejects(
        () => sql`UPDATE audit_logs SET result = 'tampered'`,
        /append-only/i,
        "UPDATE 必须被拒绝（检查表 8.4.4：不可删除修改覆盖）",
      );
      await assert.rejects(
        () => sql`DELETE FROM audit_logs`,
        /append-only/i,
        "DELETE 必须被拒绝（检查表 8.4.4）",
      );

      // 拒绝之后数据必须原样还在
      const after = await sql`SELECT count(*)::int AS n, min(result) AS r FROM audit_logs`;
      assert.equal(after[0].n, 1);
      assert.equal(after[0].r, "success");
    });
  } finally {
    await sql.end();
  }
});

test("审计日志不持有指向业务表的外键（否则删用户会被触发器拦死）", { skip: SHOULD_RUN ? false : SKIP_REASON }, async () => {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await withFreshSchema(sql, "mig_test_fk", async () => {
      for (const name of migrationFiles()) await sql.unsafe(loadMigration(name));

      const fks = await sql`
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'audit_logs' AND con.contype = 'f'
      `;
      assert.equal(
        fks.length, 0,
        `audit_logs 不应有外键（0009 加过、0011 移除过），实际：${fks.map((f) => f.conname).join(", ")}`,
      );

      // 端到端验证 0011 的动机：有审计记录的用户必须能删掉
      await sql`INSERT INTO users (email, name) VALUES ('fk-test@example.com', 'FK')`;
      const user = await sql`SELECT id FROM users WHERE email = 'fk-test@example.com'`;
      await sql`INSERT INTO audit_logs (category, action, user_id, user_email) VALUES ('auth', 'login', ${user[0].id}, 'fk-test@example.com')`;
      await sql`DELETE FROM users WHERE id = ${user[0].id}`;
      const left = await sql`SELECT count(*)::int AS n FROM users WHERE email = 'fk-test@example.com'`;
      assert.equal(left[0].n, 0, "有审计记录的用户必须仍可删除（触发器不能被级联 SET NULL 触发）");
    });
  } finally {
    await sql.end();
  }
});

/**
 * 从 lib/server/rate-limit.ts 里**抽出真实的那条 upsert SQL**，把模板变量替换成字面量。
 *
 * 为什么不在测试里重写一遍等价 SQL：那样测的是"我抄对了吗"，源码改了测试不会知道 ——
 * 而本项目恰恰在这里出过一次事故（窗口条件写成恒真，限流形同虚设）。
 * 抽出源码文本再执行，改坏源码就会让测试变红。
 */
function extractRateLimitSql() {
  const src = readFileSync(new URL("../lib/server/rate-limit.ts", import.meta.url), "utf8");
  const match = /await db\.execute\(sql`([\s\S]*?)`\);/.exec(src);
  assert.ok(match, "未能从 lib/server/rate-limit.ts 里抽出限流 upsert SQL —— 源码结构变了，请同步更新本测试");
  return match[1]
    .replaceAll("${key}", "'test:key'")
    .replaceAll("${nowIso}", "NOW_ISO")
    .replaceAll("${cutoffIso}", "CUTOFF_ISO");
}

test("限流窗口在 windowMs 之外才重置（回归：条件写反导致限流形同虚设）", { skip: SHOULD_RUN ? false : SKIP_REASON }, async () => {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await withFreshSchema(sql, "rate", async () => {
      for (const name of migrationFiles()) await sql.unsafe(loadMigration(name));

      const template = extractRateLimitSql();
      // 源码结构变动会让上面 assert 失败 —— 那是**期望行为**：
      // 与其让测试静默失去覆盖，不如明确报出来要求同步。

      const WINDOW = 60_000;
      const t0 = 1_800_000_000_000; // 固定时间戳，测试结果与真实时钟无关

      /** 用源码里的 SQL 打一次，返回累计命中数。 */
      const hit = async (nowMs) => {
        const nowIso = new Date(nowMs).toISOString();
        const cutoffIso = new Date(nowMs - WINDOW).toISOString();
        const text = template.replaceAll("NOW_ISO", `'${nowIso}'`).replaceAll("CUTOFF_ISO", `'${cutoffIso}'`);
        const rows = await sql.unsafe(text);
        return Number(rows[0].hits);
      };

      const hits = [];
      for (let i = 0; i < 5; i += 1) hits.push(await hit(t0 + i * 100));
      assert.deepEqual(hits, [1, 2, 3, 4, 5], `窗口内必须累加，实际 ${hits.join(",")}`);

      // 核心回归点：窗口**外**必须重置为 1。
      // 若源码把条件写成 `window_start < now()`（恒真）或 `<=`，这里会拿到别的数 ——
      // 那正是"限流看起来在工作、实际每次从 1 开始"的形态。
      assert.equal(await hit(t0 + WINDOW + 1), 1, "越过窗口后必须重置为 1");

      // 边界：window_start == now - windowMs 时**仍在窗口内**（源码用的是严格小于）
      await sql.unsafe(`DELETE FROM rate_limits`);
      assert.equal(await hit(t0), 1);
      assert.equal(await hit(t0 + WINDOW), 2, "window_start == now - windowMs 时仍在窗口内（严格小于才对）");
      assert.equal(await hit(t0 + WINDOW + 1), 1, "越过边界一毫秒必须重置");
    });
  } finally {
    await sql.end();
  }
});

test("用户黑名单：email 唯一 + 生效时间字段齐备（检查表 9.2.2c）", { skip: SHOULD_RUN ? false : SKIP_REASON }, async () => {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await withFreshSchema(sql, "mig_test_bl", async () => {
      for (const name of migrationFiles()) await sql.unsafe(loadMigration(name));

      const cols = await sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'user_blacklist'
      `;
      const names = cols.map((row) => row.column_name);
      for (const required of ["effective_from", "effective_until", "revoked_at", "revoked_by", "source", "hits"]) {
        assert.ok(names.includes(required), `user_blacklist 应含字段 ${required}（"记录生效时间"是检查表原文要求）`);
      }

      await sql`INSERT INTO user_blacklist (email, reason) VALUES ('dup@example.com', 'probe')`;
      await assert.rejects(
        () => sql`INSERT INTO user_blacklist (email, reason) VALUES ('dup@example.com', 'again')`,
        /unique|duplicate/i,
        "email 必须唯一，否则命中判定会出现歧义",
      );
    });
  } finally {
    await sql.end();
  }
});
