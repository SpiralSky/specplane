import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { createPlan } from "../plan/create.js";
import { loadPlans } from "../plan/model.js";
import { planApproval } from "../plan/status.js";
import { makeRepo } from "../test-repo.js";
import { validateProject } from "../verify/validate.js";
import { migrateStatus } from "./migrate.js";
import { readNotes } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject } from "./project.js";
import { committedSource } from "./source.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" };
const git = (root: string, ...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8", env: ENV }).trim();
const F = "docs/specifications/features";
const REQ = "docs/requirements/product.md";
const legacy = (id: string, extra: string, body = "## R1: One\n\nText of " + id + ".\n") =>
  `---\nid: feature/${id}\ntitle: ${id}\n${extra}authors: []\ncovers: [R1]\n---\n\n${body}`;
const hand = (commit: string) => `status: approved\napproval:\n  by:\n    human: Pat\n  date: 2026-11-01\n  commit: ${commit}\n`;

function setup(): { root: string; first: string } {
  const root = makeRepo({ [REQ]: "# Req\n\n**R1: One**\nExport.\n", [`${F}/a.md`]: legacy("a", "status: awaiting-review\n") });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Pat"); git(root, "config", "user.email", "pat@example.com");
  git(root, "add", "-A"); git(root, "commit", "-qm", "content");
  const first = git(root, "rev-parse", "HEAD");
  // a: hand approval naming the content commit, no fingerprint; b: stored fingerprint and cited, with an override mark;
  // c: results and implementation; d: awaiting review with a review reason only.
  const w = (rel: string, text: string) => fs.writeFileSync(path.join(root, rel), text);
  w(`${F}/a.md`, legacy("a", hand(first)));
  w(`${F}/c.md`, legacy("c", "status: awaiting-review\n"));
  w(`${F}/d.md`, legacy("d", "status: awaiting-review\nreview-reason: edited\n"));
  git(root, "add", "-A"); git(root, "commit", "-qm", "more content");
  w(REQ, "---\nid: requirement/product\nstatus: approved\n---\n\n# Req\n\n**R1: One**\nExport.\n");
  return { root, first };
}

test("migrate status: dry run lists, a run moves records and removes the keys in one branch commit, a rerun does nothing", async () => {
  const { root, first } = setup();
  // b and c need their fingerprints, so compute them the way approval would.
  const { specFingerprint, partFingerprint } = await import("./fingerprint.js");
  const bBody = legacy("b", "", "## R1: One\n\nText of b.\n");
  const fpB = specFingerprint(bBody)!;
  fs.writeFileSync(path.join(root, `${F}/b.md`), legacy("b", `status: approved\napproval:\n  by:\n    human: Pat\n  date: 2026-11-02\n  commit: ${"0".repeat(40)}\n  fingerprint: ${fpB}\n  cited:\n    R1: ${partFingerprint("**R1: One**\nExport.")}\n  override:\n    by:\n      human: Admin\n    date: 2026-11-03\n`, "## R1: One\n\nText of b.\n"));
  const cText = fs.readFileSync(path.join(root, `${F}/c.md`), "utf8").replace("status: awaiting-review\n", `status: awaiting-review\nresults:\n  - {test: "R1#T1", kind: deterministic, outcome: passed, by: {human: Pat}, date: 2026-11-04, commit: ${first}, fingerprint: "${specFingerprint(legacy("c", ""))}", summary: ok}\nimplementation: {status: implemented, commit: ${first}, by: {human: Pat}, date: 2026-11-04}\n`);
  fs.writeFileSync(path.join(root, `${F}/c.md`), cText);
  git(root, "add", "-A"); git(root, "commit", "-qm", "b and c");
  const before = validateProject(root);
  assert.equal(before.statuses.find((s) => s.id === "feature/a")!.effective, "awaiting-review", "legacy keys are ignored");

  const dry = migrateStatus(root, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.items.map((i) => `${i.item.spec}:${i.item.kind}`).sort(), ["feature/a:approval", "feature/b:override", "feature/c:implementation", "feature/c:test-result"]);
  assert.equal(readNotes(root).bySpec.size, 0, "a dry run writes nothing");
  assert.ok(dry.warnings.some((w) => w.includes(REQ) && /by hand/.test(w)), "requirement files are skipped with a warning");

  const head = git(root, "rev-parse", "HEAD");
  const r = migrateStatus(root);
  assert.equal(git(root, "rev-list", "--count", `${head}..HEAD`), "1", "one branch commit");
  assert.equal(git(root, "log", "-1", "--format=%s"), "docs(specs): move records to notes");
  assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["a", "b", "c", "d"].map((x) => `${F}/${x}.md`));
  for (const x of ["a", "b", "c", "d"]) assert.doesNotMatch(fs.readFileSync(path.join(root, `${F}/${x}.md`), "utf8"), /^(status|approval|review-reason|results|implementation):/m);
  assert.match(fs.readFileSync(path.join(root, REQ), "utf8"), /status: approved/, "requirement file untouched");
  assert.equal(r.files.length, 4);

  const notes = readNotes(root);
  const a = notes.bySpec.get("feature/a")![0];
  assert.equal(a.commit, first, "attached to the recorded commit");
  assert.equal(a.rec.kind, "approval");
  assert.deepEqual(a.rec.by, { human: "Pat" });
  assert.match(a.rec.fingerprint, /^spec-v3:/);
  assert.equal(notes.bySpec.get("feature/b")![0].rec.target, "status");
  assert.equal(notes.bySpec.get("feature/b")![0].commit, head, "a missing commit falls back to HEAD");
  const tr = notes.bySpec.get("feature/c")!.find((s) => s.rec.kind === "test-result")!.rec;
  assert.equal(tr["test-kind"], "deterministic");
  assert.equal(tr.test, "R1#T1");

  // The fingerprints are unchanged, so every migrated approval still applies.
  const after = validateProject(root);
  assert.equal(after.statuses.find((s) => s.id === "feature/a")!.effective, "approved");
  assert.equal(after.statuses.find((s) => s.id === "feature/b")!.effective, "approved");
  assert.equal(after.statuses.find((s) => s.id === "feature/d")!.effective, "awaiting-review");

  const again = migrateStatus(root);
  assert.deepEqual([again.items.length, again.files.length, again.commit], [0, 0, null]);
});

test("migrate status: a failed run is safe to rerun; no duplicate records are appended", () => {
  const { root } = setup();
  git(root, "add", "-A"); git(root, "commit", "-qm", "req");
  migrateStatus(root);
  const count = () => [...readNotes(root).bySpec.values()].flat().length;
  const n = count();
  git(root, "reset", "-q", "--hard", "HEAD~1");
  const rerun = migrateStatus(root);
  assert.ok(rerun.skipped >= 1);
  assert.equal(count(), n, "records are appended only when none exists from an earlier run");
  assert.equal(rerun.items.length, 0);
  assert.ok(rerun.commit, "the files still get their keys removed");
});

test("migrate status refuses when a file to edit has uncommitted changes, and CLI --dry-run works", () => {
  const { root } = setup();
  git(root, "add", "-A"); git(root, "commit", "-qm", "req");
  fs.appendFileSync(path.join(root, `${F}/a.md`), "dirty\n");
  assert.throws(() => migrateStatus(root), /uncommitted changes/);
  assert.equal(readNotes(root).bySpec.size, 0, "nothing written before the check");
  git(root, "checkout", "--", `${F}/a.md`);
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  const dry = run("migrate", "status", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would write approval record for feature\/a/);
  const real = run("migrate", "status");
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /Committed [0-9a-f]{7}: docs\(specs\): move records to notes/);
});

test("migrate status: a legacy plan approval becomes a record that applies to the plan", () => {
  const { root } = setup();
  const pctx = { root, actor: { kind: "human" as const, role: "standard-user" as const, name: "Pat" }, preset: DEFAULT_PRESET, now: new Date("2026-11-10T12:00:00Z") };
  const { id } = createPlan(pctx, { words: ["move", "records"] });
  const planFile = path.join(root, "docs/plans", id, "PLAN.md");
  const text = fs.readFileSync(planFile, "utf8").replace("authors:", `status: approved\napproval:\n  by:\n    human: Pat\n  date: 2026-11-05\n  commit: ${git(root, "rev-parse", "HEAD")}\nauthors:`);
  fs.writeFileSync(planFile, text);
  git(root, "add", "-A"); git(root, "commit", "-qm", "legacy plan approval");
  const state = () => {
    const rec = loadPlans(committedSource(root, "HEAD"), "docs/plans").find((p) => p.id === id)!;
    return planApproval(root, loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths), rec).status;
  };
  assert.equal(state(), "awaiting-review");
  const r = migrateStatus(root);
  assert.ok(r.items.some((i) => i.item.spec === `plan/${id}` && i.item.kind === "approval"));
  assert.ok(!/^status:/m.test(fs.readFileSync(planFile, "utf8")));
  assert.equal(state(), "approved");
});
