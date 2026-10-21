import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 微信跨应用身份合并（2026-10-21 用户要求：「手机登录拿到的 union_id 去和库里已有的
 * 用户比对，若有符合的则显示昵称」）。
 *
 * 这条链路的错误形态都很安静：合并方向写反 = 把两个人的数据并成一个；
 * keeper 选错 = 每次登录换一个身份；昵称覆盖写空 = 名字突然消失。
 * 所以决策逻辑抽成纯函数单独测。
 */
function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const pure = () => load("../lib/server/wechat-identity-pure.ts");

const row = (id, email, name = null, image = null, createdAt = "2026-10-01T00:00:00Z") => ({
  id,
  email,
  name,
  image,
  createdAt,
});

test("planIdentity：只命中 unionid 时直接复用（手机端认到电脑端老账号）", async () => {
  const { planIdentity } = await pure();
  const old = row("u-old", "owu1v2fbya1ru0icns4dej0vzv_8@wechat.user", "徐一帆");
  assert.deepEqual(planIdentity({ byUnion: old, byEmail: null }), { action: "reuse", row: old });
});

test("planIdentity：只命中占位邮箱时补写 unionid（老账号第一次被关联）", async () => {
  const { planIdentity } = await pure();
  const old = row("u-old", "owu1v2@wechat.user", "徐一帆");
  assert.deepEqual(planIdentity({ byUnion: null, byEmail: old }), { action: "attach-union", row: old });
});

test("planIdentity：两行都命中且不同 → 合并进**注册更早**的那行（老账号）", async () => {
  const { planIdentity } = await pure();
  const older = row("u-old", "owu1v2@wechat.user", "徐一帆", null, "2026-10-09T00:00:00Z");
  const newer = row("u-new", "oe8Tr3@wechat.user", null, null, "2026-10-21T00:00:00Z");

  // 手机端登录命中：unionid 在老行、邮箱在新行
  const plan = planIdentity({ byUnion: older, byEmail: newer });
  assert.equal(plan.action, "merge");
  assert.equal(plan.keeper.id, "u-old", "keeper 必须是老账号：昵称/报名/作品都在它名下");
  assert.equal(plan.loser.id, "u-new");

  // 反过来从电脑端登录，结论必须相同（不能因为本次是哪个应用而改变）
  const reversed = planIdentity({ byUnion: newer, byEmail: older });
  assert.equal(reversed.action, "merge");
  assert.equal(reversed.keeper.id, "u-old", "keeper 的选择不能依赖本次登录的应用");

  // 时间完全相同时按 id 决定，保证两个实例不会各选一个 keeper
  const a = row("aaa", "a@wechat.user", null, null, "2026-10-01T00:00:00Z");
  const b = row("bbb", "b@wechat.user", null, null, "2026-10-01T00:00:00Z");
  assert.equal(planIdentity({ byUnion: a, byEmail: b }).keeper.id, "aaa");
  assert.equal(planIdentity({ byUnion: b, byEmail: a }).keeper.id, "aaa");
});

test("planIdentity：两行是同一行时不能自合并", async () => {
  const { planIdentity } = await pure();
  const same = row("u1", "a@wechat.user", "张三");
  assert.deepEqual(planIdentity({ byUnion: same, byEmail: same }), { action: "reuse", row: same });
});

test("planIdentity：两行都没有 → 新建", async () => {
  const { planIdentity } = await pure();
  assert.deepEqual(planIdentity({ byUnion: null, byEmail: null }), { action: "create" });
});

test("preferredProfile：本次的非空昵称应更新，空值绝不能抹掉历史昵称", async () => {
  const { preferredProfile } = await pure();
  // 扫码时用户改了昵称 → 用新的
  assert.deepEqual(
    preferredProfile({ name: "旧名", image: "old.png" }, { nickname: "新名", image: "new.png" }),
    { name: "新名", image: "new.png" },
  );
  // 公众号侧恒返回空串 → 保留库里扫码时拿到的昵称（这条一旦写错，手机登录一次名字就没了）
  assert.deepEqual(
    preferredProfile({ name: "徐一帆", image: "a.png" }, { nickname: "", image: "" }),
    { name: "徐一帆", image: "a.png" },
  );
  assert.deepEqual(preferredProfile({ name: null, image: null }, {}), { name: null, image: null });
  assert.deepEqual(preferredProfile({ name: null, image: null }, { nickname: "  " }), { name: null, image: null });
});

test("users 表有 union_id 且唯一（多个 NULL 允许）", () => {
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /unionId: text\("union_id"\)/);
  assert.match(schema, /uniqueIndex\("users_union_id_unique"\)\.on\(table\.unionId\)/);
});

test("迁移登记完整：0013 在 journal 里，且带回填与唯一索引", () => {
  const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  const entry = journal.entries.find((item) => item.tag === "0013_users_union_id");
  assert.ok(entry, "0013 必须登记进 _journal.json，否则迁移器根本不跑（这个坑踩过一次）");
  assert.equal(entry.idx, 13);

  const sql = readFileSync(new URL("../drizzle/0013_users_union_id.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "union_id"/, "迁移必须可重复执行");
  assert.match(sql, /UPDATE "users" u SET "union_id" = pick\."union_id"/, "历史验证码表里的 unionid 要回填");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "users_union_id_unique"/);
});

test("换票路由用命中用户的 email 签会话（否则 Auth.js 会再建一行）", () => {
  const route = readFileSync(new URL("../app/api/auth/wechat-code/poll/route.ts", import.meta.url), "utf8");
  assert.match(route, /getWechatSessionIdentity\(consumed\.userId\)/, "必须按 userId 回查真实身份");
  assert.match(route, /email: identity\.email/, "会话 email 必须来自 users 行");
  assert.match(route, /name: identity\.name/, "昵称必须来自 users 行（微信侧已不返回昵称）");
  assert.match(route, /sub: identity\.id/);
  // 旧写法（用公众号 openid 现拼 email）会让 unionid 合并失效
  assert.equal(
    /const email = `\$\{consumed\.openId\}@wechat\.user`/.test(route),
    false,
    "不能再按公众号 openid 现拼 email —— 那会让合并后的会话落回一个新行",
  );
});

test("扫码登录也走同一个身份解析（先 unionid 认人）", () => {
  const auth = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
  assert.match(auth, /resolveWechatUser\(/, "扫码登录必须复用同一套解析");
  assert.match(auth, /email: resolved\.email/, "扫码登录也要用命中行的 email");
  assert.match(auth, /unionId: p\.unionid \?\? null/, "unionid 要传进去");
  // 字符串 "async profile(" 是关键：同步版本无法查库
  assert.match(auth, /async profile\(profile\)/);
});

test("手机登录的绑定路径不再自己建用户", () => {
  const login = readFileSync(new URL("../lib/server/wechat-code-login.ts", import.meta.url), "utf8");
  assert.match(login, /resolveWechatUser\(\{ openId: input\.openId, unionId: input\.unionId \}\)/);
  assert.equal(
    /insert\(schema\.users\)/.test(login),
    false,
    "建号只能有一个入口（wechat-identity），否则两条路会各自维护一套合并逻辑",
  );
});
