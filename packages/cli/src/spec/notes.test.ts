import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { approvePlan, createPlan } from "../plan/create.js";
import { loadPlans } from "../plan/model.js";
import { planApproval } from "../plan/status.js";
import { makeRepo } from "../test-repo.js";
import { approveSpecs, reopenSpec, type Ctx } from "./human.js";
import { appendRecords, makeRecord, readNotes } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject } from "./project.js";
import { committedSource, worktreeSource } from "./source.js";
import { computeStatus, StatusCtx } from "./status.js";

/** Status from the notes store (`architecture/file-formats` §4.5, §13.2), on temporary git repositories. */

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" } }).trim();
const F = "docs/specifications/features";
const REQ = "docs/requirements/product.md";
const spec = (body: string, refs = "R1") => `---\nid: feature/a\ntitle: A\nauthors: []\nreferences: [${refs}]\n---\n\n## §1 A\n\n${body}\n`;
let tick = 0;

function setup(body = "one"): { root: string; ctx: () => Ctx } {
  const root = makeRepo({ [REQ]: "# Req\n\n**R1: One**\nExport.\n", [`${F}/a.md`]: spec(body) });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Pat");
  git(root, "config", "user.email", "pat@example.com");
  git(root, "add", "-A"); git(root, "commit", "-qm", "init");
  return { root, ctx: () => ({ root, actor: { kind: "human", role: "standard-user", name: "Pat" }, preset: DEFAULT_PRESET, now: new Date(Date.parse("2026-11-10T12:00:00Z") + 1000 * tick++) }) };
}
const write = (root: string, rel: string, text: string, msg = "edit") => { fs.writeFileSync(path.join(root, rel), text); git(root, "add", "-A"); git(root, "commit", "-qm", msg); };
const status = (root: string, id = "feature/a") => {
  const head = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
  const st = computeStatus(head, head.specs.get(id)!, new StatusCtx(root, head));
  return { status: st.status, reasons: st.reasons };
};

test("approve, then edit, then approve again", async () => {
  const { root, ctx } = setup();
  assert.deepEqual(status(root), { status: "awaiting-review", reasons: ["never-approved"] });
  assert.ok((await approveSpecs(ctx(), ["feature/a"])).ok);
  assert.deepEqual(status(root), { status: "approved", reasons: [] });
  write(root, `${F}/a.md`, spec("two"));
  assert.deepEqual(status(root), { status: "awaiting-review", reasons: ["edited"] });
  assert.ok((await approveSpecs(ctx(), ["feature/a"])).ok);
  assert.equal(status(root).status, "approved");
});

test("a metadata-only edit and an unrelated commit keep the approval", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  write(root, `${F}/a.md`, spec("one").replace("title: A", "title: Better"));
  write(root, "other.txt", "x");
  assert.equal(status(root).status, "approved");
});

test("changed and changed back stays awaiting-review while the approved commit is reachable", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  write(root, `${F}/a.md`, spec("two"));
  write(root, `${F}/a.md`, spec("one"), "revert");
  assert.deepEqual(status(root), { status: "awaiting-review", reasons: ["edited"] });
});

test("squash or rebase: the attached commit is unreachable, so the fingerprint alone decides", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  git(root, "commit", "-q", "--amend", "-m", "squashed");
  assert.notEqual(readNotes(root).bySpec.get("feature/a")![0].commit, git(root, "rev-parse", "HEAD"));
  assert.equal(status(root).status, "approved");
  // The same holds after a change and revert on another history (here: a fresh orphan-like reset to new commits).
  write(root, `${F}/a.md`, spec("two"));
  git(root, "reset", "-q", "--hard", "HEAD~1");
  write(root, "other.txt", "y");
  assert.equal(status(root).status, "approved");
});

test("reopen, then approve the same content again", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  assert.ok(reopenSpec(ctx(), "feature/a").ok);
  assert.deepEqual(status(root), { status: "awaiting-review", reasons: ["edited"] });
  assert.ok((await approveSpecs(ctx(), ["feature/a"])).ok);
  assert.deepEqual(status(root), { status: "approved", reasons: [] });
});

test("records order by at, then rid, not by position in the note", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  const [approval] = readNotes(root).bySpec.get("feature/a")!;
  const later = { ...makeRecord("reopen", "feature/a", approval.rec.fingerprint, { by: { human: "Pat" }, date: "2026-11-10" }), at: "2026-11-11T00:00:00.000Z" };
  const earlier = { ...makeRecord("approval", "feature/a", approval.rec.fingerprint, { by: { human: "Pat" }, date: "2026-11-10", cited: {} }), at: "2020-01-01T00:00:00.000Z" };
  appendRecords(root, approval.commit, [later, earlier]);
  assert.equal(status(root).status, "awaiting-review", "the reopen is newest although it comes first in the note");
});

test("a cited requirement part that changed makes the spec outdated; the requirement never blocks", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  write(root, REQ, "# Req\n\n**R1: One**\nExport as CSV.\n");
  assert.deepEqual(status(root), { status: "awaiting-review", reasons: ["outdated: R1"] });
  assert.equal(status(root, "requirement/product").status, "approved");
});

test("a dependency on a spec without an applicable approval gives unapproved-dependency", async () => {
  const { root, ctx } = setup();
  write(root, `${F}/b.md`, "---\nid: feature/b\ntitle: B\nauthors: []\nreferences: [a §1]\n---\n\n## §1 B\n\nbody\n");
  const ok = await approveSpecs(ctx(), ["feature/b"]);
  assert.equal(ok.ok, false, "approval order is enforced when approving");
  await approveSpecs(ctx(), ["feature/a"]);
  assert.ok((await approveSpecs(ctx(), ["feature/b"])).ok);
  assert.equal(status(root, "feature/b").status, "approved");
  reopenSpec(ctx(), "feature/a");
  assert.deepEqual(status(root, "feature/b"), { status: "awaiting-review", reasons: ["unapproved-dependency: a §1"] });
});

test("an unparseable or incomplete line is skipped with a warning, never silently dropped", async () => {
  const { root, ctx } = setup();
  await approveSpecs(ctx(), ["feature/a"]);
  const head = git(root, "rev-parse", "HEAD");
  const existing = git(root, "notes", "--ref=specplane", "show", head);
  execFileSync("git", ["notes", "--ref=specplane", "add", "-f", "-F", "-", head], { cwd: root, input: `${existing}\nnot json\n{"rid":"x"}\n` });
  const index = readNotes(root);
  assert.equal(index.bySpec.get("feature/a")!.length, 1);
  assert.equal(index.warnings.length, 2);
  assert.equal(status(root).status, "approved");
});

test("a plan step file edit reopens an approved plan; progress.yaml does not", async () => {
  const { root, ctx } = setup();
  const c = ctx();
  const pctx = { root, actor: c.actor, preset: c.preset, now: c.now };
  const { id } = createPlan(pctx, { words: ["notes", "plan"] });
  const dir = `docs/plans/${id}`;
  const state = () => {
    const rec = loadPlans(committedSource(root, "HEAD"), "docs/plans").find((p) => p.id === id)!;
    return planApproval(root, loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths), rec);
  };
  assert.deepEqual(state(), { status: "awaiting-review", reasons: ["never-approved"] });
  approvePlan({ ...pctx, now: ctx().now }, id);
  assert.equal(state().status, "approved");
  write(root, `${dir}/progress.yaml`, "status: not-started\ndone: []\n# note\n");
  assert.equal(state().status, "approved", "execution state is not plan content");
  const step = fs.readFileSync(path.join(root, dir, "steps/01-first-step.md"), "utf8");
  write(root, `${dir}/steps/01-first-step.md`, step.replace("An imperative action.", "Another action."));
  assert.deepEqual(state(), { status: "awaiting-review", reasons: ["edited"] });
  assert.ok(worktreeSource(root).exists(dir));
});
