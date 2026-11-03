import assert from "node:assert/strict";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createFinishFixture } from "./finish-fixture.js";

const { git, gitOk, sp, A, repo, fin, finConfirmed, finWithCallback, sha, branchExists, ghRepo } = createFinishFixture();

test("finalized PR retry requires fresh publication confirmation after target moves", () => {
  const log = path.join(os.tmpdir(), `specplane-retry-tests-${process.pid}-${Date.now()}`);
  const r = repo({ remote: true, merge: "pull_request", planCfg: `  forge: none\n  test_command: echo run >> ${log}\n` });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const failed = finConfirmed(r);
  assert.equal(failed.code, 1, failed.err);
  const finalized = sha(r.co, "HEAD");
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  fs.unlinkSync(hook);
  fs.writeFileSync(path.join(r.root, "new-target.txt"), "advance\n");
  git(r.root, "add", "new-target.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  git(r.root, "push", "-q", "origin", "main");
  const target = sha(r.root, "HEAD");
  const retry = fin(r, "--yes");
  assert.equal(retry.code, 0, retry.err);
  assert.match(retry.err, /ready for fresh finish acceptance/);
  assert.notEqual(sha(r.co, "HEAD"), finalized);
  assert.ok(gitOk(r.co, "merge-base", "--is-ancestor", target, "HEAD"));
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2, "verification reran after rebase");
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  const accepted = finConfirmed(r);
  assert.equal(accepted.code, 0, accepted.err);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  assert.equal(git(r.co, "rev-list", "--count", "--grep=finish", "HEAD"), "1");
  fs.rmSync(log);
});

test("failed local target push reports integrated commit and retry publishes without another merge", () => {
  const r = repo({ remote: true });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const result = finConfirmed(r);
  assert.equal(result.code, 1);
  assert.match(result.err, /was merged into main at [0-9a-f]+, but target publication failed/);
  const merged = sha(r.root, "HEAD");
  assert.equal(git(r.root, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  fs.unlinkSync(hook);
  const retry = finConfirmed(r);
  assert.equal(retry.code, 0, retry.err);
  assert.equal(sha(r.root, "HEAD"), merged);
  assert.equal(sha(r.origin, "main"), merged);
  assert.equal(branchExists(r.root, `plan/${A}`), false);
});

test("integrated recovery refuses unrelated and linked target checkouts before exact plan cleanup", () => {
  const r = repo({ remote: true });
  const target = path.join(r.wt, "target");
  const other = path.join(r.wt, "other");
  git(r.root, "switch", "-q", "-c", "admin");
  git(r.root, "worktree", "add", "-q", target, "main");
  git(r.root, "worktree", "add", "-q", "-b", "unrelated", other, "main");
  fs.writeFileSync(path.join(other, "private.txt"), "preserve me\n");
  git(other, "add", "private.txt");
  git(other, "commit", "-q", "-m", "unrelated data");
  const unrelatedHead = sha(other, "HEAD");
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.equal(finConfirmed(r).code, 1);
  fs.unlinkSync(hook);
  const before = git(r.root, "worktree", "list", "--porcelain");
  for (const cwd of [other, target]) {
    const result = sp(cwd, "plan", "finish", A, "--yes");
    assert.equal(result.code, 1, result.err);
    assert.match(result.err, /clean registered checkout/);
    assert.equal(git(r.root, "worktree", "list", "--porcelain"), before);
    assert.equal(sha(other, "HEAD"), unrelatedHead);
    assert.equal(fs.readFileSync(path.join(other, "private.txt"), "utf8"), "preserve me\n");
    assert.equal(git(other, "branch", "--show-current"), "unrelated");
  }
  const retry = finConfirmed(r);
  assert.equal(retry.code, 0, retry.err);
  assert.ok(!fs.existsSync(r.co));
  assert.ok(fs.existsSync(target));
  assert.ok(fs.existsSync(other));
  assert.equal(branchExists(r.root, `plan/${A}`), false);
});

test("finalized PR retry displays current gaps in both confirmations", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  fs.writeFileSync(path.join(r.co, "plans", A, "spec-gaps.md"), "# Gaps\n\n## G1: missing text\n\n**Kind**: assumption\n**Step**: 1\n**Case**: no message for X\n**Resolution**: used Y\n**Target spec**: `feature/example`\n**Status**: open\n");
  git(r.co, "add", "-A");
  git(r.co, "commit", "-q", "-m", "record gap");
  const first = finWithCallback(r, "if (count === 2) return false;");
  assert.equal(first.code, 0, first.err);
  const retry = finWithCallback(r, `if (!q.includes("it works") || !q.includes("G1 (assumption, feature/example): no message for X")) throw new Error("missing acceptance evidence " + count);`);
  assert.equal(retry.code, 0, retry.err);
  assert.match(retry.out, /pushed/);
});

test("finalization hook failure reports retained checkout for recovery", () => {
  const r = repo();
  const gitdir = git(r.co, "rev-parse", "--absolute-git-dir");
  const common = path.resolve(gitdir, git(r.co, "rev-parse", "--git-common-dir"));
  const hook = path.join(common, "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const before = sha(r.co, "HEAD");
  const result = finConfirmed(r);
  assert.equal(result.code, 1);
  assert.match(result.err, /Finalization failed; plan HEAD is .*Operation-owned finish edits were restored/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(git(r.co, "status", "--porcelain"), "");
  assert.match(fs.readFileSync(path.join(r.co, "plans", A, "PLAN.md"), "utf8"), /status: ready/);
  fs.unlinkSync(hook);
});

test("failed PR creation reports the already-pushed plan head", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "unused");
  const program = path.join(path.dirname(log), "gh");
  fs.writeFileSync(program, "#!/bin/sh\n[ \"$1\" = \"--version\" ] && exit 0\n[ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ] && { echo '[]'; exit 0; }\nexit 2\n", { mode: 0o755 });
  const result = finConfirmed(r, false, env);
  assert.equal(result.code, 1);
  const head = sha(r.co, "HEAD");
  assert.match(result.err, new RegExp(`Published plan/${A} at ${head}.*pull request creation failed`));
  assert.equal(sha(r.origin, `plan/${A}`), head);
});

test("finalized local retry after rebase requires renewed acceptance before merge", () => {
  const r = repo();
  const first = finWithCallback(r, "if (count === 2) return false;");
  assert.equal(first.code, 0, first.err);
  const done = sha(r.co, "HEAD");
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
  fs.writeFileSync(path.join(r.root, "advance.txt"), "advanced\n");
  git(r.root, "add", "advance.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  const target = sha(r.root, "HEAD");
  const unattended = fin(r, "--yes");
  assert.equal(unattended.code, 0, unattended.err);
  assert.match(unattended.err, /ready for fresh finish acceptance/);
  assert.notEqual(sha(r.co, "HEAD"), done);
  assert.equal(sha(r.root, "HEAD"), target);
  const accepted = finConfirmed(r);
  assert.equal(accepted.code, 0, accepted.err);
  assert.match(accepted.out, /Finished and merged/);
});

test("failed review claim push is published on retry before finalization", () => {
  const r = repo({ remote: true, planCfg: "  status_source: frontmatter\n" });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const failed = fin(r, "--yes");
  assert.equal(failed.code, 1);
  assert.match(failed.err, /Review claim [0-9a-f]+ remains on main; publication may be pending/);
  const claim = sha(r.root, "HEAD");
  assert.notEqual(sha(r.origin, "main"), claim);
  fs.unlinkSync(hook);
  const retry = fin(r, "--yes");
  assert.equal(retry.code, 0, retry.err);
  assert.equal(sha(r.origin, "main"), claim);
  assert.match(retry.out, /Ready for finalization/);
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
});

test("finalization failure preserves unexpected hook edits for recovery", () => {
  const r = repo();
  const common = git(r.co, "rev-parse", "--git-common-dir");
  const hook = path.join(common, "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nprintf 'hook edit\\n' > base.txt\nexit 1\n", { mode: 0o755 });
  const result = finConfirmed(r);
  assert.equal(result.code, 1);
  assert.match(result.err, /Finish edits were retained because the checkout or index changed unexpectedly/);
  assert.equal(fs.readFileSync(path.join(r.co, "base.txt"), "utf8"), "hook edit\n");
  assert.notEqual(git(r.co, "status", "--porcelain"), "");
  fs.unlinkSync(hook);
});
