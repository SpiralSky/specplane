import assert from "node:assert/strict";

import * as fs from "node:fs";

import * as path from "node:path";
import { test } from "node:test";
import { createLifecycleFixture } from "./lifecycle-fixture.js";

const { git, sp, A, B, plan, repo, wtOf, start, hasBranch } = createLifecycleFixture();

test("cleanup: refuses until done on main; then removes worktree and branch; idempotent", () => {
  const r = repo();
  start(r, A);
  const wt = wtOf(r, A);
  let res = sp(r.root, "plan", "cleanup", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /unverified/);
  assert.ok(fs.existsSync(wt) && hasBranch(r, A), "nothing removed");

  const planFile = path.join(wt, "plans", A, "PLAN.md");
  fs.writeFileSync(planFile, fs.readFileSync(planFile, "utf8").replace("status: ready", "status: done"));
  git(wt, "commit", "-qam", "done");
  git(r.root, "merge", "-q", "--no-ff", `plan/${A}`, "-m", "merge plan");
  fs.writeFileSync(path.join(wt, "base.txt"), "dirty\n");
  res = sp(r.root, "plan", "cleanup", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /uncommitted changes/);
  assert.ok(hasBranch(r, A));

  res = sp(r.root, "plan", "cleanup", A, "--force");
  assert.equal(res.code, 0, res.err);
  assert.ok(!fs.existsSync(wt));
  assert.ok(!hasBranch(r, A));
  res = sp(r.root, "plan", "cleanup", A);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /nothing to do/);
});

test("archive: moves done and abandoned plans; errors otherwise", () => {
  const r = repo("  archive_done: false\n");
  let res = sp(r.root, "plan", "archive", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /`ready`, not `done` or `abandoned`/);
  fs.writeFileSync(path.join(r.root, "plans", A, "PLAN.md"), plan(A, "done"));
  git(r.root, "commit", "-qam", "done");
  res = sp(r.root, "plan", "archive", A);
  assert.equal(res.code, 0, res.err);
  assert.ok(fs.existsSync(path.join(r.root, "plans", "archive", A, "PLAN.md")));
  const body = git(r.root, "log", "-1", "--format=%B");
  assert.match(body, /^chore\(specplane\): archive 2026-01-01-alpha\n/);
  assert.match(body, /Specplane-Workflow: archive/);
  res = sp(r.root, "plan", "archive", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /already archived/);
  // An abandoned plan archives too.
  fs.writeFileSync(path.join(r.root, "plans", B, "PLAN.md"), plan(B, "abandoned"));
  git(r.root, "commit", "-qam", "abandoned");
  assert.equal(sp(r.root, "plan", "archive", B).code, 0);
  assert.equal(git(r.root, "status", "--porcelain"), "");
});

test("archive refuses ignored files and staged changes without moving them", () => {
  const r = repo("  archive_done: false\n");
  fs.writeFileSync(path.join(r.root, "plans", A, "PLAN.md"), plan(A, "done"));
  fs.writeFileSync(path.join(r.root, ".gitignore"), "secret.txt\n"); git(r.root, "add", ".gitignore", `plans/${A}/PLAN.md`); git(r.root, "commit", "-qm", "done");
  const secret = path.join(r.root, "plans", A, "secret.txt"); fs.writeFileSync(secret, "keep");
  assert.equal(sp(r.root, "plan", "archive", A).code, 1); assert.equal(fs.readFileSync(secret, "utf8"), "keep");
  fs.rmSync(secret); fs.writeFileSync(path.join(r.root, "base.txt"), "staged"); git(r.root, "add", "base.txt");
  assert.equal(sp(r.root, "plan", "archive", A).code, 1); assert.equal(git(r.root, "diff", "--cached", "--name-only"), "base.txt");
});

test("cleanup uses the recorded non-default target and preserves ignored checkout files", () => {
  const r = repo("  target_branch: integration\n");
  git(r.root, "switch", "-qc", "integration");
  fs.writeFileSync(path.join(r.root, ".gitignore"), "secret.txt\n"); git(r.root, "add", ".gitignore"); git(r.root, "commit", "-qm", "ignore");
  start(r, A); const wt = wtOf(r, A);
  const f = path.join(wt, "plans", A, "PLAN.md"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("status: ready", "status: done"));
  git(wt, "commit", "-qam", "done"); git(r.root, "merge", "-q", "--no-ff", `plan/${A}`, "-m", "integrate");
  fs.writeFileSync(path.join(wt, "secret.txt"), "preserve");
  const blocked = sp(r.root, "plan", "cleanup", A, "--force"); assert.equal(blocked.code, 1); assert.match(blocked.err, /ignored files/);
  assert.equal(fs.readFileSync(path.join(wt, "secret.txt"), "utf8"), "preserve"); fs.rmSync(path.join(wt, "secret.txt"));
  const done = sp(r.root, "plan", "cleanup", A); assert.equal(done.code, 0, done.err); assert.equal(hasBranch(r, A), false);
});
