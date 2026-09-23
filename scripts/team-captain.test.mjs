import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production helpers without a runtime/test dependency.
const source = readFileSync(new URL("../lib/contribution.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { teamByCaptain, CONTRIBUTIONS, MECHANISM } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("teamByCaptain returns the team led by the named member only", () => {
  const teams = [
    { id: "t1", name: "西湖队", color: "#7fd48d", points: 100, captain: "alice" },
    { id: "t2", name: "运河队", color: "#54d7ff", points: 80 },
  ];
  assert.equal(teamByCaptain(teams, "alice")?.id, "t1");
  assert.equal(teamByCaptain(teams, "bob"), undefined);
  assert.equal(teamByCaptain(teams, ""), undefined);
});

test("contribution source carries no fabricated records", () => {
  assert.equal(Object.keys(CONTRIBUTIONS).length, 0);
});

test("invite bonuses stay two-sided", () => {
  assert.equal(MECHANISM.invite.inviterBonus, 50);
  assert.equal(MECHANISM.invite.inviteeBonus, 20);
  assert.equal(MECHANISM.leaderBonusPct, 0.05);
});
