import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { activePreset, type Actor } from "../perm/permissions.js";
import { roleApprove, roleCreate, roleEdit, ruleApprove, ruleCreate, type RoleCtx } from "../perm/role-ops.js";
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
  const { createActionRuntime } = await import("./actions.js");
  const dflt = createActionRuntime({ root, id: "s1", model: "m", reportsContext: false });
  const scribe = createActionRuntime({ root, id: "s2", model: "m", subagent: "scribe", reportsContext: false });
  for (const [rt, role] of [[dflt, "llm"], [scribe, "helper"]] as const) {
    const reply = await rt.call("role.list", {});
    assert.equal(reply.ok, true);
    assert.match(reply.instructions[0].text!, new RegExp(`Role: ${role}\\. Mode: allow`));
  }
  const audit = fs.readFileSync(path.join(root, ".git", "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { actor?: { role?: string }; command?: string });
  const roles = audit.filter((e) => e.command === "role.list").map((e) => e.actor?.role);
  assert.deepEqual(roles, ["llm", "helper"]);
});

for (const mode of ["allow", "request-user", "deny"] as const) {
  test(`command and permission instructions match the resolved custom role's ${mode} check`, async () => {
    const root = repo();
    assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: [`info.retrieve=${mode}`] }).ok, true);
    commit(root);
    assert.equal(roleApprove(ctx(root), "helper").ok, true);
    assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["provider=anthropic", "agent_type=reviewer", "subagent=scribe", "model=m", "delegated=true"] }).ok, true);
    commit(root);
    assert.equal(ruleApprove(ctx(root), "small").ok, true);
    const { createActionRuntime } = await import("./actions.js");
    const runtime = createActionRuntime({ root, id: "custom", model: "m", provider: "anthropic", agentType: "reviewer", subagent: "scribe", delegatedBy: "parent", command: "plan-status", reportsContext: true });
    const reply = await runtime.call("role.list", {});
    assert.equal(reply.ok, mode !== "deny", reply.findings.join("\n"));
    assert.equal(!!reply.request, mode === "request-user");
    assert.deepEqual(reply.instructions.map((i) => i.key), ["plan-status", "info.retrieve"]);
    for (const instruction of reply.instructions) {
      assert.equal(instruction.status, "delivered");
      assert.match(instruction.text!, new RegExp(`Role: helper\\. Mode: ${mode}`));
      assert.doesNotMatch(instruction.text!, /Role: llm/);
    }
    const repeat = await runtime.call("role.list", {});
    assert.ok(repeat.instructions.every((i) => i.status === "already-delivered"));
  });
}

test("an existing session refreshes instructions when its effective role or approved permissions change", async () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["subagent=scribe"] }).ok, true);
  commit(root);
  const { createActionRuntime } = await import("./actions.js");
  const runtime = createActionRuntime({ root, id: "changing", subagent: "scribe", command: "plan-status", reportsContext: true });
  const initial = await runtime.call("role.list", {});
  assert.equal(initial.ok, true);
  assert.match(initial.instructions[1].text!, /Role: llm\. Mode: allow/);
  // Approving only the rule changes the role while leaving the preset and permissions unchanged.
  assert.equal(ruleApprove(ctx(root), "small").ok, true);
  const assigned = await runtime.call("role.list", {});
  assert.equal(assigned.ok, true);
  for (const [index, instruction] of assigned.instructions.entries()) {
    assert.equal(instruction.status, "delivered");
    assert.notEqual(instruction.hash, initial.instructions[index].hash);
    assert.match(instruction.text!, /Role: helper\. Mode: allow/);
  }
  assert.equal(roleEdit(ctx(root), "helper", { sets: ["info.retrieve=deny"] }).ok, true);
  commit(root);
  const pending = await runtime.call("role.list", {});
  assert.equal(pending.ok, true);
  assert.ok(pending.instructions.every((i, index) => i.status === "already-delivered" && i.hash === assigned.instructions[index].hash));
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  const approved = await runtime.call("role.list", {});
  assert.equal(approved.ok, false);
  for (const [index, instruction] of approved.instructions.entries()) {
    assert.equal(instruction.status, "delivered");
    assert.notEqual(instruction.hash, assigned.instructions[index].hash);
    assert.match(instruction.text!, /Role: helper\. Mode: deny/);
  }
});

test("the steering command shows an LLM caller its own custom role and a person the default LLM role", () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["subagent=scribe"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "small").ok, true);
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const base = { ...process.env, SPECPLANE_SESSION: "", SPECPLANE_AGENT: "" };
  const run = (env: NodeJS.ProcessEnv): string => {
    const out = path.join(root, ".git", "steering-out");
    const fd = fs.openSync(out, "w");
    try { assert.equal(spawnSync(process.execPath, [cli, "steering", "info.retrieve", "--json"], { cwd: root, env, stdio: ["ignore", fd, "ignore"] }).status, 0); } finally { fs.closeSync(fd); }
    return (JSON.parse(fs.readFileSync(out, "utf8")) as { data: { text: string } }).data.text;
  };
  assert.match(run({ ...base, SPECPLANE_ACTOR: "llm", SPECPLANE_SUBAGENT: "scribe" }), /Role: helper\. Mode: allow/);
  assert.match(run({ ...base, SPECPLANE_ACTOR: "llm" }), /Role: llm\./);
  assert.match(run(base), /Role: llm\./);
});
