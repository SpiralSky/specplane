import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRESET, PRESETS, switchRole, type Actor, type Preset } from "../perm/permissions.js";
import { applySpecEdit, editSpec, makePatch } from "../spec/edit.js";
import { approveSpecs, metaSet, type Ctx } from "../spec/human.js";
import { configSet, type ConfigCtx } from "../config-ops.js";
import { makeRepo } from "../test-repo.js";
import { RequestSent, holdRequest } from "./hold.js";
import { acceptRequest, declineRequest, formatRequest, list, sendRequest, show, type RequestCtx } from "./ops.js";
import { answerRequest, claimAnswer, readRequest, validateRecord } from "./store.js";
import { storeDir } from "../repo/store.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" };
const sh = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const F = "docs/specifications/features";
const spec = (id: string, body = "Text.") => `---\nid: feature/${id}\ntitle: ${id}\nstatus: awaiting-review\nauthors:\n  - human: someone\ncovers: []\n---\n\n# ${id}\n\n## R9: Part\n\n${body}\n`;

function repo(): string {
  const root = makeRepo({ [`${F}/a.md`]: spec("a"), [`${F}/b.md`]: spec("b"), ".specplane/config.yaml": `paths:\n  features: ${F}\n` });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Pat Person");
  sh(root, "config", "user.email", "pat@example.com");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  return root;
}
const actor = (role: Actor["role"], kind: Actor["kind"] = role === "llm" ? "llm" : "human"): Actor =>
  kind === "llm" ? { role, kind, name: "claude", model: "claude-sonnet-5-5" } : { role, kind, name: "Pat Person" };
const NOW = new Date("2026-11-10T12:00:00Z");
const sctx = (root: string, role: Actor["role"] = "llm", preset: Preset = DEFAULT_PRESET): Ctx & RequestCtx => ({ root, actor: actor(role), preset, now: NOW });
const user = (root: string, preset: Preset = DEFAULT_PRESET): RequestCtx => ({ root, actor: actor("standard-user"), preset, now: NOW });
const auditLog = (root: string): Record<string, any>[] => {
  const dir = sh(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return fs.readFileSync(path.join(dir, "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
};
const read = (root: string, id: string) => fs.readFileSync(path.join(root, F, `${id}.md`), "utf8");
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

test("request user: the action is not done, one request is stored and audited; accept does it once as the accepter", async () => {
  const root = repo();
  const head = sh(root, "rev-parse", "HEAD");
  const r = await approveSpecs(sctx(root), ["feature/a"]);
  assert.ok(r.ok && r.request, "a request id is returned");
  assert.equal(sh(root, "rev-parse", "HEAD"), head, "no commit");
  assert.match(read(root, "a"), /status: awaiting-review/);
  const all = list(root);
  assert.equal(all.length, 1);
  assert.equal(all[0].state, "pending");
  assert.deepEqual(all[0].permissions, ["spec.approve"]);
  assert.equal(all[0].from.role, "llm");
  assert.equal(all[0].action.command, "spec approve");
  const sent = auditLog(root).find((e) => e.outcome === "request-sent")!;
  assert.equal(sent.request, all[0].id);
  assert.equal(sent.actor.role, "llm");

  const acc = await acceptRequest(user(root), all[0].id, "ok");
  assert.ok(acc.ok, acc.reasons.join());
  assert.match(read(root, "a"), /status: approved/);
  assert.match(read(root, "a"), /human: Pat Person/, "approved by the person who accepted");
  assert.equal(readRequest(root, all[0].id)!.state, "accepted");
  assert.equal(readRequest(root, all[0].id)!.answer!.by, "Pat Person");
  assert.ok(auditLog(root).some((e) => e.command === "spec approve" && e.outcome === "done" && e.request === all[0].id), "the action's audit entry names the request");
  const again = await acceptRequest(user(root), all[0].id);
  assert.ok(!again.ok);
  assert.match(again.reasons[0], /already accepted/);
});

test("decline changes nothing and cannot be repeated; an unanswered request never expires", async () => {
  const root = repo();
  const r = await approveSpecs(sctx(root), ["feature/b"]);
  const head = sh(root, "rev-parse", "HEAD");
  const d = await declineRequest(user(root), r.request!, "not now");
  assert.ok(d.ok);
  assert.equal(sh(root, "rev-parse", "HEAD"), head);
  assert.match(read(root, "b"), /status: awaiting-review/);
  assert.equal(readRequest(root, r.request!)!.state, "declined");
  assert.ok(!(await declineRequest(user(root), r.request!)).ok);
  const r2 = await approveSpecs(sctx(root), ["feature/b"]);
  assert.equal(readRequest(root, r2.request!)!.state, "pending");
  assert.equal(list(root)[0].id, r2.request, "pending first, answered after");
});

test("accepting needs the permission of the action with mode allow, checked now; a refusal leaves the request pending", async () => {
  const root = repo();
  const r = await approveSpecs(sctx(root), ["feature/a"]);
  // a role whose own mode is request-user (LLM table) held by a person cannot accept
  const res = await acceptRequest({ root, actor: actor("llm", "human"), preset: DEFAULT_PRESET, now: NOW }, r.request!);
  assert.ok(!res.ok);
  assert.match(res.reasons[0], /spec\.approve.*allow.*pending/s);
  assert.equal(readRequest(root, r.request!)!.state, "pending");
  assert.ok(auditLog(root).some((e) => e.command === "requests accept" && e.outcome === "refused" && e.permission === "spec.approve"));
  // an LLM role never accepts or declines
  const byLlm = await acceptRequest({ root, actor: actor("llm"), preset: PRESETS[3], now: NOW }, r.request!);
  assert.match(byLlm.reasons[0], /LLM role cannot accept/);
  assert.match((await declineRequest({ root, actor: actor("llm"), preset: PRESETS[3], now: NOW }, r.request!)).reasons[0], /cannot answer/);
  assert.equal(readRequest(root, r.request!)!.state, "pending");
  // changing the active preset does not rewrite the record; the check uses the preset in force at accept time
  const denyAll: Preset = { ...DEFAULT_PRESET, standardUser: { defaultMode: "deny", modes: {} } };
  assert.ok(!(await acceptRequest(user(root, denyAll), r.request!)).ok);
  assert.equal(readRequest(root, r.request!)!.state, "pending");
  assert.ok((await acceptRequest(user(root, DEFAULT_PRESET), r.request!)).ok);
});

test("deny sends no request; allow acts directly; sendRequest refuses a denied permission", async () => {
  const root = repo();
  const manual = preset("full-manual-editing");
  const r = await approveSpecs(sctx(root, "llm", manual), ["feature/a"]);
  assert.ok(r.request, "approval is request user in every preset");
  const e = editSpec(sctx(root, "llm", manual), "feature/a", spec("a", "Changed."));
  assert.ok(!e.ok && !e.request);
  assert.match(e.reasons[0], /spec\.edit\.feature/);
  assert.equal(list(root).length, 1, "only the approval request");
  const s = sendRequest(sctx(root, "llm", manual), { command: "spec edit", params: { spec: "feature/a", patch: "x" }, permissions: [], reason: "x" });
  assert.ok(!s.ok);
  assert.match(s.reasons[0], /denied/);
  assert.equal(list(root).length, 1);
  // allow: the full control preset edits directly
  const full = preset("full-llm-control");
  const direct = editSpec(sctx(root, "llm", full), "feature/b", spec("b", "Changed directly."));
  assert.ok(direct.ok && !direct.request);
  assert.match(read(root, "b"), /Changed directly/);
  // sendRequest from an allowed role records the request with the permission the action would need
  const sent = sendRequest(sctx(root, "llm", full), { command: "spec approve", params: { ids: ["feature/b"] }, reason: "please approve b" });
  assert.ok(sent.ok);
  assert.equal(sent.request!.reason, "please approve b");
  assert.equal(sent.request!.state, "pending");
});

test("spec edit under request user stores the patch, shows a diff against the last approved text, and accept applies it", async () => {
  const root = repo();
  await approveSpecs(user(root) as unknown as Ctx, ["feature/a"]);
  const approved = read(root, "a");
  assert.match(approved, /status: approved/);
  const before = sh(root, "rev-parse", "HEAD");
  const edited = approved.replace("Text.", "New text.");
  const r = editSpec(sctx(root), "feature/a", edited);
  assert.ok(r.ok && r.request, "feature specs are request user in preset 1");
  assert.equal(read(root, "a"), approved, "nothing written");
  const rec = show(root, r.request!)!;
  assert.match(rec.diff!, /^-Text\.$/m);
  assert.match(rec.diff!, /^\+New text\.$/m);
  assert.match(formatRequest(rec, true), /\u001b\[32m\+New text\./, "additions in green");
  assert.match(formatRequest(rec, true), /\u001b\[31m-Text\./, "deletions in red");
  assert.ok((rec.action.params as any).patch.includes("New text."));
  const acc = await acceptRequest(user(root), r.request!);
  assert.ok(acc.ok, acc.reasons.join());
  assert.match(read(root, "a"), /New text\./);
  assert.match(read(root, "a"), /status: awaiting-review/, "a content edit makes the spec Awaiting Review");
  assert.equal(sh(root, "rev-parse", "HEAD"), before, "left in the working tree, not committed");
  // a never-approved spec shows the whole text as additions
  const r2 = editSpec(sctx(root), "feature/b", spec("b", "Other."));
  const d2 = show(root, r2.request!)!.diff!;
  assert.ok(!/^-[^-]/m.test(d2), "no deletions");
  assert.match(d2, /^\+Other\.$/m);
});

test("an accepted request whose action cannot be done is marked failed and is not retried", async () => {
  const root = repo();
  const r = editSpec(sctx(root), "feature/a", spec("a", "One."));
  fs.writeFileSync(path.join(root, F, "a.md"), spec("a", "Somebody else changed this."));
  const acc = await acceptRequest(user(root), r.request!);
  assert.ok(!acc.ok);
  assert.match(acc.reasons[0], /marked failed/);
  const rec = readRequest(root, r.request!)!;
  assert.equal(rec.state, "failed");
  assert.match(rec.answer!.error!, /no longer applies/);
  assert.match((await acceptRequest(user(root), r.request!)).reasons[0], /already failed/);
});

test("config set and metadata writes under request user", async () => {
  const root = repo();
  const c: ConfigCtx = { root, actor: actor("llm"), preset: DEFAULT_PRESET, now: NOW };
  const r = configSet(c, "plans.parallelism", "1");
  assert.ok(r.ok && r.request);
  const rec = readRequest(root, r.request!)!;
  assert.equal((rec.action.params as any).key, "plans.parallelism");
  assert.ok("old" in rec.action.params && "new" in rec.action.params);
  const c2 = configSet(c, "audit.retention", "30");
  assert.ok(c2.request);
  assert.ok(!fs.readFileSync(path.join(root, ".specplane/config.yaml"), "utf8").includes("retention"));
  const acc = await acceptRequest(user(root), c2.request!);
  assert.ok(acc.ok, acc.reasons.join());
  assert.match(fs.readFileSync(path.join(root, ".specplane/config.yaml"), "utf8"), /retention: 30/);
  // metadata writes are deny for the LLM, so no request
  const m = metaSet(sctx(root), "feature/a", "title", "New");
  assert.ok(!m.ok && !m.request);
});

test("records are validated and answering is a compare-and-set", () => {
  const root = repo();
  const rec = holdRequest({ root, actor: actor("llm"), permissions: ["spec.approve"], decidedBy: "spec.approve", command: "spec approve", params: { ids: ["feature/a"] }, reason: "r", now: NOW });
  assert.deepEqual(validateRecord(rec), []);
  assert.ok(validateRecord({ ...rec, state: "weird" }).includes("state"));
  assert.match(rec.id, /^20261110T120000Z-[0-9a-f]{4}$/);
  answerRequest(root, rec.id, "declined", { by: "x", date: "2026-11-10" });
  assert.throws(() => answerRequest(root, rec.id, "accepted", { by: "y", date: "2026-11-10" }), /already declined/);
});

test("the LLM cannot switch roles; a person can, and switching back needs nothing", () => {
  const root = repo();
  assert.throws(() => switchRole(root, "administrator", actor("llm")), /cannot switch roles/);
  switchRole(root, "administrator", actor("standard-user"));
  switchRole(root, "standard-user", actor("administrator"));
});

test("CLI: list, show, accept and decline work from the terminal", () => {
  const root = repo();
  const a = holdRequest({ root, actor: actor("llm"), permissions: ["spec.approve"], decidedBy: "spec.approve", command: "spec approve", params: { ids: ["feature/a"] }, reason: "approve a" });
  const b = holdRequest({ root, actor: actor("llm"), permissions: ["spec.approve"], decidedBy: "spec.approve", command: "spec approve", params: { ids: ["feature/b"] }, reason: "approve b" });
  const run = (...args: string[]) => spawnSync("node", [cli, "requests", ...args], { cwd: root, encoding: "utf8", env: ENV });
  const l = run("list");
  assert.equal(l.status, 0);
  assert.match(l.stdout, /pending.*approve a/);
  assert.match(run("show", a.id).stdout, /Reason: approve a/);
  const acc = run("accept", a.id);
  assert.equal(acc.status, 0, acc.stderr);
  assert.match(read(root, "a"), /status: approved/);
  const dec = run("decline", b.id);
  assert.equal(dec.status, 0, dec.stderr);
  assert.match(read(root, "b"), /status: awaiting-review/);
  assert.equal(run("accept", a.id).status, 1);
  assert.equal(JSON.parse(run("list", "--json").stdout).data.length, 2);
});

test("RequestSent carries the stored request", () => {
  const e = new RequestSent({ id: "x" } as any, "msg");
  assert.equal(e.request.id, "x");
});

const lockFile = (root: string, id: string) => path.join(storeDir(root), "requests", `${id}.json.lock`);
const patchFor = (root: string, id: string, body: string) => makePatch(`${F}/${id}.md`, read(root, id), read(root, id).replace("Text.", body));

test("sending derives permissions from the action: empty, omitted and misleading lists change nothing", () => {
  const root = repo();
  const manual = preset("full-manual-editing");
  const patch = patchFor(root, "a", "Changed.");
  const denied = (permissions?: string[]) => sendRequest(sctx(root, "llm", manual), { command: "spec edit", params: { spec: "feature/a", patch }, permissions, reason: "x" });
  for (const p of [[], undefined, ["spec.approve"], ["request.send"]]) {
    const s = denied(p);
    assert.ok(!s.ok, `list ${JSON.stringify(p)} must not avoid the deny`);
    assert.match(s.reasons[0], /spec\.edit\.feature.*denied/);
  }
  assert.equal(list(root).length, 0);
  assert.ok(auditLog(root).some((e) => e.outcome === "refused" && e.permission === "spec.edit.feature"));
  const full = preset("full-llm-control");
  const ok = sendRequest(sctx(root, "llm", full), { command: "spec edit", params: { spec: "feature/a", patch }, permissions: ["bogus"], reason: "x" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.request!.permissions, ["spec.edit.feature"], "stored list comes from the action");
  const bad = sendRequest(sctx(root, "llm", full), { command: "spec edit", params: { spec: "feature/a" }, reason: "x" });
  assert.ok(!bad.ok);
  assert.match(bad.reasons[0], /patch/);
  assert.ok(!sendRequest(sctx(root, "llm", full), { command: "nope", params: {}, reason: "x" }).ok);
  assert.equal(list(root).length, 1);
});

test("accepting uses the permissions of the action, not the stored list; a refusal leaves the request pending and nothing applied", async () => {
  const root = repo();
  const patch = patchFor(root, "a", "Changed.");
  const rec = holdRequest({ root, actor: actor("llm"), permissions: [], decidedBy: "x", command: "spec edit", params: { spec: "feature/a", patch }, reason: "r", now: NOW });
  const noEdit: Preset = { ...DEFAULT_PRESET, standardUser: { defaultMode: "allow", modes: { "spec.edit.feature": "request-user" } } };
  const before = read(root, "a");
  const res = await acceptRequest(user(root, noEdit), rec.id);
  assert.ok(!res.ok);
  assert.match(res.reasons[0], /spec\.edit\.feature.*allow.*pending/s);
  assert.equal(readRequest(root, rec.id)!.state, "pending");
  assert.equal(read(root, "a"), before, "action unapplied");
  assert.equal(fs.existsSync(lockFile(root, rec.id)), false, "no live claim");
  // permissions changed between send and accept: the current ones decide
  assert.ok((await acceptRequest(user(root, DEFAULT_PRESET), rec.id)).ok);
  assert.match(read(root, "a"), /Changed\./);
  // an invalid stored record is refused, not run
  const bad = holdRequest({ root, actor: actor("llm"), permissions: ["spec.approve"], decidedBy: "x", command: "spec edit", params: { spec: "feature/a" }, reason: "r", now: NOW });
  const r2 = await acceptRequest(user(root), bad.id);
  assert.ok(!r2.ok);
  assert.equal(readRequest(root, bad.id)!.state, "pending");
});

test("applySpecEdit itself needs the edit permission with allow", () => {
  const root = repo();
  const patch = patchFor(root, "a", "Changed.");
  const before = read(root, "a");
  const llm = sctx(root, "llm", preset("full-manual-editing"));
  const r = applySpecEdit(llm, "feature/a", `${F}/a.md`, patch);
  assert.ok(!r.ok);
  assert.match(r.reasons[0], /spec\.edit\.feature/);
  const asked = applySpecEdit(sctx(root, "llm", DEFAULT_PRESET), "feature/a", `${F}/a.md`, patch);
  assert.ok(!asked.ok, "request-user is not allow");
  assert.equal(read(root, "a"), before);
  assert.ok(applySpecEdit(sctx(root, "llm", preset("full-llm-control")), "feature/a", `${F}/a.md`, patch).ok);
});

test("accept and decline share one claim: overlapping answers cannot contradict, and the action runs once", async () => {
  const root = repo();
  const rec = holdRequest({ root, actor: actor("llm"), permissions: ["spec.approve"], decidedBy: "spec.approve", command: "spec approve", params: { ids: ["feature/a"] }, reason: "r", now: NOW });
  const held = claimAnswer(root, rec.id); // an accept in progress
  try {
    const d = await declineRequest(user(root), rec.id);
    assert.ok(!d.ok);
    assert.match(d.reasons[0], /being answered/);
    const a = await acceptRequest(user(root), rec.id);
    assert.ok(!a.ok);
    assert.match(a.reasons[0], /being answered/);
    assert.match(read(root, "a"), /status: awaiting-review/, "nothing ran");
  } finally { held.release(); }
  assert.equal(readRequest(root, rec.id)!.state, "pending");
  const [first, second] = await Promise.all([acceptRequest(user(root), rec.id), declineRequest(user(root), rec.id)]);
  assert.equal([first, second].filter((r) => r.ok).length, 1, "exactly one answer wins");
  const state = readRequest(root, rec.id)!.state;
  assert.equal(first.ok, state === "accepted");
  assert.equal(second.ok, state === "declined");
  assert.equal(fs.existsSync(lockFile(root, rec.id)), false);
  assert.equal(auditLog(root).filter((e) => e.command === "spec approve" && e.outcome === "done").length, state === "accepted" ? 1 : 0);
});

test("failure cleanup: a failed action marks the request failed and leaves no claim", async () => {
  const root = repo();
  const r = editSpec(sctx(root), "feature/a", read(root, "a").replace("Text.", "One."));
  fs.writeFileSync(path.join(root, F, "a.md"), read(root, "a").replace("Text.", "Changed elsewhere."));
  const acc = await acceptRequest(user(root), r.request!);
  assert.ok(!acc.ok);
  assert.equal(readRequest(root, r.request!)!.state, "failed");
  assert.equal(fs.existsSync(lockFile(root, r.request!)), false);
  // permission refusal also releases the claim, so a later accept works
  const rec = holdRequest({ root, actor: actor("llm"), permissions: ["spec.approve"], decidedBy: "x", command: "spec approve", params: { ids: ["feature/b"] }, reason: "r", now: NOW });
  const deny: Preset = { ...DEFAULT_PRESET, standardUser: { defaultMode: "deny", modes: {} } };
  assert.ok(!(await acceptRequest(user(root, deny), rec.id)).ok);
  assert.equal(fs.existsSync(lockFile(root, rec.id)), false);
  assert.ok((await acceptRequest(user(root), rec.id)).ok);
});
