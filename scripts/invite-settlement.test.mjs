import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production settlement logic without a runtime/test dependency.
const source = readFileSync(new URL("../lib/invites.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { settleFactionLeaders, inviteCount } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const ev = (factionId, inviter, invitee, at) => ({ activityId: "act1", factionId, inviter, invitee, at });
const EVENTS = [
  ev("xihu", "alice", "u1", "2026-09-01T00:00:00Z"),
  ev("xihu", "alice", "u2", "2026-09-02T00:00:00Z"),
  ev("xihu", "bob", "u3", "2026-09-01T12:00:00Z"),
  ev("gongshu", "carol", "u4", "2026-09-03T00:00:00Z"),
  { activityId: "other", factionId: "xihu", inviter: "alice", invitee: "u9", at: "2026-09-01T00:00:00Z" },
];

test("leader is the member with the most successful invites per faction", () => {
  const leaders = settleFactionLeaders(EVENTS, "act1");
  assert.equal(leaders.xihu.name, "alice");
  assert.equal(leaders.xihu.invites, 2);
  assert.equal(leaders.gongshu.name, "carol");
  assert.equal(leaders.gongshu.invites, 1);
});

test("tie breaks by earliest invited join", () => {
  const leaders = settleFactionLeaders([
    ev("xihu", "alice", "u1", "2026-09-02T00:00:00Z"),
    ev("xihu", "bob", "u2", "2026-09-01T00:00:00Z"),
    ev("xihu", "carol", "u3", "2026-09-03T00:00:00Z"),
  ], "act1");
  assert.equal(leaders.xihu.name, "bob");
});

test("factions without invited joins have no leader; other activities are excluded", () => {
  const leaders = settleFactionLeaders(EVENTS, "act1");
  assert.ok(!("binjiang" in leaders));
  assert.equal(leaders.xihu.invites, 2); // "other" 活动的 alice 邀请不计入
});

test("inviteCount only counts matching faction, inviter and activity", () => {
  assert.equal(inviteCount(EVENTS, "act1", "xihu", "alice"), 2);
  assert.equal(inviteCount(EVENTS, "act1", "gongshu", "carol"), 1);
  assert.equal(inviteCount(EVENTS, "act1", "xihu", "dave"), 0);
  assert.equal(inviteCount(EVENTS, "other", "xihu", "alice"), 1);
});
