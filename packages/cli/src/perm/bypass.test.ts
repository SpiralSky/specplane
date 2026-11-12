import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { cliActor, switchRole } from "./permissions.js";
import { BYPASS_MEASURES, bypassFindings, bypassGuardOn, bypassSettings, envFactors, llmMarked } from "./bypass.js";
import { roleApprove, roleCreate, ruleApprove, ruleCreate, ruleTrust } from "./role-ops.js";
import { activePreset } from "./permissions.js";
import { loadSettings } from "../config.js";
import { getAdapter } from "../harness/adapter.js";
import "../harness/adapters.js";
import { inspectInstallation } from "../harness/install.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeRepo } from "../test-repo.js";

/** Permission bypass guards against `roles-and-permissions` R58 (core side; the hooks have their own tests). */

function repo(config = "permissions:\n  preset: architecture-level-llm-control\n"): string {
  const root = makeRepo({ ".specplane/config.yaml": config });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  return root;
}
const marked = { SPECPLANE_ACTOR: "llm", SPECPLANE_MODEL: "opus", SPECPLANE_SESSION: "s1" };

test("a marked process runs as the LLM, not as the person, even after the Administrator switch", () => {
  const root = repo();
  switchRole(root, "administrator");
  assert.equal(cliActor(root, {}).role, "administrator");
  const a = cliActor(root, marked);
  assert.deepEqual([a.kind, a.role, a.model, a.session], ["llm", "llm", "opus", "s1"]);
  assert.equal(llmMarked({ SPECPLANE_ACTOR: " LLM " }), true);
  assert.equal(llmMarked({ SPECPLANE_ACTOR: "human" }), false);
});

test("a marked process cannot switch roles, as its actor is an LLM", () => {
  const root = repo();
  assert.throws(() => switchRole(root, "administrator", cliActor(root, marked)), /LLM cannot switch/);
});

test("llm_marker off leaves a marked process as the person", () => {
  const root = repo("bypass_guards:\n  llm_marker: off\n");
  assert.equal(bypassGuardOn(root, "llm_marker"), false);
  assert.equal(cliActor(root, marked).kind, "human");
});

test("a marked process takes the role the LLM role rules give from the environment, with trust", () => {
  const root = repo();
  const person = { role: "administrator", kind: "human", name: "Pat" } as const;
  const c = { root, actor: person, preset: activePreset(root) };
  const commit = (): void => { for (const a of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "roles"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0); };
  assert.equal(roleCreate(c, "reviewer", { level: 7, defaultMode: "deny", sets: [] }).ok, true);
  commit();
  assert.equal(roleApprove(c, "reviewer").ok, true);
  assert.equal(ruleCreate(c, "claude-reviewer", { role: "reviewer", priority: 1, matches: ["subagent=reviewer"] }).ok, true);
  commit();
  assert.equal(ruleApprove(c, "claude-reviewer").ok, true);
  assert.equal(cliActor(root, { ...marked, SPECPLANE_SUBAGENT: "reviewer" }).role, "llm", "untrusted: above the default LLM role needs local trust");
  assert.equal(ruleTrust(c, "claude-reviewer").ok, true);
  assert.equal(cliActor(root, { ...marked, SPECPLANE_SUBAGENT: "reviewer" }).role, "reviewer");
  assert.equal(cliActor(root, marked).role, "llm");
  assert.deepEqual(envFactors({ SPECPLANE_PROVIDER: "anthropic", SPECPLANE_DELEGATED_BY: "x" }).factors, { provider: "anthropic", delegated: true });
});

test("settings: each measure is on unless stated off; findings name unknown and disabled measures", () => {
  assert.deepEqual(bypassSettings("bypass_guards:\n  headless_block: off\n"), { headless_block: false });
  assert.deepEqual(bypassSettings(null), {});
  assert.deepEqual(bypassFindings({}), []);
  const f = bypassFindings({ headless_block: false, nonsense: true });
  assert.equal(f.length, 2);
  assert.match(f[0], /`headless_block` is off/);
  assert.match(f[1], /names no bypass guard/);
  const root = repo("bypass_guards:\n  store_protect: off\n  nonsense: on\n");
  const msgs = loadSettings(root).findings.filter((x) => x.key === "bypass_guards").map((x) => x.message);
  assert.equal(msgs.length, 2);
  assert.equal(loadSettings(repo()).findings.filter((x) => x.key === "bypass_guards").length, 0);
  assert.equal(BYPASS_MEASURES.length, 6);
});

test("the Claude adapter claims the bypass guards only with the hook installed; Codex reports the gap", () => {
  const root = repo();
  assert.equal(getAdapter("claude")!.capabilities(root)["bypass-guards"], false);
  assert.equal(getAdapter("codex")!.capabilities(root)["bypass-guards"], false);
});

test("validation warns when the Claude hooks are installed without the bypass-guard hook, unless every hook measure is off", () => {
  const root = repo();
  fs.mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"), "#!/bin/sh\n");
  assert.ok(inspectInstallation(root).some((f) => /bypass-guard/.test(f.file)));
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-bypass-guard.sh"), "#!/bin/sh\n");
  assert.ok(!inspectInstallation(root).some((f) => /bypass-guard/.test(f.file)));
});
