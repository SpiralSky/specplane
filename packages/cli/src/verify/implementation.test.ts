import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRESET, type Preset } from "../perm/permissions.js";
import { acceptRequest } from "../requests/ops.js";
import { overrideSpec } from "../spec/human.js";
import { readNotes } from "../spec/notes.js";
import { currentResults } from "../spec/results.js";
import { makeRepo } from "../test-repo.js";
import { headContext, implementationState, implementSpec } from "./implementation.js";
import { recordResults, type RecordableResult } from "./test-record.js";
import { looksLikeCredential } from "./credentials.js";

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const A = "docs/specifications/architecture/a.md";
const F = "docs/specifications/features/f.md";
const actor = { role: "standard-user", kind: "human", name: "Pat" } as const;
const llm = { role: "llm", kind: "llm", name: "model", model: "test-model", session: "harness" } as const;
const preset = DEFAULT_PRESET;
const spec = (id: string, body: string, cites: string) => `---\nid: ${id}\ntitle: A\nauthors: [{human: Pat}]\n${cites}\nreferences: []\n---\n\n# A\n\n${body}\n`;
const deterministic = (cmd = "true") => `## R1: Check\n\nTest T1 (deterministic): passes.\n\n\`\`\`specplane-test\nrun: ["${cmd}"]\n\`\`\`\n`;
function repo(body = deterministic(), config = "") {
  const root = makeRepo({ [A]: spec("architecture/a", body, "implements: [f R1]"), [F]: spec("feature/f", "## R1: Feature\n\nText.", "covers: []"), ...(config ? { ".specplane/config.yaml": config } : {}) });
  git(root, "init", "-q", "-b", "main"); git(root, "config", "user.name", "Pat"); git(root, "config", "user.email", "p@t");
  commit(root); return root;
}
function commit(root: string) { git(root, "add", "-A"); git(root, "commit", "-qm", "change"); return git(root, "rev-parse", "HEAD"); }
const state = (root: string) => { const h = headContext(root); return implementationState(h.ctx, h.project.specs.get("architecture/a")!); };
const results = (root: string) => { const h = headContext(root); return currentResults(h.ctx, h.project.specs.get("architecture/a")!); };
const result: RecordableResult = { spec: "architecture/a", test: "R1#T1", kind: "deterministic", outcome: "passed", summary: "Checked true exits successfully." };
const ctx = (root: string) => ({ root, actor, preset });
const withMode = (mode: "deny" | "request-user"): Preset => ({ ...preset, llm: { modes: { ...preset.llm.modes, "test.record": mode } } });

test("recording stores evidence and provenance without touching the spec; either specification edit makes it outdated", () => {
  for (const file of [A, F]) {
    const root = repo(); const before = fs.readFileSync(path.join(root, A), "utf8");
    const r = recordResults(ctx(root), git(root, "rev-parse", "HEAD"), [result]);
    assert.deepEqual(r.recorded, ["R1#T1"]); assert.equal(results(root).get("R1#T1")?.outcome, "passed");
    assert.equal(fs.readFileSync(path.join(root, A), "utf8"), before);
    const rec = readNotes(root).bySpec.get("architecture/a")![0].rec;
    assert.deepEqual(rec.by, { human: "Pat" }); assert.ok((rec.against as any)["feature/f"]);
    fs.appendFileSync(path.join(root, file), "\nChanged.\n"); commit(root);
    assert.equal(results(root).size, 0); assert.equal(readNotes(root).bySpec.get("architecture/a")!.length, 1);
  }
});

test("allow/request/deny recording and acceptance re-check the tested HEAD and preserve the originating actor", async () => {
  const root = repo(); const head = git(root, "rev-parse", "HEAD");
  const denied = recordResults({ root, actor: llm, preset: withMode("deny") }, head, [result]);
  assert.ok(denied.notRecorded); assert.equal(results(root).size, 0);
  const held = recordResults({ root, actor: llm, preset: withMode("request-user") }, head, [result]);
  assert.equal(results(root).size, 0); assert.equal(held.held.length, 1);
  const accepted = await acceptRequest(ctx(root), held.held[0].request);
  assert.equal(accepted.ok, true, accepted.reasons.join(" "));
  assert.deepEqual(results(root).get("R1#T1")?.by, { llm: "test-model" });
  assert.equal((await acceptRequest(ctx(root), held.held[0].request)).ok, false);
  const next = recordResults({ root, actor: llm, preset: withMode("request-user") }, head, [result]);
  fs.writeFileSync(path.join(root, "code.txt"), "unrelated"); commit(root);
  const stale = await acceptRequest(ctx(root), next.held[0].request);
  assert.equal(stale.ok, false); assert.match(stale.reasons.join(" "), /HEAD changed.*nothing was recorded/);
  assert.equal(readNotes(root).bySpec.get("architecture/a")!.length, 1);
});

test("recording rejects invalid kinds, outcomes, unknown IDs and human intelligent verdicts atomically", () => {
  const root = repo("## R1: Judgement\n\nText."); const head = git(root, "rev-parse", "HEAD");
  const verdict = { ...result, test: "R1#0", kind: "intelligent" as const };
  assert.throws(() => recordResults(ctx(root), head, [verdict]), /LLM in a harness/);
  for (const r of [{ ...verdict, outcome: "not-run" }, { ...verdict, kind: "bogus" }, { ...verdict, test: "R9#0" }, { ...verdict, summary: "" }]) {
    assert.throws(() => recordResults({ root, actor: llm, preset }, head, [verdict, r as RecordableResult]));
  }
  assert.equal(readNotes(root).bySpec.size, 0);
});

test("credentials warn without preventing recording", () => {
  const root = repo();
  const r = recordResults(ctx(root), git(root, "rev-parse", "HEAD"), [{ ...result, summary: "token=abc12345" }]);
  assert.equal(r.recorded.length, 1); assert.match(r.warnings[0], /credential/);
  assert.equal(looksLikeCredential("abc123def456abc123def456abc123def456"), true);
  assert.equal(looksLikeCredential("the command passed all checks"), false);
});

test("implement runs committed checks, records their results, ignores dirty edits and retains status only across code commits", async () => {
  const root = repo(); const text = fs.readFileSync(path.join(root, A), "utf8");
  fs.writeFileSync(path.join(root, A), text.replace('["true"]', '["false"]'));
  const r = await implementSpec(ctx(root), "a");
  assert.equal(r.implemented, true); assert.equal(r.dirty, true); assert.equal(results(root).get("R1#T1")?.outcome, "passed");
  fs.writeFileSync(path.join(root, A), text); fs.writeFileSync(path.join(root, "code.txt"), "code"); commit(root);
  assert.equal(state(root).status, "implemented");
  fs.appendFileSync(path.join(root, A), "\nChanged.\n"); commit(root);
  assert.equal(state(root).status, "unimplemented"); assert.equal(state(root).outdated, true);
  fs.writeFileSync(path.join(root, A), text); commit(root); assert.equal(state(root).status, "unimplemented");
});

test("implement refuses failed tests, missing definitions, any current failure, and unsupported layers", async () => {
  const failed = repo(deterministic("false"));
  assert.deepEqual((await implementSpec(ctx(failed), "a")).failed, ["R1#T1"]); assert.equal(state(failed).status, "unimplemented");
  const root = repo();
  overrideSpec({ ...ctx(root), actor: { ...actor, role: "administrator" } }, "test", "architecture/a", ["R9#0", "failed"]);
  assert.deepEqual((await implementSpec(ctx(root), "a")).failed, ["R9#0"]);
  await assert.rejects(implementSpec(ctx(root), "f"), /not an architecture spec/);
  await assert.rejects(implementSpec(ctx(root), "missing"), /not found/);
  const noDef = repo("## R1: Check\n\nTest T1 (deterministic): no block.");
  recordResults(ctx(noDef), git(noDef, "rev-parse", "HEAD"), [result]);
  assert.deepEqual((await implementSpec(ctx(noDef), "a")).missing, ["R1#T1"]);
});

test("intelligent checks require a current harness verdict; unsectioned specs cannot pass vacuously", async () => {
  for (const body of ["## R1: Judgement\n\nText.", "Text without sections."]) {
    const root = repo(body); const id = body.startsWith("##") ? "R1#0" : "architecture/a#0";
    assert.deepEqual((await implementSpec(ctx(root), "a")).needsHarness, [id]);
    recordResults({ root, actor: llm, preset }, git(root, "rev-parse", "HEAD"), [{ ...result, test: id, kind: "intelligent", summary: "Read the implementation; all described behaviour is present." }]);
    assert.equal((await implementSpec(ctx(root), "a")).implemented, true);
  }
});

test("LLM implementation is configurable and recording must be allowed", async () => {
  const root = repo(deterministic(), "architecture:\n  llm_may_mark_implemented: false\n");
  await assert.rejects(implementSpec({ root, actor: llm, preset }, "a"), /llm_may_mark_implemented.*off/);
  for (const mode of ["deny", "request-user"] as const) await assert.rejects(implementSpec({ root, actor: llm, preset: withMode(mode) }, "a"));
  assert.equal(readNotes(root).bySpec.size, 0);
});

test("core and CLI verify implementation checks and write evidence to the notes store", () => {
  const root = repo(); const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  const implemented = run("spec", "implement", "a", "--json");
  assert.equal(implemented.status, 0, implemented.stdout + implemented.stderr);
  assert.equal(state(root).status, "implemented");
  assert.equal(results(root).get("R1#T1")?.outcome, "passed");
  assert.match(run("spec", "--help").stdout, /implement/);
  assert.equal(run("spec", "complete", "a").status, 2);
  assert.equal(run("spec", "implementation", "a", "--status", "complete").status, 2);
  fs.appendFileSync(path.join(root, A), "\n## R2: More\n\nText.\n"); commit(root);
  const needs = run("spec", "implement", "a"); assert.equal(needs.status, 1); assert.match(needs.stderr, /R2#0: needs harness/);
});


test("a moving HEAD during checks cannot receive an implementation declaration", async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "advance.sh"), 'git -C "$ORIGINAL_CHECKOUT" -c core.hooksPath=/dev/null commit --allow-empty -qm advanced\n');
  fs.writeFileSync(path.join(root, A), spec("architecture/a", deterministic().replace('["true"]', '["sh", "advance.sh"]'), "implements: [f R1]"));
  commit(root);
  await assert.rejects(implementSpec({ ...ctx(root), extraEnv: { ORIGINAL_CHECKOUT: root } }, "a"), /HEAD changed while checks ran/);
  assert.equal(state(root).status, "unimplemented");
  assert.ok(!(readNotes(root).bySpec.get("architecture/a") ?? []).some((r) => r.rec.kind === "implementation"));
});
