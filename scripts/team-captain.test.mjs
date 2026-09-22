import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production helpers without a runtime/test dependency.
const source = readFileSync(new URL("../lib/contribution.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { teamByCaptain, CONTRIBUTIONS, MECHANISM } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("teamByCaptain returns the team led by the named member only", () => {
  const teams = CONTRIBUTIONS.demo_midautumn_poetry.teams;
  const led = teamByCaptain(teams, "lakeside_verses");
  assert.equal(led?.id, "team_dyj");
  assert.equal(teamByCaptain(teams, "osmanthus_lane")?.id, "team_qiantang");
  // 普通成员不是队长
  assert.equal(teamByCaptain(teams, "longjing_tea"), undefined);
  assert.equal(teamByCaptain(teams, "nobody"), undefined);
});

test("every demo team has a captain who is also a member", () => {
  for (const [activityId, contribution] of Object.entries(CONTRIBUTIONS)) {
    for (const team of contribution.teams) {
      assert.ok(team.captain, `${activityId}/${team.id} missing captain`);
      assert.ok(
        contribution.members.some((member) => member.name === team.captain && member.teamId === team.id),
        `${activityId}/${team.id} captain ${team.captain} is not a member`,
      );
    }
  }
});

test("invite bonuses stay two-sided", () => {
  assert.equal(MECHANISM.invite.inviterBonus, 50);
  assert.equal(MECHANISM.invite.inviteeBonus, 20);
  assert.equal(MECHANISM.leaderBonusPct, 0.05);
});
