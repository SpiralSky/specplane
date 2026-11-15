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

test("a subagent's call takes its role from the host's caller record, once, and never from tool input", async () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["subagent=scribe", "delegated=true"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "small").ok, true);
  const { createMcpServer } = await import("./mcp.js");
  const { storeDir } = await import("../repo/store.js");
  const server = createMcpServer({ root, id: "mcp1", model: "m", reportsContext: false });
  const callers = path.join(storeDir(root), "callers");
  fs.mkdirSync(callers, { recursive: true });
  const record = (id: string, rec: unknown): void => fs.writeFileSync(path.join(callers, `${id}.json`), JSON.stringify(rec));
  let n = 0;
  const call = async (meta: unknown, args: unknown = {}, refused = false): Promise<{ role: string; subagent?: string; delegatedBy?: string }> => {
    const line = await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: "role_list", arguments: args, ...(meta ? { _meta: meta } : {}) } }));
    assert.equal(JSON.parse(line!).result.isError, refused);
    const last = fs.readFileSync(path.join(root, ".git", "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { actor: { role: string; agentType?: string; delegatedBy?: string } }).pop()!.actor;
    return { role: last.role, subagent: last.agentType, delegatedBy: last.delegatedBy };
  };
  record("toolu_A1", { agent_type: "scribe", agent_id: "a1", at: new Date().toISOString() });
  assert.deepEqual(await call({ "claudecode/toolUseId": "toolu_A1" }), { role: "helper", subagent: "scribe", delegatedBy: "mcp1" });
  assert.equal(fs.existsSync(path.join(callers, "toolu_A1.json")), false, "the record is consumed");
  assert.equal((await call({ "claudecode/toolUseId": "toolu_A1" })).role, "llm", "a second call has no record");
  assert.equal((await call(undefined)).role, "llm", "a call without a tool-use ID keeps the session role");
  record("bad id", { agent_type: "scribe", agent_id: "a1" });
  record("x", { agent_type: "scribe", agent_id: "a1" });
  assert.equal((await call({ "claudecode/toolUseId": "../x" })).role, "llm", "an invalid ID is ignored");
  assert.equal((await call({ "claudecode/toolUseId": "bad id" })).role, "llm");
  assert.equal(fs.existsSync(path.join(callers, "x.json")), true);
  // Tool input and an agent type without an agent ID do not give the subagent identity.
  assert.equal((await call({ "claudecode/toolUseId": "toolu_none" }, { subagent: "scribe", agent_type: "scribe", delegated: true, caller: { agent_type: "scribe", agent_id: "a1" } }, true)).role, "llm");
  record("toolu_B2", { agent_type: "scribe" });
  assert.equal((await call({ "claudecode/toolUseId": "toolu_B2" })).role, "llm", "an agent type alone is not a delegated subagent");
  // Records older than 24 hours are removed on the next call.
  record("toolu_old", { agent_type: "scribe", agent_id: "a1" });
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  fs.utimesSync(path.join(callers, "toolu_old.json"), old, old);
  await call({ "claudecode/toolUseId": "toolu_other" });
  assert.equal(fs.existsSync(path.join(callers, "toolu_old.json")), false);
});

test("a subagent inherits the session's role unless a rule about the subagent overrides it (R42.1)", async () => {
  const root = repo();
  for (const r of ["lead", "helper", "vendor"]) assert.equal(roleCreate(ctx(root), r, { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  for (const r of ["lead", "helper", "vendor"]) assert.equal(roleApprove(ctx(root), r).ok, true);
  assert.equal(ruleCreate(ctx(root), "lead-session", { role: "lead", matches: ["agent_type=reviewer"], priority: 5 }).ok, true);
  assert.equal(ruleCreate(ctx(root), "scribe-sub", { role: "helper", matches: ["subagent=scribe"] }).ok, true);
  // A rule on the model alone matches the session too, so it is not an override of the subagent.
  assert.equal(ruleCreate(ctx(root), "by-model", { role: "vendor", matches: ["model=m"] }).ok, true);
  commit(root);
  for (const r of ["lead-session", "scribe-sub", "by-model"]) assert.equal(ruleApprove(ctx(root), r).ok, true);
  const { createMcpServer } = await import("./mcp.js");
  const { storeDir } = await import("../repo/store.js");
  const server = createMcpServer({ root, id: "mcp2", model: "m", agentType: "reviewer", reportsContext: false });
  const callers = path.join(storeDir(root), "callers");
  fs.mkdirSync(callers, { recursive: true });
  let n = 0;
  const role = async (rec?: unknown): Promise<string> => {
    const id = `toolu_${++n}`;
    if (rec) fs.writeFileSync(path.join(callers, `${id}.json`), JSON.stringify({ ...(rec as object), at: new Date().toISOString() }));
    const line = await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: n, method: "tools/call", params: { name: "role_list", arguments: {}, _meta: { "claudecode/toolUseId": id } } }));
    assert.equal(JSON.parse(line!).result.isError, false);
    return fs.readFileSync(path.join(root, ".git", "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { actor: { role: string } }).pop()!.actor.role;
  };
  assert.equal(await role(), "lead", "the session itself");
  assert.equal(await role({ agent_type: "Explore", agent_id: "a1" }), "lead", "a subagent with no rule of its own inherits");
  assert.equal(await role({ agent_type: "scribe", agent_id: "a2" }), "helper", "a rule on the subagent overrides");
});

test("validation warns when a rule states the subagent and the Claude caller hook is missing", async () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["subagent=scribe"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "small").ok, true);
  fs.mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"), "#!/bin/sh\n");
  const { inspectInstallation } = await import("./install.js");
  const has = (): boolean => inspectInstallation(root).some((f) => f.severity === "warning" && /cannot tell subagents apart/.test(f.message));
  assert.equal(has(), true);
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-caller.sh"), "#!/bin/sh\n");
  assert.equal(has(), false);
});

test("validation does not warn about push for Claude Code, which claims the capability with its plugin (R35.1, R52.5)", async () => {
  const root = repo();
  fs.mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"), "#!/bin/sh\n");
  const { inspectInstallation } = await import("./install.js");
  const has = (): boolean => inspectInstallation(root).some((f) => f.severity === "warning" && /notifications\.push.*claude does not support push/.test(f.message));
  assert.equal(has(), false);
  const file = path.join(root, ".specplane/config.yaml");
  fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}\nnotifications:\n  push: true\n`);
  commit(root);
  assert.equal(has(), false);
});

test("validation warns about push for an installed Codex, and for Claude only if it lacked push (R35.1, R52.5)", async () => {
  const root = repo();
  const { writeStoreJson } = await import("../repo/store.js");
  writeStoreJson(root, "harness-install.json", { codex: [] });
  const file = path.join(root, ".specplane/config.yaml");
  fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}\nnotifications:\n  push: true\n`);
  commit(root);
  const { inspectInstallation } = await import("./install.js");
  const msgs = (): string[] => inspectInstallation(root).filter((f) => f.severity === "warning" && /notifications\.push/.test(f.message)).map((f) => f.message);
  assert.equal(msgs().some((m) => /codex does not support push/.test(m)), true);
  assert.equal(msgs().some((m) => /claude/.test(m)), false);
});
