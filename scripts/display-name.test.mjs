import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 展示名脱敏（2026-10-21 用户反馈：手机微信登录后个人主页把 openid 当昵称显示）。
 *
 * 微信登录没有昵称时，站内身份是 `<openid>@wechat.user`；任何 `name ?? email`
 * 的兜底都会把 openid 原样打到页面上。这个测试锁住三件事：
 *   1. 占位邮箱永远被换成稳定的短标签，输出里不含 openid 的任何片段；
 *   2. 有昵称时昵称优先，且过长会省略（不撑破卡片）；
 *   3. 普通邮箱（GitHub/Google 部署）行为不变，别把正常账号也打成「微信用户」。
 */

const source = readFileSync(new URL("../lib/display-name.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
}).outputText;
const { displayName, displayEmail, identityName, avatarInitial, wechatDisplayTag, isWechatPlaceholderEmail } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

/** 用户截图里那串真实的公众号 openid。 */
const OPENID = "oe8Tr3AQMIN1Y2qFWbEpQzi82xmY";
const WECHAT_USER = { name: null, email: `${OPENID}@wechat.user` };

test("微信占位邮箱不会把 openid 当昵称打出来", () => {
  assert.equal(isWechatPlaceholderEmail(WECHAT_USER.email), true);
  const label = displayName(WECHAT_USER);
  assert.match(label, /^微信用户 · [0-9A-F]{6}$/);
  // 任何长度 ≥ 6 的原串片段都不该出现（标签只有 6 位十六进制散列）
  for (let index = 0; index + 6 <= OPENID.length; index += 1) {
    assert.ok(!label.includes(OPENID.slice(index, index + 6)), `昵称泄露 openid 片段：${label}`);
  }
  assert.ok(!label.includes(OPENID), "昵称不能包含完整 openid");
});

test("同一个 openid 得到同一个标签，不同 openid 可区分", () => {
  const email = WECHAT_USER.email;
  assert.equal(wechatDisplayTag(email), wechatDisplayTag(email));
  const other = `oABC123xyzXYZ890@wechat.user`;
  assert.notEqual(wechatDisplayTag(email), wechatDisplayTag(other));
  // 大小写后缀也要认（数据库里可能存成大写后缀）
  assert.equal(isWechatPlaceholderEmail("abc@WECHAT.USER"), true);
});

test("有昵称时昵称优先，超长按字符截断并加省略号", () => {
  assert.equal(displayName({ name: "张三", email: WECHAT_USER.email }), "张三");
  const long = "超长昵称超长昵称超长昵称超长昵称超长昵称";
  const shown = displayName({ name: long, email: null });
  assert.ok(shown.endsWith("…"));
  assert.equal(Array.from(shown).length, 17); // 16 个字 + 省略号
  // 不能把 emoji 劈成半个代理对
  const emoji = "😀".repeat(20);
  const emojiShown = displayName({ name: emoji, email: null });
  assert.equal(Array.from(emojiShown).length, 17);
  assert.ok(!emojiShown.includes("\uFFFD"));
});

test("普通邮箱照旧展示，不被误判成微信账号", () => {
  assert.equal(displayName({ name: null, email: "dev@example.com" }), "dev@example.com");
  assert.equal(displayEmail("dev@example.com"), "dev@example.com");
  assert.equal(isWechatPlaceholderEmail("dev@example.com"), false);
  assert.equal(displayEmail(WECHAT_USER.email), "微信账号");
  assert.equal(displayEmail(null), null);
});

test("无昵称无邮箱时用调用方兜底，空兜底用于表单预填", () => {
  assert.equal(displayName(null), "数字市民");
  assert.equal(displayName({ name: "  ", email: null }, "已登录"), "已登录");
  assert.equal(displayName(WECHAT_USER, ""), displayName(WECHAT_USER));
  assert.equal(displayName({ name: null, email: null }, ""), "");
});

test("身份名不截断（邀请链接要能唯一定位），但也不泄露 openid", () => {
  const long = "一二三四五六七八九十一二三四五六七八九十";
  assert.equal(identityName({ name: long, email: null }), long, "邀请身份名不能截断，否则长昵称会撞车");
  assert.equal(identityName({ name: null, email: "dev@example.com" }), "dev@example.com");
  const wechat = identityName(WECHAT_USER);
  assert.match(wechat, /^微信用户 · [0-9A-F]{6}$/);
  assert.ok(!wechat.includes(OPENID));
});

test("头像首字：微信账号固定「微」，其余取展示名首字", () => {
  assert.equal(avatarInitial(WECHAT_USER), "微");
  assert.equal(avatarInitial({ name: "alice", email: null }), "A");
  assert.equal(avatarInitial(null), "·");
});

test("页面不再用 name ?? email 直接渲染（回归守卫）", () => {
  const files = [
    "../app/profile/profile-client.tsx",
    "../app/leaderboard/your-entry.tsx",
    "../app/session-menu.tsx",
    "../app/create/create-client.tsx",
    "../app/activities/[slug]/activity-detail.tsx",
  ];
  const raw = /user\.name\s*\?\?\s*user\.email|user\.name\s*\|\|\s*user\.email|user\?\.name\s*\?\?\s*user\?\.email/;
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!raw.test(text), `${file} 仍在用 name ?? email 直接当展示名`);
    assert.match(text, /@\/lib\/display-name/, `${file} 应通过 lib/display-name 取展示名`);
  }
});
