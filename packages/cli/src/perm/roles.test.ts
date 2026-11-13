import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { activePreset, cliRole, mode, osUserName, switchRole, type Actor, type Preset } from "./permissions.js";
import { PRESETS } from "./permissions.js";
import { resolveLlmRole } from "./llm-rules.js";
import {
  mapUser, roleApprove, roleCreate, roleDelete, roleEdit, roleList, roleShow, ruleApprove, ruleCreate, ruleEdit, ruleDelete, ruleList, ruleShow, ruleTrust, unmapUser, type RoleCtx,
} from "./role-ops.js";
import { roleFile, ruleFile, roleFingerprint } from "./roles.js";
import { appendRecords, makeRecord } from "../spec/notes.js";
import { headCommit } from "../spec/source.js";
import { validateProject } from "../verify/validate.js";
import { loadSettings } from "../config.js";
import { makeRepo } from "../test-repo.js";

/** Custom roles, levels, mappings and LLM role rules against `roles-and-permissions` R43, R44, R44.1, R48, R49, R60. */

const person: Actor = { role: "standard-user", kind: "human", name: "Pat" };
const admin: Actor = { role: "administrator", kind: "human", name: "Pat" };
const llm: Actor = { role: "llm", kind: "llm", name: "claude" };

function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "permissions:\n  preset: architecture-level-llm-control\n" });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  return root;
}
const commit = (root: string): void => { for (const a of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "roles"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0); };
const ctx = (root: string, actor: Actor = person, preset?: Preset): RoleCtx => ({ root, actor, preset: preset ?? activePreset(root) });
/** Create, commit and approve a role as the Administrator so it applies. */
function applied(root: string, id: string, level: number, modes: string[] = []): void {
  assert.equal(roleCreate(ctx(root, admin), id, { level, defaultMode: "deny", sets: modes }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root, admin), id).ok, true);
}

test("the management and system permissions are fixed for the default roles and never come from a preset or a default mode", () => {
  for (const p of PRESETS) {
    assert.equal(mode(p, "standard-user", "role.manage"), "allow");
    assert.equal(mode(p, "standard-user", "role.map"), "deny");
    assert.equal(mode(p, "llm", "role.manage"), "deny");
    assert.equal(mode(p, "llm", "role.map"), "deny");
    assert.equal(mode(p, "administrator", "role.map"), "allow");
  }
  const root = repo();
  applied(root, "wide", 7, ["role.manage=allow"]);
  const preset = activePreset(root);
  assert.equal(mode(preset, "wide", "role.manage"), "allow");
  assert.equal(mode(preset, "wide", "role.map"), "deny");
  // a default mode of allow reaches no management, system or protected permission
  assert.equal(roleCreate(ctx(root, admin), "open", { level: 3, defaultMode: "allow" }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root, admin), "open").ok, true);
  const p2 = activePreset(root);
  assert.equal(mode(p2, "open", "spec.edit.feature"), "allow");
  for (const x of ["role.manage", "role.map", "override.status"]) assert.equal(mode(p2, "open", x), "deny");
  assert.equal(mode(p2, "ghost", "spec.edit.feature"), "deny");
});

test("a custom role is pending until approved: it does not apply, and an edit keeps the last approved version", () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "triage", { level: 4, defaultMode: "deny", sets: ["spec.edit.feature=request-user"] }).ok, true);
  assert.ok(fs.existsSync(path.join(root, roleFile("triage"))));
  assert.equal(activePreset(root).customRoles, undefined, "uncommitted: not read");
  commit(root);
  assert.equal(activePreset(root).customRoles, undefined, "committed but never approved: pending");
  assert.ok(loadSettings(root).findings.some((f) => /pending approval and does not apply/.test(f.message)));
  assert.equal(roleApprove(ctx(root), "triage").ok, true);
  assert.equal(mode(activePreset(root), "triage", "spec.edit.feature"), "request-user");
  // edit and commit: pending change, the approved version still applies
  assert.equal(roleEdit(ctx(root), "triage", { sets: ["spec.edit.feature=allow"] }).ok, true);
  commit(root);
  assert.equal(mode(activePreset(root), "triage", "spec.edit.feature"), "request-user");
  assert.ok(loadSettings(root).findings.some((f) => /change to role `triage` is pending/.test(f.message)));
  assert.equal(roleList(root).data && (roleList(root).data as Array<{ id: string; state: string }>).find((r) => r.id === "triage")?.state, "pending-change");
  assert.equal(roleApprove(ctx(root), "triage").ok, true);
  assert.equal(mode(activePreset(root), "triage", "spec.edit.feature"), "allow");
  // approval covers committed content only
  assert.equal(roleEdit(ctx(root), "triage", { title: "Triage" }).ok, true);
  const r = roleApprove(ctx(root), "triage");
  assert.equal(r.ok, false);
});

test("management levels: a role changes only roles below its level, never its own, and an LLM cannot manage roles", () => {
  const root = repo();
  applied(root, "peer", 10);
  applied(root, "low", 3);
  // the Standard User (10): may manage level 3, not the level 10 role, not level 10 creation
  assert.equal(roleEdit(ctx(root), "low", { title: "Low" }).ok, true);
  const peer = roleEdit(ctx(root), "peer", { title: "Peer" });
  assert.equal(peer.ok, false);
  assert.match(peer.reasons[0], /management level/);
  assert.equal(roleCreate(ctx(root), "same", { level: 10, defaultMode: "deny" }).ok, false);
  assert.equal(roleCreate(ctx(root), "above", { level: 11, defaultMode: "deny" }).ok, false);
  assert.equal(roleDelete(ctx(root), "peer").ok, false);
  assert.equal(roleCreate(ctx(root, admin), "top", { level: 99, defaultMode: "deny" }).ok, true);
  // the LLM role has no management permission
  const l = roleEdit(ctx(root, llm), "low", { title: "x" });
  assert.equal(l.ok, false);
  assert.match(l.reasons[0], /role\.manage/);
  assert.equal(roleCreate(ctx(root, llm), "mine", { level: 1, defaultMode: "deny" }).ok, false);
  // a custom role with role.manage at level 8: edits the level 3 role, not itself, not a role at its level
  applied(root, "manager", 8, ["role.manage=allow"]);
  applied(root, "same-as-manager", 8);
  const mgr = ctx(root, { role: "manager", kind: "human", name: "Pat" });
  assert.equal(roleEdit(mgr, "low", { title: "By manager" }).ok, true);
  assert.match(roleEdit(mgr, "manager", { title: "self" }).reasons[0], /own|management level/);
  assert.match(roleEdit(mgr, "same-as-manager", { title: "peer" }).reasons[0], /management level/);
  // an invalid level is refused
  assert.equal(roleCreate(ctx(root, admin), "bad", { level: 100, defaultMode: "deny" }).ok, false);
  assert.equal(roleCreate(ctx(root, admin), "bad", { level: 2.5, defaultMode: "deny" }).ok, false);
});

test("a role cannot hand out a permission mode more permissive than its own, and approval obeys level and the same limit", () => {
  const root = repo();
  // the Standard User has deny for override.status, so cannot create a role that allows it
  const r = roleCreate(ctx(root), "strong", { level: 3, defaultMode: "deny", sets: ["override.status=allow"] });
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /override\.status/);
  // the Administrator may; a level 10 approver may not approve it
  assert.equal(roleCreate(ctx(root, admin), "strong", { level: 3, defaultMode: "deny", sets: ["override.status=allow"] }).ok, true);
  commit(root);
  const a = roleApprove(ctx(root), "strong");
  assert.equal(a.ok, false);
  assert.match(a.reasons[0], /override\.status/);
  assert.equal(roleApprove(ctx(root, admin), "strong").ok, true);
  // request-user does not stand in for role.manage
  applied(root, "asker", 6, ["role.manage=request-user"]);
  const q = roleCreate(ctx(root, { role: "asker", kind: "human", name: "Pat" }), "z", { level: 2, defaultMode: "deny" });
  assert.equal(q.ok, false);
  assert.match(q.reasons[0], /cannot be sent as a request/);
});

test("OS user mapping is local, optional and bound by levels; the Administrator is exempt for users only", () => {
  const root = repo();
  const me = osUserName();
  applied(root, "worker", 6);
  applied(root, "mapper", 8, ["role.map=allow"]);
  const mapper = ctx(root, { role: "mapper", kind: "human", name: "Pat" });
  // no mapping: Standard User, anyone may switch
  assert.equal(cliRole(root), "standard-user");
  switchRole(root, "administrator");
  assert.equal(cliRole(root), "administrator");
  switchRole(root, "standard-user");
  // the Standard User lacks the system permission; a mapper may map below its level only
  assert.match(mapUser(ctx(root), me, "worker").reasons[0], /role\.map/);
  assert.equal(mapUser(mapper, "sam", "worker").ok, true);
  assert.match(mapUser(mapper, "sam", "mapper").reasons[0], /management level/);
  assert.match(mapUser(mapper, "sam", "standard-user").reasons[0], /management level/, "level 10 is above the mapper's 8");
  assert.match(mapUser(mapper, "sam", "administrator").reasons[0], /Administrator/);
  assert.match(mapUser(mapper, "sam", "worker", true).reasons[0], /Administrator only/);
  assert.match(mapUser(mapper, "sam", "ghost").reasons[0], /does not apply/);
  // not stored in git: the mapping lives in the local store, nothing in the tree changes
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: root }).stdout.toString().trim(), "");
  // the Administrator may map to a role at or above any level, and allow the switch
  assert.equal(mapUser(ctx(root, admin), me, "worker", true).ok, true);
  assert.equal(cliRole(root), "worker");
  switchRole(root, "administrator");
  assert.equal(cliRole(root), "administrator");
  switchRole(root, "standard-user");
  // with a mapping, a user without the switch permission cannot become the Administrator
  assert.equal(mapUser(ctx(root, admin), me, "worker").ok, true);
  assert.throws(() => switchRole(root, "administrator"), /does not let this operating system user switch/);
  assert.equal(cliRole(root), "worker");
  // a deletion stays pending until approved, then gives the Standard User
  fs.rmSync(path.join(root, roleFile("worker")));
  commit(root);
  assert.equal(cliRole(root), "worker");
  assert.equal(roleApprove(ctx(root, admin), "worker").ok, true);
  assert.equal(cliRole(root), "standard-user");
});

test("removing the last mapping restores the default; unmapping obeys levels", () => {
  const root = repo();
  applied(root, "worker", 6);
  assert.equal(mapUser(ctx(root), "sam", "worker").ok, false, "Standard User has no role.map");
  assert.equal(mapUser(ctx(root, admin), "sam", "worker").ok, true);
  assert.equal(unmapUser(ctx(root, admin), "ghost").ok, false);
  assert.equal(unmapUser(ctx(root, admin), "sam").ok, true);
  assert.equal(cliRole(root), "standard-user");
});

test("LLM role rules: approved, applicable and, above the default LLM role, trusted locally; otherwise the default LLM role", () => {
  const root = repo();
  applied(root, "reviewer", 9);
  applied(root, "helper", 2);
  // an LLM cannot create rules; a person without role.map cannot either; the Administrator can, but not for the Administrator role
  assert.equal(ruleCreate(ctx(root, llm), "r0", { role: "helper", matches: ["subagent=x"] }).ok, false);
  assert.equal(ruleCreate(ctx(root), "r0", { role: "helper", matches: ["subagent=x"] }).ok, false);
  assert.match(ruleCreate(ctx(root, admin), "r0", { role: "administrator", matches: ["subagent=x"] }).reasons[0], /Administrator/);
  assert.equal(ruleCreate(ctx(root, admin), "r0", { role: "helper", matches: [] }).ok, false);
  assert.equal(ruleCreate(ctx(root, admin), "review", { role: "reviewer", matches: ["subagent=code-reviewer", "provider=anthropic"], priority: 5 }).ok, true);
  assert.equal(ruleCreate(ctx(root, admin), "small", { role: "helper", matches: ["agent_type=explore*"] }).ok, true);
  assert.ok(fs.existsSync(path.join(root, ruleFile("review"))));
  const f = { subagent: "code-reviewer", provider: "anthropic", agent_type: "general" };
  assert.equal(resolveLlmRole(root, f), "llm", "uncommitted");
  commit(root);
  assert.equal(resolveLlmRole(root, f), "llm", "not approved");
  assert.equal(ruleApprove(ctx(root), "review").ok, true, "level 10 is above the role at 9");
  assert.equal(resolveLlmRole(root, f), "llm", "above the default LLM role and not trusted here");
  assert.equal(ruleTrust(ctx(root, llm), "review").ok, false);
  assert.equal(ruleTrust(ctx(root), "review").ok, true);
  assert.equal(resolveLlmRole(root, f), "reviewer");
  assert.equal(resolveLlmRole(root, { ...f, provider: "openai" }), "llm", "all factors must match");
  // below-LLM-level rule needs approval only
  assert.equal(resolveLlmRole(root, { agent_type: "explorer" }), "llm");
  assert.equal(ruleApprove(ctx(root, admin), "small").ok, true);
  assert.equal(resolveLlmRole(root, { agent_type: "explorer" }), "helper");
  // changing the role's level voids the trust; the actor role of a harness call follows
  const next = activePreset(root);
  assert.equal(mode(next, "reviewer", "spec.edit.feature"), "deny");
});


test("role deletion needs committed absence and approval; deleted approvals never resurrect the role", () => {
  const root = repo();
  applied(root, "worker", 12, ["spec.edit.feature=allow"]);
  const text = fs.readFileSync(path.join(root, roleFile("worker")), "utf8");
  assert.equal(roleDelete(ctx(root, admin), "worker").ok, true);
  assert.equal(roleApprove(ctx(root, admin), "worker").ok, false, "uncommitted deletion");
  commit(root);
  assert.equal(mode(activePreset(root), "worker", "spec.edit.feature"), "allow");
  assert.match(roleList(root).lines.join("\n"), /worker.*pending-deletion/);
  assert.match(roleShow(root, "worker").lines[0], /pending-deletion/);
  assert.ok(validateProject(root).findings.some((f) => f.severity === "warning" && /deletion of role `worker` is pending/.test(f.message)));
  assert.equal(roleApprove(ctx(root), "worker").ok, false, "level must cover the approved role");
  assert.equal(roleApprove(ctx(root, llm), "worker").ok, false, "management permission required");
  fs.writeFileSync(path.join(root, roleFile("worker")), text);
  assert.equal(roleApprove(ctx(root, admin), "worker").ok, false, "uncommitted restoration");
  fs.rmSync(path.join(root, roleFile("worker")));
  assert.equal(roleApprove(ctx(root, admin), "worker").ok, true);
  assert.equal(roleShow(root, "worker").ok, false);
  assert.equal(activePreset(root).customRoles?.worker, undefined);
  commit(root);
  assert.equal(activePreset(root).customRoles?.worker, undefined, "older approval stays retired");
  fs.writeFileSync(path.join(root, roleFile("worker")), text);
  commit(root);
  assert.match(roleShow(root, "worker").lines[0], /pending: no effective approval/);
  assert.equal(activePreset(root).customRoles?.worker, undefined, "recreation needs approval");
  assert.equal(roleApprove(ctx(root, admin), "worker").ok, true);
  assert.equal(mode(activePreset(root), "worker", "spec.edit.feature"), "allow");
});

test("pending rule edits retain approved matching, priority and trust until replacement is approved", () => {
  const root = repo();
  applied(root, "reviewer", 9);
  applied(root, "helper", 2);
  assert.equal(ruleCreate(ctx(root, admin), "review", { role: "reviewer", priority: 8, matches: ["subagent=old"] }).ok, true);
  assert.equal(ruleCreate(ctx(root, admin), "fallback", { role: "helper", priority: 2, matches: ["subagent=old"] }).ok, true);
  commit(root);
  assert.ok(validateProject(root).findings.some((f) => /LLM role rule `review` is pending/.test(f.message)));
  assert.equal(ruleApprove(ctx(root), "review").ok, true);
  assert.equal(ruleApprove(ctx(root), "fallback").ok, true);
  assert.equal(ruleTrust(ctx(root), "review").ok, true);
  assert.equal(ruleEdit(ctx(root, admin), "review", { priority: 0, matches: ["subagent=new"] }).ok, true);
  assert.equal(ruleApprove(ctx(root), "review").ok, false, "uncommitted edit");
  commit(root);
  assert.equal(resolveLlmRole(root, { subagent: "old" }), "reviewer");
  assert.equal(resolveLlmRole(root, { subagent: "new" }), "llm");
  assert.match(ruleList(root).lines.join("\n"), /review.*priority 8.*pending-change.*applies/);
  assert.match(ruleShow(root, "review").lines.join("\n"), /pending-change/);
  assert.ok(validateProject(root).findings.some((f) => /change to LLM role rule `review` is pending/.test(f.message)));
  assert.equal(ruleApprove(ctx(root), "review").ok, true);
  assert.equal(resolveLlmRole(root, { subagent: "old" }), "helper");
  assert.equal(resolveLlmRole(root, { subagent: "new" }), "llm", "new approved content requires new local trust");
  assert.equal(ruleTrust(ctx(root), "review").ok, true);
  assert.equal(resolveLlmRole(root, { subagent: "new" }), "reviewer");
});

test("legacy rule approvals recover from git; deletion and downgrade approval check the effective role", () => {
  const root = repo();
  applied(root, "high", 12);
  applied(root, "low", 2);
  applied(root, "mapper", 8, ["role.map=allow"]);
  assert.equal(ruleCreate(ctx(root, admin), "review", { role: "high", matches: ["subagent=review"] }).ok, true);
  commit(root);
  const file = path.join(root, ruleFile("review"));
  const original = fs.readFileSync(file, "utf8");
  // Older rule approval notes do not carry content.
  appendRecords(root, headCommit(root)!, [makeRecord("approval", "role-rule/review", roleFingerprint(original)!, { by: { human: "Pat", role: "administrator" }, cited: {} })]);
  assert.equal(ruleTrust(ctx(root), "review").ok, true);
  assert.equal(ruleEdit(ctx(root, admin), "review", { role: "low" }).ok, true);
  commit(root);
  assert.equal(resolveLlmRole(root, { subagent: "review" }), "high");
  assert.equal(ruleApprove(ctx(root), "review").ok, false, "cannot approve a downgrade of a higher role's rule");
  const mapper = ctx(root, { role: "mapper", kind: "human", name: "Pat" });
  assert.equal(ruleDelete(mapper, "review").ok, false);
  assert.equal(ruleEdit(mapper, "review", { priority: 3 }).ok, false);
  assert.equal(ruleDelete(ctx(root, admin), "review").ok, true);
  assert.equal(ruleApprove(ctx(root, admin), "review").ok, false, "uncommitted deletion");
  commit(root);
  assert.equal(resolveLlmRole(root, { subagent: "review" }), "high");
  assert.match(ruleList(root).lines.join("\n"), /review.*pending-deletion.*applies/);
  assert.match(ruleShow(root, "review").lines.join("\n"), /pending-deletion/);
  assert.ok(validateProject(root).findings.some((f) => /deletion of LLM role rule `review` is pending/.test(f.message)));
  assert.equal(ruleApprove(ctx(root), "review").ok, false);
  assert.equal(ruleApprove(ctx(root, llm), "review").ok, false);
  fs.writeFileSync(file, original);
  assert.equal(ruleApprove(ctx(root, admin), "review").ok, false, "uncommitted restoration");
  fs.rmSync(file);
  assert.equal(ruleApprove(ctx(root, admin), "review").ok, true);
  assert.equal(resolveLlmRole(root, { subagent: "review" }), "llm");
  assert.equal(ruleShow(root, "review").ok, false);
  commit(root);
  assert.equal(resolveLlmRole(root, { subagent: "review" }), "llm");
  fs.writeFileSync(file, original);
  commit(root);
  assert.equal(resolveLlmRole(root, { subagent: "review" }), "llm", "recreation needs approval");
  assert.match(ruleShow(root, "review").lines.join("\n"), /state: pending;/);
});


test("malformed replacements keep approved definitions and cannot be approved as deletions", () => {
  const root = repo();
  applied(root, "helper", 2, ["spec.edit.feature=allow"]);
  assert.equal(ruleCreate(ctx(root, admin), "help", { role: "helper", matches: ["agent_type=explore"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "help").ok, true);
  fs.writeFileSync(path.join(root, roleFile("helper")), "id: helper\nmanagement_level: invalid\n");
  fs.writeFileSync(path.join(root, ruleFile("help")), "id: help\nmatch: {}\n");
  commit(root);
  assert.equal(mode(activePreset(root), "helper", "spec.edit.feature"), "allow");
  assert.equal(resolveLlmRole(root, { agent_type: "explore" }), "helper");
  assert.match(roleShow(root, "helper").lines[0], /pending-change/);
  assert.match(ruleShow(root, "help").lines.join("\n"), /pending-change/);
  assert.equal(roleApprove(ctx(root, admin), "helper").ok, false);
  assert.equal(ruleApprove(ctx(root, admin), "help").ok, false);
  const findings = validateProject(root).findings;
  for (const file of [roleFile("helper"), ruleFile("help")]) {
    assert.ok(findings.some((f) => f.message.includes(file) && f.severity === "error" && /malformed/.test(f.message)));
  }
});


test("pending and approved deletions follow branch history, not the shared notes ref alone", () => {
  const root = repo();
  assert.equal(spawnSync("git", ["branch", "empty"], { cwd: root }).status, 0);
  applied(root, "helper", 2);
  assert.equal(ruleCreate(ctx(root, admin), "help", { role: "helper", matches: ["agent_type=explore"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "help").ok, true);
  assert.equal(spawnSync("git", ["checkout", "-q", "-b", "remove"], { cwd: root }).status, 0);
  assert.equal(ruleDelete(ctx(root, admin), "help").ok, true);
  assert.equal(roleDelete(ctx(root, admin), "helper").ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "help").ok, true);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(spawnSync("git", ["checkout", "-q", "main"], { cwd: root }).status, 0);
  assert.equal(resolveLlmRole(root, { agent_type: "explore" }), "helper", "another branch's deletion does not retire this definition");
  assert.match(roleShow(root, "helper").lines[0], /custom, approved/);
  assert.equal(spawnSync("git", ["checkout", "-q", "empty"], { cwd: root }).status, 0);
  assert.equal(activePreset(root).customRoles, undefined, "no deletion when the branch never contained the file");
  assert.equal(ruleShow(root, "help").ok, false);
  assert.equal(resolveLlmRole(root, { agent_type: "explore" }), "llm");
});
