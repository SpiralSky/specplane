import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { configSet } from "../config-ops.js";
import { loadSettings } from "../config.js";
import { describePermission } from "./docs.js";
import { PRESETS, activePreset, allPresets, mode, type Actor } from "./permissions.js";
import { presetCreate, presetDelete, presetEdit, presetList, presetShow, type PresetCtx } from "./preset-ops.js";
import { parsePreset, presetFile } from "./presets.js";
import { CATALOG } from "./permissions.js";
import { makeRepo } from "../test-repo.js";

/** Custom presets against `feature/roles-and-permissions` R56 and R56.1 and `architecture/reference-cli` §7.5. */

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const person: Actor = { role: "standard-user", kind: "human", name: "Pat" };
const admin: Actor = { role: "administrator", kind: "human", name: "Pat" };
const llm: Actor = { role: "llm", kind: "llm", name: "claude" };

function repo(config = "permissions:\n  preset: architecture-level-llm-control\n"): string {
  const root = makeRepo({ ".specplane/config.yaml": config });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  return root;
}
function commitAll(root: string): void {
  for (const a of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "presets"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
}
const ctx = (root: string, actor: Actor = person, preset = PRESETS[0]): PresetCtx => ({ root, actor, preset });

test("a Standard User creates a preset that needs a default mode, and it applies once committed", () => {
  const root = repo();
  const noDefault = presetCreate(ctx(root), "careful", {});
  assert.equal(noDefault.ok, false);
  assert.match(noDefault.reasons[0], /default mode/);
  const r = presetCreate(ctx(root), "careful", { defaultMode: "deny", sets: ["llm:spec.edit.feature=request-user", "standard-user:*=allow"] });
  assert.equal(r.ok, true);
  assert.ok(r.lines.includes(`git add -- :/${presetFile("careful")} && git commit -m "preset: create careful" -- :/${presetFile("careful")}`));
  assert.ok(fs.existsSync(path.join(root, presetFile("careful"))));
  assert.equal(allPresets(root).some((p) => p.id === "careful"), false, "uncommitted: ignored");
  commitAll(root);
  const p = allPresets(root).find((x) => x.id === "careful")!;
  assert.equal(mode(p, "llm", "spec.edit.feature"), "request-user");
  assert.equal(mode(p, "llm", "spec.edit.architecture"), "deny", "preset default mode applies to unlisted permissions");
  assert.equal(mode(p, "standard-user", "meta.write"), "allow", "role default applies");
  assert.equal(presetList(root).lines.some((l) => /^careful .*custom/.test(l)), true);
  assert.equal(presetShow(root, "careful").ok, true);
});

test("create copies a preset with --from, applies edits, and refuses duplicates and default ids", () => {
  const root = repo();
  const r = presetCreate(ctx(root), "mine", { from: "full-llm-control", sets: ["llm:spec.edit.requirement=request-user"] });
  assert.equal(r.ok, true);
  commitAll(root);
  const p = allPresets(root).find((x) => x.id === "mine")!;
  assert.equal(mode(p, "llm", "spec.edit.requirement"), "request-user");
  assert.equal(mode(p, "llm", "spec.edit.feature"), "allow");
  assert.equal(presetCreate(ctx(root), "mine", { defaultMode: "deny" }).ok, false);
  assert.equal(presetCreate(ctx(root), "full-llm-control", { defaultMode: "deny" }).ok, false);
  assert.equal(presetCreate(ctx(root), "Bad Name", { defaultMode: "deny" }).ok, false);
  assert.equal(presetCreate(ctx(root), "x1", { from: "nope" }).ok, false);
  assert.equal(presetCreate(ctx(root), "x2", { defaultMode: "deny", sets: ["llm:no.such=allow"] }).ok, false);
  assert.equal(presetCreate(ctx(root), "x3", { defaultMode: "deny", sets: ["llm:meta.read=sometimes"] }).ok, false);
  assert.equal(presetCreate(ctx(root), "x4", { defaultMode: "deny", sets: ["admin:meta.read=allow"] }).ok, false);
  assert.equal(presetCreate(ctx(root), "x5", { defaultMode: "maybe" }).ok, false);
  assert.equal(fs.existsSync(path.join(root, presetFile("x2"))), false);
});

test("edit changes a custom preset and unset restores the default; default presets cannot be edited or deleted", () => {
  const root = repo();
  presetCreate(ctx(root), "mine", { defaultMode: "deny", sets: ["llm:meta.read=allow"] });
  const e = presetEdit(ctx(root), "mine", { defaultMode: "request-user", unsets: ["llm:meta.read"], sets: ["standard-user:config.change=deny"], title: "Mine" });
  assert.equal(e.ok, true);
  commitAll(root);
  const p = allPresets(root).find((x) => x.id === "mine")!;
  assert.equal(p.title, "Mine");
  assert.equal(mode(p, "llm", "meta.read"), "request-user");
  assert.equal(mode(p, "standard-user", "config.change"), "deny");
  assert.equal(presetEdit(ctx(root), "mine", { sets: [] }).data && (presetEdit(ctx(root), "mine", {}).data as { changed: boolean }).changed, false);
  assert.equal(presetEdit(ctx(root), "full-llm-control", { defaultMode: "allow" }).ok, false);
  assert.equal(presetDelete(ctx(root), "full-llm-control").ok, false);
  assert.equal(presetEdit(ctx(root), "ghost", { defaultMode: "allow" }).ok, false);
});

test("delete removes a custom preset but not the active one", () => {
  const root = repo();
  presetCreate(ctx(root), "mine", { defaultMode: "deny" });
  commitAll(root);
  assert.equal(configSet({ root, actor: person, preset: PRESETS[0] }, "permissions.preset", "mine").ok, true);
  commitAll(root);
  assert.equal(activePreset(root).id, "mine");
  const refused = presetDelete(ctx(root), "mine");
  assert.equal(refused.ok, false);
  assert.match(refused.reasons[0], /active preset/);
  assert.equal(configSet({ root, actor: person, preset: PRESETS[0] }, "permissions.preset", "full-llm-control").ok, true);
  assert.equal(presetDelete(ctx(root), "mine").ok, false, "still active at HEAD or in the working-tree config? the working tree names another preset");
});

test("the LLM role cannot create, edit or delete presets; the Administrator can", () => {
  const root = repo();
  presetCreate(ctx(root), "mine", { defaultMode: "deny" });
  for (const preset of PRESETS) {
    assert.equal(presetCreate(ctx(root, llm, preset), "other", { defaultMode: "deny" }).ok, false, preset.id);
    assert.equal(presetEdit(ctx(root, llm, preset), "mine", { defaultMode: "allow" }).ok, false);
    assert.equal(presetDelete(ctx(root, llm, preset), "mine").ok, false);
  }
  assert.equal(fs.existsSync(path.join(root, presetFile("other"))), false);
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), true);
  assert.equal(presetCreate(ctx(root, admin), "by-admin", { defaultMode: "deny" }).ok, true);
});

test("an LLM-role actor stays refused when a preset gives it config.change as allow, and a request-user Standard User is refused", () => {
  const root = repo();
  const open = { ...PRESETS[0], standardUser: { defaultMode: "allow" as const, modes: { "config.change": "request-user" as const } }, llm: { modes: { "config.change": "allow" as const } } };
  const r = presetCreate(ctx(root, llm, open), "p", { defaultMode: "deny" });
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /role\.manage/);
  const q = presetCreate(ctx(root, person, open), "p", { defaultMode: "deny" });
  assert.equal(q.ok, false);
  assert.match(q.reasons[0], /cannot be sent as a request/);
});

test("a malformed preset file is reported and ignored; an unknown active preset is malformed and the default applies", () => {
  const root = repo("permissions:\n  preset: ghost\n");
  fs.mkdirSync(path.join(root, ".specplane/roles/presets"), { recursive: true });
  fs.writeFileSync(path.join(root, presetFile("broken")), "id: broken\ndefault_mode: deny\nroles:\n  llm:\n    modes: {no.such.permission: allow}\n");
  fs.writeFileSync(path.join(root, presetFile("nodefault")), "id: nodefault\n");
  fs.writeFileSync(path.join(root, presetFile("full-llm-control")), "id: full-llm-control\ndefault_mode: deny\n");
  commitAll(root);
  const l = loadSettings(root);
  assert.equal(l.findings.filter((f) => f.key.startsWith(".specplane/roles/presets/")).length, 3);
  assert.ok(l.findings.some((f) => f.key === "permissions.preset" && /does not exist/.test(f.message)));
  assert.equal(l.config.permissionsPreset, "architecture-level-llm-control");
  assert.equal(activePreset(root).id, "architecture-level-llm-control");
  assert.equal(allPresets(root).length, 4);
});

test("config set accepts a custom preset in the working tree and refuses an unknown one", () => {
  const root = repo();
  presetCreate(ctx(root), "mine", { defaultMode: "deny" });
  assert.equal(configSet({ root, actor: person, preset: PRESETS[0] }, "permissions.preset", "mine").ok, true);
  assert.equal(configSet({ root, actor: person, preset: PRESETS[0] }, "permissions.preset", "ghost").ok, false);
});

test("an active custom preset drives the permission documentation and the guard", () => {
  const root = repo();
  presetCreate(ctx(root), "mine", { defaultMode: "deny", sets: ["llm:spec.edit.feature=allow"] });
  configSet({ root, actor: person, preset: PRESETS[0] }, "permissions.preset", "mine");
  commitAll(root);
  const d = describePermission(root, "spec.edit.feature", "llm")!;
  assert.equal(d.activePreset, "mine");
  assert.equal(d.readerMode, "allow");
  assert.ok(d.presets.some((p) => p.preset === "mine"));
});

test("parsePreset validates shape", () => {
  const ok = (t: string) => parsePreset(t, "p", CATALOG, PRESETS.map((x) => x.id));
  assert.ok(ok("id: p\ndefault_mode: allow\n").preset);
  assert.match(ok("id: q\ndefault_mode: allow\n").problems[0], /does not match/);
  assert.match(ok("id: p\ndefault_mode: allow\nroles: {administrator: {modes: {}}}\n").problems[0], /administrator/);
  assert.match(ok("id: p\n").problems[0], /default_mode/);
  assert.match(ok("- a\n").problems[0], /mapping/);
});

test("a preset naming the removed spec.approve ignores it with a warning and falls back to the default mode (R16.1)", () => {
  const root = repo("permissions:\n  preset: old\n");
  fs.mkdirSync(path.join(root, ".specplane/roles/presets"), { recursive: true });
  fs.writeFileSync(path.join(root, presetFile("old")), "id: old\ndefault_mode: deny\nroles:\n  llm:\n    modes:\n      spec.approve: allow\n      spec.approve.feature: request-user\n");
  commitAll(root);
  const p = activePreset(root);
  assert.equal(p.id, "old", "the preset still applies");
  assert.equal(mode(p, "llm", "spec.approve.feature"), "request-user");
  assert.equal(mode(p, "llm", "spec.approve.architecture"), "deny", "the legacy allow grants nothing");
  const w = loadSettings(root).findings.filter((f) => /unknown permission `spec.approve`/.test(f.message));
  assert.equal(w.length, 1);
  assert.equal(w[0].severity, "warning");
  assert.match(w[0].message, /spec\.approve\.requirement, spec\.approve\.feature or spec\.approve\.architecture/);
});

test("the preset commands run through the CLI", () => {
  const root = repo();
  const run = (...args: string[]) => spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run("preset", "create", "mine", "--default-mode", "deny", "--set", "llm:meta.read=allow", "--set", "llm:info.retrieve=allow").status, 0);
  assert.equal(run("preset", "edit", "mine", "--unset", "llm:meta.read").status, 0);
  assert.equal(run("preset", "create", "bad").status, 1);
  commitAll(root);
  assert.match(run("preset", "list").stdout, /architecture-level-llm-control \(active\)/);
  assert.match(run("preset", "show", "mine", "--json").stdout, /"default_mode":"deny"/);
  assert.equal(run("preset", "delete", "mine").status, 0);
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), false);
  assert.equal(run("preset", "delete", "full-manual-editing").status, 1);
});

test("delete reports the removed file for --commit, and git add/commit of that path records the deletion", () => {
  const root = repo();
  presetCreate(ctx(root), "gone", { defaultMode: "deny" });
  commitAll(root);
  const r = presetDelete(ctx(root), "gone");
  assert.equal(r.ok, true);
  const f = presetFile("gone");
  assert.deepEqual((r.data as { uncommitted: string[] }).uncommitted, [f]);
  assert.deepEqual((r.data as { commit: unknown }).commit, { scope: "preset", summary: "delete gone" });
  assert.ok(r.lines.includes(`git add -- :/${f} && git commit -m "preset: delete gone" -- :/${f}`));
  for (const a of [["add", "--", `:/${f}`], ["commit", "-qm", "x", "--", `:/${f}`]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["ls-tree", "HEAD", "--", f], { cwd: root, encoding: "utf8" }).stdout, "");
  assert.equal(spawnSync("git", ["status", "--porcelain", "--", f], { cwd: root, encoding: "utf8" }).stdout, "");
});
