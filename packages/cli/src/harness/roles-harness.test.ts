import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { activePreset, type Actor } from "../perm/permissions.js";
import { roleApprove, roleCreate, ruleApprove, ruleCreate, type RoleCtx } from "../perm/role-ops.js";
import { makeRepo } from "../test-repo.js";

/** LLM role rules in the harness (`roles-and-permissions R44.1`). */

const admin: Actor = { role: "administrator", kind: "human", name: "Pat" };
function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "permissions:\n  preset: architecture-level-llm-control\n" });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  return root;
}
const commit = (root: string): void => { for (const a of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "roles"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0); };
const ctx = (root: string): RoleCtx => ({ root, actor: admin, preset: activePreset(root) });

test("an LLM actor of the harness takes the role its rule gives", async () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["subagent=scribe"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "small").ok, true);
  const { createActionRuntime } = await import("../harness/actions.js");
  const dflt = createActionRuntime({ root, id: "s1", model: "m", reportsContext: false });
  const scribe = createActionRuntime({ root, id: "s2", model: "m", subagent: "scribe", reportsContext: false });
  const listed = async (rt: typeof dflt) => (await rt.call("role.list", {})).ok;
  assert.equal(await listed(dflt), true);
  assert.equal(await listed(scribe), true);
  const audit = fs.readFileSync(path.join(root, ".git", "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { actor?: { role?: string }; command?: string });
  const roles = audit.filter((e) => e.command === "role.list").map((e) => e.actor?.role);
  assert.deepEqual(roles, ["llm", "helper"]);
});
