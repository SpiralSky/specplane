import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { activePreset, type Actor, type Preset } from "./permissions.js";
import { resolveLlmRole } from "./llm-rules.js";
import { roleApprove, ruleApprove, ruleTrust } from "./role-ops.js";
import { roleProposeAccept } from "./role-propose.js";
import { roleFile, ruleFile } from "./roles.js";
import { createActionRuntime } from "../harness/actions.js";
import { acceptRequest, declineRequest, formatRequest, sendRequest, list, show } from "../requests/ops.js";
import { readRequest } from "../requests/store.js";
import { makeRepo } from "../test-repo.js";

/** `role.propose` against `roles-and-permissions` R44.2, T1 (`architecture/reference-cli` §7.7 'Role proposals'). */

const NOW = new Date("2026-11-17T12:00:00Z");
const llm: Actor = { role: "llm", kind: "llm", name: "claude", model: "claude-sonnet-5-5" };
const person: Actor = { role: "standard-user", kind: "human", name: "Pat" };
const admin: Actor = { role: "administrator", kind: "human", name: "Pat" };
const sh = (cwd: string, ...a: string[]): void => { assert.equal(spawnSync("git", a, { cwd }).status, 0); };
function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "permissions:\n  preset: architecture-level-llm-control\n" });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) sh(root, ...a);
  return root;
}
const withPropose = (root: string, m: "allow" | "request-user" | "deny"): Preset => { const p = activePreset(root); return { ...p, llm: { ...p.llm, modes: { ...p.llm.modes, "role.propose": m } } }; };
const send = (root: string, params: unknown, preset: Preset = activePreset(root)) => sendRequest({ root, actor: llm, preset, now: NOW }, { command: "role propose", params: params as Record<string, unknown>, reason: "needed" });
const as = (root: string, actor: Actor) => ({ root, actor, preset: activePreset(root), now: NOW });
const good = { role: { id: "helper", title: "Helper", level: 3, default_mode: "deny", modes: { "info.retrieve": "allow" } }, rule: { id: "helper-rule", priority: 1, match: { agent_type: "helper" } } };
const wide = { role: { id: "wide", title: "Wide", level: 3, default_mode: "deny", modes: { "spec.edit.feature": "allow" } }, rule: { id: "wide-rule", match: { agent_type: "wide" } } };
const absent = (root: string, role: string, rule: string): void => { assert.equal(fs.existsSync(path.join(root, roleFile(role))), false); assert.equal(fs.existsSync(path.join(root, ruleFile(rule))), false); };

test("deny: refused with the permission named and no request is stored", () => {
  const root = repo();
  const r = send(root, good, withPropose(root, "deny"));
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /role\.propose/);
  assert.equal(list(root).length, 0);
});

test("request user: the request carries the full role, rule and preview; nothing is written until accepted", () => {
  const root = repo();
  assert.equal(activePreset(root).llm.modes["role.propose"], "request-user");
  const r = send(root, good);
  assert.equal(r.ok, true, r.reasons.join());
  const rec = readRequest(root, r.request!.id)!;
  assert.deepEqual(rec.action.params, good);
  assert.deepEqual(rec.permissions, ["role.propose"]);
  assert.match(rec.diff!, /^helper \(custom, proposed/);
  assert.match(rec.diff!, /management level 3; default mode deny/);
  assert.match(rec.diff!, /info\.retrieve {2}allow/);
  assert.match(rec.diff!, /helper-rule: gives helper, priority 1, matches {"agent_type":"helper"}/);
  assert.match(rec.diff!, /above the llm role's own \(architecture-level-llm-control\): none/);
  assert.equal(show(root, rec.id)!.diff, rec.diff);
  assert.match(formatRequest(show(root, rec.id)!), /role propose/);
  absent(root, "helper", "helper-rule");
});

test("allow: a request is sent and still nothing is written", () => {
  const root = repo();
  const r = send(root, good, withPropose(root, "allow"));
  assert.equal(r.ok, true, r.reasons.join());
  assert.equal(readRequest(root, r.request!.id)!.state, "pending");
  absent(root, "helper", "helper-rule");
});

test("a malformed, duplicate or default-role proposal is refused when sent and stores nothing", () => {
  const root = repo();
  const bad: unknown[] = [
    {}, { role: good.role }, { ...good, extra: 1 }, { ...good, role: { ...good.role, id: "llm" } }, { ...good, role: { ...good.role, id: "Bad Id" } },
    { ...good, role: { ...good.role, level: 0 } }, { ...good, role: { ...good.role, default_mode: "maybe" } }, { ...good, role: { ...good.role, modes: { "no.such": "allow" } } },
    { ...good, rule: { id: "r", match: {} } }, { ...good, rule: { ...good.rule, role: "administrator" } }, { ...good, marked: ["no.such"] },
  ];
  for (const p of bad) { const r = send(root, p); assert.equal(r.ok, false, JSON.stringify(p)); assert.equal(r.request, undefined); }
  assert.equal(list(root).length, 0);
});

test("accepting writes the role and rule uncommitted; decline writes nothing", async () => {
  const root = repo();
  const r = send(root, good);
  const d = send(root, { ...good, role: { ...good.role, id: "other" }, rule: { ...good.rule, id: "other-rule" } });
  assert.equal((await declineRequest(as(root, admin), d.request!.id)).ok, true);
  absent(root, "other", "other-rule");
  const acc = await acceptRequest(as(root, admin), r.request!.id);
  assert.equal(acc.ok, true, acc.reasons.join());
  assert.deepEqual(acc.uncommitted, [roleFile("helper"), ruleFile("helper-rule")]);
  assert.equal(readRequest(root, r.request!.id)!.state, "accepted");
  assert.match(fs.readFileSync(path.join(root, ruleFile("helper-rule")), "utf8"), /role: helper/);
});

test("accepting is refused for a role without role.manage, role.map or a level above the proposed role; the request stays pending", async () => {
  const root = repo();
  const r = send(root, good);
  const id = r.request!.id;
  for (const actor of [person, llm]) {
    const a = await acceptRequest(as(root, actor), id);
    assert.equal(a.ok, false, actor.role);
  }
  assert.equal(readRequest(root, id)!.state, "pending");
  absent(root, "helper", "helper-rule");
  // Level: an accepter at level 3 cannot accept a role at level 3, nor can it create one above itself.
  const preset = activePreset(root);
  const low: Preset = { ...preset, customRoles: { low: { id: "low", title: "Low", level: 3, defaultMode: "deny", modes: { "role.manage": "allow", "role.map": "allow" } } } };
  const res = roleProposeAccept({ root, actor: { role: "low", kind: "human", name: "Pat" }, preset: low, now: NOW }, "llm", good);
  assert.equal(res.ok, false);
  assert.match(res.reasons[0], /management level/);
  absent(root, "helper", "helper-rule");
});

test("a rule above the default LLM role does not apply until it is trusted; accepting does not trust it", async () => {
  const root = repo();
  const params = { role: { id: "boss", title: "Boss", level: 7, default_mode: "deny", modes: { "info.retrieve": "allow" } }, rule: { id: "boss-rule", match: { agent_type: "boss" } }, marked: ["level"] };
  const r = send(root, params);
  assert.equal(r.ok, true, r.reasons.join());
  assert.match(readRequest(root, r.request!.id)!.diff!, /needs local trust: true \(accepting does not trust it\)/);
  assert.equal((await acceptRequest(as(root, admin), r.request!.id)).ok, true);
  sh(root, "add", "-A"); sh(root, "commit", "-q", "-m", "roles");
  const ctx = (a: Actor) => ({ root, actor: a, preset: activePreset(root) });
  assert.equal(roleApprove(ctx(admin), "boss").ok, true);
  assert.equal(ruleApprove(ctx(admin), "boss-rule").ok, true);
  assert.equal(resolveLlmRole(root, { agent_type: "boss" }), "llm");
  assert.equal(ruleTrust(ctx(person), "boss-rule").ok, true);
  assert.equal(resolveLlmRole(root, { agent_type: "boss" }), "boss");
});

test("cap: a mode above the proposer's own is refused unless marked, named in the preview, and re-checked on accept", async () => {
  const root = repo();
  assert.equal(activePreset(root).llm.modes["spec.edit.feature"], "request-user");
  const unmarked = send(root, wide);
  assert.equal(unmarked.ok, false);
  assert.match(unmarked.reasons[0], /spec\.edit\.feature.*more permissive.*marked/);
  assert.equal(list(root).length, 0);
  const r = send(root, { ...wide, marked: ["spec.edit.feature"] });
  assert.equal(r.ok, true, r.reasons.join());
  const diff = readRequest(root, r.request!.id)!.diff!;
  assert.match(diff, /spec\.edit\.feature: allow \(llm has request-user\) \[marked by the proposer/);
  absent(root, "wide", "wide-rule");
  // Accept re-checks the cap: the same unmarked parameters are refused by the accepting operation.
  const again = roleProposeAccept({ root, actor: admin, preset: activePreset(root), now: NOW }, "llm", wide);
  assert.equal(again.ok, false);
  absent(root, "wide", "wide-rule");
  assert.equal((await acceptRequest(as(root, admin), r.request!.id)).ok, true);
  assert.equal(fs.existsSync(path.join(root, roleFile("wide"))), true);
});

test("cap: a level equal to the proposer's is named and refused unless marked", () => {
  const root = repo();
  const level5 = { ...good, role: { ...good.role, level: 5 } };
  const r = send(root, level5);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /level 5 is not below the llm level \(5\)/);
  const ok = send(root, { ...level5, marked: ["level"] });
  assert.equal(ok.ok, true, ok.reasons.join());
  assert.match(readRequest(root, ok.request!.id)!.diff!, /level 5 \(llm level 5\) \[marked/);
});

test("a role or rule that already exists is refused", async () => {
  const root = repo();
  const r = send(root, good);
  assert.equal((await acceptRequest(as(root, admin), r.request!.id)).ok, true);
  const again = send(root, good);
  assert.equal(again.ok, false);
  assert.match(again.reasons[0], /already exists/);
});

test("harness: role.propose sends a request under request user, refuses under deny, and writes nothing", async () => {
  const root = repo();
  const rt = createActionRuntime({ root, id: "s", reportsContext: false, model: "m", now: NOW });
  const r = await rt.call("role.propose", { ...good, reason: "need a helper" });
  assert.equal(r.ok, true, r.findings.join());
  assert.ok(r.request);
  absent(root, "helper", "helper-rule");
  const capped = await rt.call("role.propose", wide);
  assert.equal(capped.ok, false);
  assert.match(capped.findings.join(), /marked/);
  assert.equal((await rt.call("role.propose", { role: good.role })).ok, false);
});
