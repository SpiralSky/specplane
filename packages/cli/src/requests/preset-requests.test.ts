import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_PRESET, activePreset, type Actor, type Preset } from "../perm/permissions.js";
import { presetFile, serializePreset } from "../perm/presets.js";
import { createActionRuntime } from "../harness/actions.js";
import { makeRepo } from "../test-repo.js";
import { acceptRequest, declineRequest, formatRequest, list, sendRequest, show, type RequestCtx } from "./ops.js";
import { readRequest } from "./store.js";

/** `preset create` as a request (`architecture/reference-cli` §8 'Preset create requests'; `roles-and-permissions R56.2`). */

const NOW = new Date("2026-11-16T12:00:00Z");
const llm: Actor = { role: "llm", kind: "llm", name: "claude", model: "claude-sonnet-5-5" };
const person: Actor = { role: "standard-user", kind: "human", name: "Pat" };
const sh = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "permissions:\n  preset: architecture-level-llm-control\n" });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) sh(root, ...a);
  return root;
}
const send = (root: string, params: Record<string, unknown>, preset: Preset = DEFAULT_PRESET) => sendRequest({ root, actor: llm, preset, now: NOW }, { command: "preset create", params, reason: "need it" });
const as = (root: string, actor: Actor, preset: Preset = DEFAULT_PRESET): RequestCtx => ({ root, actor, preset, now: NOW });
const good = { id: "mine", default_mode: "deny", llm: { modes: { "info.retrieve": "allow" } } };

test("sending stores the full preset and the preview; nothing is written", () => {
  const root = repo();
  const r = send(root, good);
  assert.equal(r.ok, true, r.reasons.join());
  const rec = readRequest(root, r.request!.id)!;
  assert.deepEqual(rec.action.params, good);
  assert.deepEqual(rec.permissions, ["preset.create"]);
  assert.match(rec.diff!, /^mine \(custom\); default mode for unlisted permissions: deny/);
  assert.match(rec.diff!, /applies to: standard-user, llm/);
  assert.match(rec.diff!, /more permissive than architecture-level-llm-control/);
  assert.equal(show(root, rec.id)!.diff, rec.diff);
  assert.match(formatRequest(show(root, rec.id)!), /more permissive than/);
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), false);
});

test("a malformed preset is refused when sent and stores nothing", () => {
  const root = repo();
  const bad: Record<string, unknown>[] = [
    { id: "x" }, { id: "Bad Id", default_mode: "deny" }, { id: "x", default_mode: "maybe" },
    { id: "x", default_mode: "deny", llm: { modes: { "no.such": "allow" } } }, { id: "x", default_mode: "deny", llm: { modes: { "info.retrieve": "sure" } } },
    { id: "x", default_mode: "deny", delete: true }, { id: "x", default_mode: "deny", activate: true },
    { id: "full-llm-control", default_mode: "deny" }, { id: "x", default_mode: "deny", llm: [] },
  ];
  for (const p of bad) { const r = send(root, p); assert.equal(r.ok, false, JSON.stringify(p)); assert.equal(r.request, undefined); }
  assert.equal(list(root).length, 0);
});

test("an ID that already exists as a custom preset is refused", async () => {
  const root = repo();
  const r = send(root, good);
  assert.equal((await acceptRequest(as(root, person), r.request!.id, undefined, { commit: true })).ok, true);
  const again = send(root, good);
  assert.equal(again.ok, false);
  assert.match(again.reasons[0], /already exists/);
});

test("deny stores nothing; decline stores no preset", async () => {
  const root = repo();
  const denied = send(root, good, { ...DEFAULT_PRESET, llm: { ...DEFAULT_PRESET.llm, modes: { ...DEFAULT_PRESET.llm.modes, "preset.create": "deny" } } });
  assert.equal(denied.ok, false);
  assert.match(denied.reasons[0], /preset\.create/);
  assert.equal(list(root).length, 0);
  const r = send(root, good);
  const d = await declineRequest(as(root, person), r.request!.id);
  assert.equal(d.ok, true);
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), false);
});

test("accepting runs presetCreate as the accepter, writes uncommitted; the preset is not active", async () => {
  const root = repo();
  const r = send(root, good);
  const acc = await acceptRequest(as(root, person), r.request!.id);
  assert.equal(acc.ok, true, acc.reasons.join());
  assert.deepEqual(acc.uncommitted, [presetFile("mine")]);
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), true);
  assert.equal(sh(root, "status", "--porcelain", "--", presetFile("mine")).startsWith("??"), true);
  assert.equal(readRequest(root, r.request!.id)!.state, "accepted");
  assert.equal(activePreset(root).id, "architecture-level-llm-control");
});

test("accept --commit commits the preset file only", async () => {
  const root = repo();
  const r = send(root, good);
  fs.writeFileSync(path.join(root, "other.txt"), "x\n");
  const acc = await acceptRequest(as(root, person), r.request!.id, undefined, { commit: true });
  assert.equal(acc.ok, true, acc.reasons.join());
  assert.ok(acc.committed);
  assert.equal(acc.uncommitted, undefined);
  assert.deepEqual(sh(root, "show", "--name-only", "--format=", "HEAD").split("\n"), [presetFile("mine")]);
  assert.match(sh(root, "log", "-1", "--format=%s"), /^chore\(preset\): create mine \(request /);
  assert.equal(activePreset(root).id, "architecture-level-llm-control");
});

test("accept needs config.change and role.manage as allow, whatever the sender needed", async () => {
  const root = repo();
  const r = send(root, good);
  const id = r.request!.id;
  const noConfig: Preset = { ...DEFAULT_PRESET, standardUser: { ...DEFAULT_PRESET.standardUser, modes: { ...DEFAULT_PRESET.standardUser.modes, "config.change": "request-user" } } };
  const a = await acceptRequest(as(root, person, noConfig), id);
  assert.equal(a.ok, false);
  assert.match(a.reasons[0], /config\.change/);
  const asker: Preset = { ...DEFAULT_PRESET, customRoles: { asker: { id: "asker", title: "Asker", level: 6, defaultMode: "deny", modes: { "config.change": "allow", "role.manage": "request-user" } } } };
  const b = await acceptRequest(as(root, { role: "asker", kind: "human", name: "Pat" }, asker), id);
  assert.equal(b.ok, false);
  assert.match(b.reasons[0], /role\.manage/);
  const c = await acceptRequest(as(root, llm), id);
  assert.equal(c.ok, false);
  assert.equal(readRequest(root, id)!.state, "pending");
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), false);
});

test("harness actions: preset.list, preset.show read; preset.create writes under allow and refuses under request-user", async () => {
  const root = repo();
  const rt = createActionRuntime({ root, id: "s", reportsContext: false, model: "m", now: NOW });
  const list = await rt.call("preset.list", {});
  assert.equal(list.ok, true, list.findings.join());
  assert.ok((list.data as { data: { id: string }[] }).data.some((p) => p.id === "full-llm-control"));
  const shown = await rt.call("preset.show", { id: "full-llm-control" });
  assert.equal(shown.ok, true, shown.findings.join());
  assert.equal((await rt.call("preset.show", { id: "nope" })).ok, false);
  const refused = await rt.call("preset.create", good);
  assert.equal(refused.ok, false);
  assert.match(refused.findings.join(), /request user|preset\.create/);
  assert.equal(fs.existsSync(path.join(root, presetFile("mine"))), false);
  assert.equal((await rt.call("preset.create", { id: "x" })).ok, false);
});

test("harness preset.create writes the file when preset.create is allow", async () => {
  const root = repo();
  const opener = { id: "opener", number: 0, custom: true as const, title: "opener", defaultMode: "deny" as const, standardUser: { modes: {} }, llm: { modes: { "preset.create": "allow" as const, "info.retrieve": "allow" as const } } };
  fs.mkdirSync(path.join(root, path.dirname(presetFile("opener"))), { recursive: true });
  fs.writeFileSync(path.join(root, presetFile("opener")), serializePreset(opener));
  fs.writeFileSync(path.join(root, ".specplane/config.yaml"), "permissions:\n  preset: opener\n");
  sh(root, "add", "-A"); sh(root, "commit", "-qm", "preset");
  const rt = createActionRuntime({ root, id: "s", reportsContext: false, model: "m", now: NOW });
  const r = await rt.call("preset.create", { id: "made", default_mode: "deny", llm: { modes: { "info.retrieve": "allow" } } });
  assert.equal(r.ok, true, r.findings.join());
  assert.equal(fs.existsSync(path.join(root, presetFile("made"))), true);
});
