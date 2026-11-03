import assert from "node:assert/strict";

import * as fs from "node:fs";

import * as path from "node:path";
import { test } from "node:test";

import { createFinishFixture } from "./finish-fixture.js";

const { git, A, repo, fin, finConfirmed, finWithCallback, sha, branchExists } = createFinishFixture();

test("local merge preserves an ignored file colliding with a plan file", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "collision.txt\n");
  fs.writeFileSync(path.join(r.root, "collision.txt"), "user content\n");
  fs.writeFileSync(path.join(r.co, "collision.txt"), "plan content\n");
  git(r.co, "add", "-f", "collision.txt");
  git(r.co, "commit", "-q", "-m", "add collision");
  const result = finConfirmed(r);
  assert.equal(result.code, 1, `${result.out} ${result.err}`);
  assert.equal(fs.readFileSync(path.join(r.root, "collision.txt"), "utf8"), "user content\n");
  assert.ok(fs.existsSync(r.co));
});

test("finish preserves ignored files touched only by intermediate replay commits", () => {
  const r = repo();
  fs.mkdirSync(path.join(r.co, "transient"));
  fs.writeFileSync(path.join(r.co, "transient", "tracked"), "temporary");
  git(r.co, "add", "transient/tracked");
  git(r.co, "commit", "-q", "-m", "add transient");
  git(r.co, "rm", "-q", "transient/tracked");
  git(r.co, "commit", "-q", "-m", "remove transient");
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "transient\n");
  const privatePath = path.join(r.co, "transient");
  const bytes = Buffer.from([0, 1, 2, 255]);
  fs.writeFileSync(privatePath, bytes);
  fs.writeFileSync(path.join(r.root, "advance"), "target");
  git(r.root, "add", "advance");
  git(r.root, "commit", "-q", "-m", "advance target");
  const head = sha(r.co, "HEAD");
  const result = finConfirmed(r);
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Ignored file.*conflicts/);
  assert.deepEqual(fs.readFileSync(privatePath), bytes);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("finish preserves an ignored rename destination during replay", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.co, "original"), "tracked");
  git(r.co, "add", "original");
  git(r.co, "commit", "-q", "-m", "add original");
  git(r.co, "mv", "original", "renamed");
  git(r.co, "commit", "-q", "-m", "rename");
  git(r.co, "rm", "-q", "renamed");
  git(r.co, "commit", "-q", "-m", "remove renamed");
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "renamed\n");
  const file = path.join(r.co, "renamed");
  const bytes = Buffer.from([255, 0, 7]);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(r.root, "advance"), "target");
  git(r.root, "add", "advance");
  git(r.root, "commit", "-q", "-m", "advance target");
  const head = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Ignored file.*conflicts/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("finish refuses to archive ignored files, including those created during confirmation", () => {
  for (const duringConfirmation of [false, true]) {
    const r = repo();
    const file = `plans/${A}/private.bin`;
    const bytes = Buffer.from([0, 255, 42, 10]);
    fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "private.bin\n");
    if (!duringConfirmation) fs.writeFileSync(path.join(r.co, file), bytes);
    const head = sha(r.co, "HEAD");
    const result = finWithCallback(r, duringConfirmation ? `fs.writeFileSync(${JSON.stringify(file)}, Buffer.from([0, 255, 42, 10]));` : "");
    assert.equal(result.code, 1, result.err);
    assert.match(result.err, /Cannot archive plan: ignored file.*would move/);
    assert.deepEqual(fs.readFileSync(path.join(r.co, file)), bytes);
    assert.ok(!fs.existsSync(path.join(r.co, "plans", "archive", A, "private.bin")));
    assert.equal(sha(r.co, "HEAD"), head);
    assert.match(fs.readFileSync(path.join(r.co, "plans", A, "PLAN.md"), "utf8"), /status: ready/);
  }
});

test("finish preserves an existing ignored-only archive destination", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "private.bin\n");
  const dest = path.join(r.co, "plans", "archive", A);
  fs.mkdirSync(dest, { recursive: true });
  const file = path.join(dest, "private.bin");
  const bytes = Buffer.from([255, 0, 12]);
  fs.writeFileSync(file, bytes);
  const head = sha(r.co, "HEAD");
  const result = finConfirmed(r);
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Cannot archive plan: destination.*already exists/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.ok(fs.existsSync(path.join(r.co, "plans", A, "PLAN.md")));
  assert.ok(!fs.existsSync(path.join(dest, A)));
  assert.equal(sha(r.co, "HEAD"), head);
});

test("finish retains a plan checkout containing unrelated ignored files", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "private.txt\n");
  fs.writeFileSync(path.join(r.co, "private.txt"), "keep\n");
  const result = finConfirmed(r);
  assert.equal(result.code, 0, result.err);
  assert.match(result.err, /checkout retained because it contains ignored files/);
  assert.equal(fs.readFileSync(path.join(r.co, "private.txt"), "utf8"), "keep\n");
  assert.ok(branchExists(r.root, `plan/${A}`));
});

test("integrated recovery retains ignored files in the plan checkout", () => {
  const r = repo({ remote: true });
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "private.txt\n");
  fs.writeFileSync(path.join(r.co, "private.txt"), "keep\n");
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.equal(finConfirmed(r).code, 1);
  fs.unlinkSync(hook);
  const retry = finConfirmed(r);
  assert.equal(retry.code, 0, retry.err);
  assert.match(retry.err, /contains ignored files/);
  assert.equal(fs.readFileSync(path.join(r.co, "private.txt"), "utf8"), "keep\n");
  assert.ok(branchExists(r.root, `plan/${A}`));
});

test("branch backend preserves ignored files colliding with an advanced target", () => {
  const r = repo({ exec: "  backend: branch\n" });
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "collision.txt\n");
  fs.writeFileSync(path.join(r.root, "collision.txt"), "user content\n");
  const tree = path.join(r.wt, "target");
  git(r.root, "worktree", "add", "-q", tree, "main");
  fs.writeFileSync(path.join(tree, "collision.txt"), "target content\n");
  git(tree, "add", "-f", "collision.txt");
  git(tree, "commit", "-q", "-m", "target advance");
  const result = finConfirmed(r);
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Ignored file.*conflicts/);
  assert.equal(fs.readFileSync(path.join(r.root, "collision.txt"), "utf8"), "user content\n");
  assert.equal(git(r.root, "branch", "--show-current"), `plan/${A}`);
});
