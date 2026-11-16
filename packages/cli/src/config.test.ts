import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, SETTINGS, parseConfig, loadSettings } from "./config.js";
import { editConfig } from "./config-edit.js";
import { clearEffects, registerEffect } from "./config-effects.js";
import { configGet, configList, configSet, configUnset, type ConfigCtx } from "./config-ops.js";
import { PERMISSION_DOCS, undocumentedPermissions } from "./perm/catalog.js";
import { describePermission, listPermissions } from "./perm/docs.js";
import { CATALOG, DEFAULT_PRESET, activePreset, cliActor, PRESETS, mode } from "./perm/permissions.js";
import { loadSpecPaths } from "./spec/paths.js";
import { makeRepo } from "./test-repo.js";

const SPEC = fs.readFileSync(new URL("../../../docs/specifications/features/configuration.md", import.meta.url), "utf8");
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");

function repo(config?: string): string {
  const root = makeRepo(config === undefined ? { "README.md": "x\n" } : { ".specplane/config.yaml": config });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat Person"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) {
    assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  }
  return root;
}
function commitAll(root: string, msg = "config"): void {
  for (const a of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", msg]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
}
const ctxFor = (root: string, role: "standard-user" | "llm" | "administrator" = "standard-user"): ConfigCtx => ({
  root, actor: { role, kind: role === "llm" ? "llm" : "human", name: "Pat Person" }, preset: DEFAULT_PRESET, now: new Date("2026-11-10T12:00:00Z"),
});
const file = (root: string) => path.join(root, ".specplane/config.yaml");
const auditLines = (root: string): Record<string, any>[] => {
  const dir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).stdout.trim();
  return fs.readFileSync(path.join(dir, "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
};

test("every setting named in configuration R25 is defined, and nothing else is", () => {
  const table = [...SPEC.matchAll(/^\| `([^`]+)`(?: and `([^`]+)`)? \|/gm)].flatMap((m) => [m[1], m[2]]).filter(Boolean) as string[];
  const named = new Set(table.filter((k) => k !== "Setting" && k !== "roles.os_user_mapping" && k !== "roles.llm_rules")); // not settings: a local mapping and rule files (file-formats §7.4)
  const defined = new Set(SETTINGS.map((s) => s.key));
  for (const k of named) {
    const base = k.replace(/\.<[^>]+>$/, "");
    assert.ok(defined.has(base) || (base === "strict_mode" && defined.has("strict_mode.enabled")), `setting ${k} from the spec is not defined`);
  }
  for (const k of defined) {
    const root = k.split(".")[0];
    assert.ok([...named].some((n) => n === k || n.startsWith(`${k}.`) || n.startsWith(`${root}.`) || n === root) || k.startsWith("paths.") || k === "harness.install_block", `defined setting ${k} is not in the spec`);
  }
});

test("defaults equal the defaults of configuration R25 and file-formats §6.1", () => {
  const d = DEFAULT_SETTINGS;
  assert.equal(d.plans.startConditions, true);
  assert.equal(d.plans.parallelism, 1);
  assert.equal(d.plans.worktreeDir, null);
  assert.equal(d.plans.setupCommand, null);
  assert.equal(d.permissionsPreset, "architecture-level-llm-control");
  assert.equal(d.autoWarn, true);
  assert.equal(d.auditRetention, 30);
  const v = d.values;
  assert.equal(v["notifications.push"], false);
  assert.deepEqual(v["notifications.push_permissions"], ["all"]);
  assert.deepEqual(v["steering.custom"], []);
  assert.equal(v["harness.separation_check"], true);
  assert.equal(v["harness.retrieval_include_references"], false);
  assert.equal(v["harness.install_block"], true);
  assert.equal(v["authorship.record_llm"], true);
  assert.equal(v["architecture.llm_may_mark_implemented"], true);
  assert.equal(v["tests.logs"], "local");
  assert.equal(v["tests.logs_retention"], 30);
  assert.equal(v["pre_commit.duplicate_requirement_ids"], false);
  assert.equal(v["pre_commit.tests"], false);
  assert.deepEqual(v["coverage.requirement_only"], []);
  assert.equal(v["decisions.enabled"], false);
  assert.equal(v["strict_mode.enabled"], false);
  assert.deepEqual(d.paths, { requirements: "docs/requirements", requirementsIndex: null, features: "docs/specifications/features", architecture: "docs/specifications/architecture", testLogs: "docs/test-logs" });
  assert.equal(d.plans.dir, "docs/plans");
  assert.equal(parseConfig(null).findings.length, 0);
  assert.equal(parseConfig("").config.autoWarn, true);
});

test("validation reports an unknown setting and a malformed one by name, and the defaults apply", () => {
  const { config, findings } = parseConfig("mystery: 1\nauto_warn: maybe\naudit:\n  retention: 0\ntests:\n  logs: cloud\n");
  const msgs = findings.map((f) => f.message).join("\n");
  assert.match(msgs, /unknown setting `mystery`/);
  assert.match(msgs, /setting `auto_warn` is malformed: "maybe" is not on or off; allowed: on or off/);
  assert.match(msgs, /`audit.retention`.*above 0/);
  assert.match(msgs, /`tests.logs`.*local, git, off/);
  assert.equal(config.autoWarn, true);
  assert.equal(config.auditRetention, 30);
  assert.equal(config.values["tests.logs"], "local");
});

test("old-model terms are reported as unknown and not read", () => {
  const { findings, config } = parseConfig("spec_roots:\n  - name: base\n    path: x\nspecs:\n  feature:\n    llm_role: none\nexecution:\n  backend: branch\nauthorship:\n  record_llm: off\n  forbid_architecture: true\ndecisions:\n  dir: d\n");
  const keys = findings.map((f) => f.key);
  for (const k of ["spec_roots", "specs.feature.llm_role", "execution.backend", "authorship.forbid_architecture", "decisions.dir"]) assert.ok(keys.includes(k), `${k} not reported: ${keys}`);
  assert.ok(findings.filter((f) => f.severity === "warning").every((f) => /retired model/.test(f.message)));
  assert.equal(config.values["authorship.record_llm"], false);
});

test("bad paths, presets and permissions are malformed", () => {
  const { findings, config } = parseConfig("paths:\n  features: ../outside\n  requirements: docs/specifications/features/inner\npermissions:\n  preset: Not A Name\nnotifications:\n  push_permissions: [spec.approve.feature, made.up]\n  push: on\nplans:\n  parallelism: 1.5\n");
  const keys = findings.filter((f) => f.severity === "error").map((f) => f.key).sort();
  assert.deepEqual(keys, ["notifications.push_permissions", "paths.features", "permissions.preset", "plans.parallelism"].sort().concat(keys.includes("paths.requirements") ? ["paths.requirements"] : []).sort());
  assert.equal(config.values["notifications.push"], true);
  assert.equal(config.permissionsPreset, "architecture-level-llm-control");
});

test("overlapping folders are malformed and the later key falls back", () => {
  const { findings, config } = parseConfig("paths:\n  features: docs/specifications/architecture/sub\n");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /overlaps/);
  assert.equal(config.paths.features, "docs/specifications/features");
});

test("settings with entries are accepted without being unknown; dynamic entries are kept", () => {
  const { findings, config } = parseConfig("strict_mode:\n  enabled: on\n  git: off\nbypass_guards:\n  headless_block: on\nharness:\n  instructions:\n    plan-step: use this text\nsubprojects:\n  - {name: a, path: sub/a}\n  - {name: b, path: sub/b}\n");
  assert.deepEqual(findings, []);
  assert.equal(config.values["strict_mode.enabled"], true);
  assert.deepEqual(config.values["strict_mode"], { git: false });
  assert.deepEqual(config.values["harness.instructions"], { "plan-step": "use this text" });
  assert.equal(parseConfig("roles:\n  os_user_mapping: {a: b}\n").findings.length, 1);
  assert.match(parseConfig("roles:\n  llm_rules: []\n").findings[0].message, /files under \.specplane\/roles\/rules/);
});

test("malformed YAML gives defaults and one error", () => {
  const { findings, config } = parseConfig("a: [\n");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(config.autoWarn, true);
});

test("on and off read the same as true and false; an explicit default is kept as set", () => {
  const { config } = parseConfig("auto_warn: false\nplans:\n  start_conditions: off\nnotifications:\n  push: off\n");
  assert.equal(config.autoWarn, false);
  assert.equal(config.plans.startConditions, false);
  assert.ok(config.set.has("notifications.push"));
});

test("loadSpecPaths reads from the same loader", () => {
  const root = repo("paths:\n  features: specs/f\nplans:\n  dir: plans\n");
  const { paths, findings } = loadSpecPaths(root);
  assert.equal(paths.features, "specs/f");
  assert.equal(paths.plansDir, "plans");
  assert.deepEqual(findings, []);
});

test("this repository's own configuration is valid", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const { findings, config } = loadSettings(root);
  // The maintainers turn `hook_protect` off on purpose (they edit the installed hooks by copying templates), which `validate` reports.
  assert.deepEqual(findings.filter((f) => !(f.key === "bypass_guards" && /`hook_protect` is off/.test(f.message))), []);
  assert.equal(config.plans.dir, "plans");
});

test("editConfig keeps comments, other keys and order", () => {
  const text = "# top\npaths:\n  # keep me\n  features: a/b   # inline\n  architecture: c/d\n\nplans:\n  dir: plans\nauto_warn: on\n";
  const a = editConfig(text, "paths.architecture", "x/y");
  assert.equal(a, text.replace("c/d", "x/y"));
  const b = editConfig(text, "audit.retention", 7);
  assert.equal(b, text + "audit:\n  retention: 7\n");
  const c = editConfig(text, "plans.worktree_dir", "../wt");
  assert.equal(c, text.replace("  dir: plans\n", "  dir: plans\n  worktree_dir: ../wt\n"));
  const d = editConfig(text, "auto_warn", undefined);
  assert.equal(d, text.replace("auto_warn: on\n", ""));
  const e = editConfig(text, "plans.dir", undefined);
  assert.ok(!/plans:/.test(e) && e.includes("# top") && e.includes("# keep me"));
  assert.equal(editConfig("", "auto_warn", "off"), "auto_warn: off\n");
  assert.equal(editConfig("harness: {}\n", "harness.separation_check", "off"), "harness:\n  separation_check: off\n");
  assert.deepEqual(parseConfig(editConfig("", "notifications.push_permissions", ["spec.approve.feature"])).config.values["notifications.push_permissions"], ["spec.approve.feature"]);
});

test("config set and unset: the Standard User changes a setting, audited with old and new", () => {
  const root = repo("# mine\nauto_warn: on\n");
  const r = configSet(ctxFor(root), "auto_warn", "off");
  assert.ok(r.ok && r.written, r.reasons.join());
  assert.equal(fs.readFileSync(file(root), "utf8"), "# mine\nauto_warn: off\n");
  assert.ok(r.lines.includes("Commit it to apply:"));
  assert.ok(r.lines.includes('git add .specplane/config.yaml && git commit -m "config: set auto_warn"'));
  assert.deepEqual((r.data as { uncommitted: string[] }).uncommitted, [".specplane/config.yaml"]);
  assert.equal(loadSettings(root).config.autoWarn, true, "the uncommitted change is ignored");
  commitAll(root);
  assert.equal(loadSettings(root).config.autoWarn, false);
  const last = auditLines(root).at(-1)!;
  assert.deepEqual([last.command, last.permission, last.outcome, last.old, last.new, last.actor.role], ["config set", "config.change", "done", true, false, "standard-user"]);
  const u = configUnset(ctxFor(root), "auto_warn");
  assert.ok(u.ok);
  assert.equal(fs.readFileSync(file(root), "utf8"), "# mine\n");
  commitAll(root);
  assert.equal(loadSettings(root).config.autoWarn, true);
  assert.equal(auditLines(root).at(-1)!.command, "config unset");
});

test("config set creates the file, validates before writing and refuses unknown or bad values", () => {
  const root = repo();
  assert.ok(configSet(ctxFor(root), "audit.retention", "forever").ok);
  assert.equal(fs.readFileSync(file(root), "utf8"), "audit:\n  retention: forever\n");
  const before = fs.readFileSync(file(root), "utf8");
  const bad = configSet(ctxFor(root), "audit.retention", "0");
  assert.ok(!bad.ok && /above 0/.test(bad.reasons[0]));
  assert.ok(!configSet(ctxFor(root), "tests.logs", "cloud").ok);
  assert.ok(!configSet(ctxFor(root), "nonsense", "1").ok);
  assert.ok(!configSet(ctxFor(root), "permissions.preset", "nope").ok);
  assert.ok(!configSet(ctxFor(root), "paths.features", "../x").ok);
  assert.equal(fs.readFileSync(file(root), "utf8"), before);
  assert.ok(configSet(ctxFor(root), "permissions.preset", "full-llm-control").ok);
  assert.ok(configSet(ctxFor(root), "steering.custom", '[{permission: spec.approve.feature, scope: all, text: "Ask first"}]').ok);
  assert.ok(configSet(ctxFor(root), "strict_mode.enabled", "on").ok);
  assert.ok(configSet(ctxFor(root), "strict_mode.edit_block", "off").ok);
  commitAll(root);
  assert.equal(loadSettings(root).findings.length, 0);
});

test("an LLM role needs the user's agreement: nothing changes and a request is sent and audited", () => {
  const root = repo("auto_warn: on\n");
  const r = configSet(ctxFor(root, "llm"), "auto_warn", "off");
  assert.ok(r.ok && r.request && !r.written);
  assert.equal(fs.readFileSync(file(root), "utf8"), "auto_warn: on\n");
  const last = auditLines(root).at(-1)!;
  assert.deepEqual([last.outcome, last.permission, last.actor.role, last.request], ["request-sent", "config.change", "llm", r.request]);
});

test("a role whose configuration permission is deny cannot change the preset", () => {
  const root = repo("auto_warn: on\n");
  const denied = { ...DEFAULT_PRESET, llm: { ...DEFAULT_PRESET.llm, modes: { ...DEFAULT_PRESET.llm.modes, "config.change": "deny" as const } } };
  const r = configSet({ ...ctxFor(root, "llm"), preset: denied }, "permissions.preset", "full-llm-control");
  assert.ok(!r.ok);
  assert.match(r.reasons[0], /does not have/);
  assert.equal(fs.readFileSync(file(root), "utf8"), "auto_warn: on\n");
  assert.equal(auditLines(root).at(-1)!.outcome, "refused");
});

test("the Administrator may change configuration", () => {
  const root = repo();
  assert.ok(configSet(ctxFor(root, "administrator"), "auto_warn", "off").ok);
});

test("config get and list show value, source and default", () => {
  const root = repo("audit:\n  retention: 7\nstrict_mode:\n  enabled: on\n");
  const g = configGet(root, "audit.retention");
  assert.match(g.lines[0], /^audit\.retention = 7 \(set; default 30\)/);
  assert.match(configGet(root, "auto_warn").lines[0], /auto_warn = on \(default; default on\)/);
  assert.match(configGet(root, "plans.worktree_dir").lines[0], /default; default a folder next to the project/);
  assert.doesNotMatch(configGet(root, "plans.parallelism").lines[0], /later release/, "parallelism is built (R31.2)");
  assert.doesNotMatch(configGet(root, "strict_mode.enabled").lines[0], /later release/);
  assert.ok(!configGet(root, "nope").ok);
  const all = configList(root);
  assert.equal((all.data as unknown[]).length, SETTINGS.length);
  assert.equal(configGet(root, undefined).lines.length, SETTINGS.length);
});

test("every catalog permission is documented and the lists agree", () => {
  assert.deepEqual(undocumentedPermissions(), []);
  assert.deepEqual(PERMISSION_DOCS.map((d) => d.id).sort(), [...CATALOG].sort());
  for (const d of PERMISSION_DOCS) assert.ok(d.allows && d.doesNotAllow && d.commands.length && d.steeringKey, d.id);
});

test("default presets state the modes of roles-and-permissions R57 for the Standard User and the LLM", () => {
  const byId = (id: string) => PRESETS.find((p) => p.id === id)!;
  const rows: Array<[string, string, string, string, string]> = [
    ["architecture-level-llm-control", "request-user", "request-user", "allow", "allow"],
    ["full-manual-editing", "deny", "deny", "deny", "request-user"],
    ["feature-level-llm-control", "request-user", "allow", "allow", "allow"],
    ["full-llm-control", "allow", "allow", "allow", "allow"],
  ];
  for (const [id, req, feat, arch, plan] of rows) {
    const p = byId(id);
    for (const a of ["create", "edit", "delete"]) {
      assert.equal(mode(p, "llm", `spec.${a}.requirement`), req, id);
      assert.equal(mode(p, "llm", `spec.${a}.feature`), feat, id);
      assert.equal(mode(p, "llm", `spec.${a}.architecture`), arch, id);
    }
    assert.equal(mode(p, "llm", "plan.create"), plan);
    assert.equal(mode(p, "llm", "plan.edit"), plan);
    assert.equal(mode(p, "llm", "config.change"), "request-user");
    assert.equal(mode(p, "standard-user", "config.change"), "allow");
    for (const o of ["override.status", "override.approver", "override.approval-commit", "override.test"]) assert.equal(mode(p, "standard-user", o), "deny");
    for (const perm of CATALOG.filter((c) => !c.startsWith("override.") && c !== "role.map")) assert.equal(mode(p, "standard-user", perm), "allow", `${id} ${perm}`);
    assert.equal(mode(p, "administrator", "override.status"), "allow");
  }
  assert.equal(PRESETS.filter((p) => p.id === "feature-level-llm-control").length, 1);
});

test("permissions listing follows the active preset and the reader's role", () => {
  const root = repo("permissions:\n  preset: full-llm-control\n");
  const l = listPermissions(root, "standard-user");
  assert.equal(l.preset, "full-llm-control");
  const row = l.rows.find((r) => r.id === "spec.edit.requirement")!;
  assert.equal(row.modes.llm, "allow");
  assert.equal(row.reader, "allow");
  assert.equal(l.rows.find((r) => r.id === "override.status")!.reader, "deny");
  assert.equal(listPermissions(root, "administrator").rows.find((r) => r.id === "override.status")!.reader, "allow");
  const switched = repo("permissions:\n  preset: full-manual-editing\n");
  assert.equal(listPermissions(switched, "standard-user").rows.find((r) => r.id === "spec.edit.feature")!.modes.llm, "deny");
});

test("permission documentation includes use, modes per preset, the reader's mode and custom steering", () => {
  const root = repo('steering:\n  custom:\n    - permission: spec.approve.feature\n      scope: all\n      text: Always ask twice\n');
  const d = describePermission(root, "spec.approve.feature", "standard-user")!;
  assert.equal(d.readerMode, "allow");
  assert.equal(d.presets.length, 4);
  assert.deepEqual(d.customSteering, [{ scope: "all", text: "Always ask twice" }]);
  const text = d.lines.join("\n");
  for (const part of ["Allows:", "Does not allow:", "Used by: spec approve", "architecture-level-llm-control (active)", "You are standard-user: allow", "Custom steering (all): Always ask twice"]) assert.ok(text.includes(part), part);
  assert.equal(describePermission(root, "nope", "llm"), null);
});

test("CLI: config set/get/list and permissions work end to end", () => {
  const root = repo("auto_warn: on\n");
  const run = (...a: string[]) => spawnSync("node", [cli, ...a], { cwd: root, encoding: "utf8", env: { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" } });
  const set = run("config", "set", "auto_warn", "off");
  assert.equal(set.status, 0, set.stderr);
  assert.match(run("config", "get", "auto_warn").stdout, /auto_warn = on \(set; default on\)/);
  commitAll(root);
  assert.match(run("config", "get", "auto_warn").stdout, /auto_warn = off \(set; default on\)/);
  const json = JSON.parse(run("config", "list", "--json").stdout);
  assert.equal(json.ok, true);
  assert.equal(json.data.find((s: any) => s.key === "auto_warn").source, "set");
  const bad = run("config", "set", "tests.logs", "cloud");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /local, git, off/);
  const perms = run("permissions");
  assert.equal(perms.status, 0);
  assert.match(perms.stdout, /Active preset: architecture-level-llm-control\. You are: standard-user\./);
  assert.match(run("permissions", "config.change").stdout, /Allows: Change a setting/);
  assert.equal(run("permissions", "bogus").status, 1);
});

test("configuration is read from HEAD: an uncommitted change is ignored with a warning, a committed one applies", () => {
  const root = repo("permissions:\n  preset: full-llm-control\n");
  assert.equal(loadSettings(root).config.permissionsPreset, "full-llm-control");
  assert.equal(loadSettings(root).findings.length, 0);
  fs.writeFileSync(file(root), "permissions:\n  preset: feature-level-llm-control\n");
  const l = loadSettings(root);
  assert.equal(l.config.permissionsPreset, "full-llm-control");
  assert.ok(l.findings.some((f) => f.severity === "warning" && /differs from HEAD/.test(f.message)));
  assert.equal(activePreset(root).id, "full-llm-control");
  assert.ok(loadSpecPaths(root).findings.some((f) => /differs from HEAD/.test(f.message)));
  commitAll(root);
  assert.equal(loadSettings(root).config.permissionsPreset, "feature-level-llm-control");
  assert.equal(activePreset(root).id, "feature-level-llm-control");
  assert.equal(loadSettings(root).findings.length, 0);
});

test("configuration: a file missing at HEAD gives defaults, even when the working tree has one", () => {
  const root = repo();
  assert.deepEqual(loadSettings(root).config.values, DEFAULT_SETTINGS.values);
  assert.equal(loadSettings(root).findings.length, 0);
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  fs.writeFileSync(file(root), "auto_warn: off\n");
  const l = loadSettings(root);
  assert.equal(l.config.autoWarn, true);
  assert.equal(l.findings.length, 1);
  const empty = makeRepo({ "README.md": "x\n" });
  assert.deepEqual(loadSettings(empty).config.values, DEFAULT_SETTINGS.values);
});

test("configuration paths are resolved once to absolute folders inside the checkout", () => {
  const root = repo("paths:\n  features: specs/f\n");
  const c = loadSettings(root).config;
  assert.equal(c.abs.features, path.join(root, "specs/f"));
  assert.equal(c.abs.plans, path.join(root, "docs/plans"));
});

test("a setting change regenerates committed steering and runs a registered handler", () => {
  const root = repo("auto_warn: on\n");
  const r = configSet(ctxFor(root), "permissions.preset", "full-llm-control");
  assert.ok(r.lines.some((l) => /Steering regenerated from committed configuration/.test(l)));
  const seen: string[] = [];
  registerEffect("pre_commit.", (_r, key, old, next) => { seen.push(`${key}:${old}->${next}`); return ["hook section updated"]; });
  try {
    const p = configSet(ctxFor(root), "pre_commit.tests", "on");
    assert.deepEqual(seen, ["pre_commit.tests:false->true"]);
    assert.ok(p.lines.includes("hook section updated"));
  } finally { clearEffects(); }
});

test("the actor carries the harness session from SPECPLANE_SESSION", () => {
  const root = repo();
  const prev = process.env.SPECPLANE_SESSION;
  try {
    process.env.SPECPLANE_SESSION = "sess-1";
    assert.equal(cliActor(root).session, "sess-1");
    delete process.env.SPECPLANE_SESSION;
    assert.equal("session" in cliActor(root), false);
  } finally { if (prev === undefined) delete process.env.SPECPLANE_SESSION; else process.env.SPECPLANE_SESSION = prev; }
});

test("CLI: outside a repository docs and help work and other commands exit 3", () => {
  const dir = fs.mkdtempSync(path.join(path.dirname(makeRepo({})), "norepo-"));
  const run = (...a: string[]) => spawnSync("node", [cli, ...a], { cwd: dir, encoding: "utf8" });
  assert.equal(run("--help").status, 0);
  assert.equal(run("docs").status, 0);
  const v = run("validate");
  assert.equal(v.status, 3);
  assert.match(v.stderr, /Not in a git repository/);
  assert.equal(run("config", "list").status, 3);
});

test("subprojects: items need unique kebab-case names, not root or file, and separate paths inside the repository", () => {
  const ok = parseConfig("subprojects:\n  - {name: claude, path: harnesses/claude/specs}\n");
  assert.deepEqual(ok.findings, []);
  assert.deepEqual(ok.config.values["subprojects"], [{ name: "claude", path: "harnesses/claude/specs" }]);
  for (const text of [
    "subprojects:\n  - {name: root, path: a}\n",
    "subprojects:\n  - {name: file, path: a}\n",
    "subprojects:\n  - {name: Bad_Name, path: a}\n",
    "subprojects:\n  - {name: a, path: x}\n  - {name: a, path: y}\n",
    "subprojects:\n  - {name: a, path: x}\n  - {name: b, path: x/y}\n",
    "subprojects:\n  - {name: a, path: ../out}\n",
    "subprojects: [a, b]\n",
  ]) {
    const r = parseConfig(text);
    assert.equal(r.findings.length, 1, text);
    assert.match(r.findings[0].message, /subprojects.*malformed/);
    assert.deepEqual(r.config.values["subprojects"], [], "the default applies");
  }
});
