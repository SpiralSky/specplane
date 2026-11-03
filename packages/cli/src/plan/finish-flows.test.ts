import assert from "node:assert/strict";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createFinishFixture } from "./finish-fixture.js";

const { git, gitOk, sp, A, ownedDirs, repo, fin, finConfirmed, sha, branchExists, ghRepo, finEnv } = createFinishFixture();

test("finish: local merge without a remote (Scenarios 4, 4a)", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, "later.txt"), "x");
  git(r.root, "add", "later.txt");
  git(r.root, "commit", "-q", "-m", "main moves");
  const first = fin(r, "--yes");
  assert.equal(first.code, 0, first.err);
  assert.match(first.err, /ready to merge/);
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /Finished and merged/);
  assert.equal(git(r.root, "rev-list", "--parents", "-n", "1", "main").split(" ").length, 3, "merge commit");
  assert.ok(fs.existsSync(path.join(r.root, "plans", "archive", A, "PLAN.md")));
  assert.ok(!fs.existsSync(path.join(r.root, "plans", A)));
  assert.match(fs.readFileSync(path.join(r.root, "plans", "archive", A, "PLAN.md"), "utf8"), /status: done/);
  assert.ok(!fs.existsSync(r.co), "worktree removed");
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  const body = git(r.root, "log", "--format=%B", "--grep=finish", "-n", "1", "main");
  assert.match(body, /chore\(specplane\): finish 2026-01-01-alpha/);
  assert.match(body, /Specplane-Workflow: finish/);
  assert.match(first.err, /Acceptance criteria/);
});

test("finish: --no-fetch skips the fetch; pushes and merges still happen", () => {
  const r = repo({ remote: true });
  // The remote no longer has `main`, so any fetch fails while local refs are intact.
  git(r.origin, "branch", "-D", "main");
  const bad = fin(r, "--yes");
  assert.notEqual(bad.code, 0, "a fetch failure surfaces without --no-fetch");
  const ready = fin(r, "--yes", "--no-fetch");
  assert.equal(ready.code, 0, ready.err);
  assert.match(ready.err, /ready to merge/);
  const ok = finConfirmed(r, true);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Finished and merged/);
  assert.equal(git(r.origin, "rev-parse", "main"), git(r.root, "rev-parse", "main"), "merged commit pushed");
});

test("finish: lists open spec-gaps entries without blocking", () => {
  const r = repo();
  fs.writeFileSync(
    path.join(r.co, "plans", A, "spec-gaps.md"),
    "# Spec gaps — " + A + "\n\n## G1: missing text\n\n**Kind**: assumption\n**Step**: 1\n**Case**: no message for X\n**Resolution**: used Y\n**Target spec**: `feature/example`\n**Status**: open\n\n## G2: settled\n\n**Kind**: gap\n**Step**: 1\n**Case**: Z\n**Resolution**: done\n**Target spec**: `feature/example`\n**Status**: applied\n",
  );
  git(r.co, "add", "-A");
  git(r.co, "commit", "-q", "-m", "gaps");
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /Open spec gaps:\n  G1 \(assumption, feature\/example\): no message for X/);
  assert.doesNotMatch(res.err, /G2/, "only open entries are listed");
});

test("finish: step not done stops with no writes (Scenario 5a)", () => {
  const r = repo({ steps: ["done", "blocked"] });
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot finish: step 02 is `blocked`\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.equal(sp(r.co, "plan", "finish", A).code, 1);
});

test("finish: wrong branch and dirty tree fail with no writes", () => {
  const r = repo();
  let res = sp(r.root, "plan", "finish", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot finish: the checkout is on `main`, not `plan\/2026-01-01-alpha`\./);
  fs.appendFileSync(path.join(r.co, "base.txt"), "dirty");
  res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /uncommitted changes/);
});

test("finish: failing tests stop the flow without a commit (Scenario 5)", () => {
  const r = repo({ planCfg: "  test_command: exit 1\n" });
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /Verification failed: `exit 1` exited with code 1\. Fix failing tests before finishing\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.ok(branchExists(r.root, `plan/${A}`));
});

test("finish: tests re-run after a rebase that applied commits", () => {
  const log = path.join(os.tmpdir(), `specplane-testlog-${process.pid}-${Date.now()}`);
  const r = repo({ planCfg: `  test_command: echo run >> ${log}\n`, remote: false });
  fs.writeFileSync(path.join(r.root, "later.txt"), "x");
  git(r.root, "add", "later.txt");
  git(r.root, "commit", "-q", "-m", "main moves");
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2);
  fs.rmSync(log);
});

test("finish: rebase conflict aborts and leaves the branch unchanged", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.co, "base.txt"), "plan side\n");
  git(r.co, "commit", "-qam", "plan edit");
  fs.writeFileSync(path.join(r.root, "base.txt"), "main side\n");
  git(r.root, "commit", "-qam", "main edit");
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /Rebase of `plan\/2026-01-01-alpha` onto `[0-9a-f]+` has conflicts; resolve manually\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.ok(!fs.existsSync(path.join(r.root, ".git", "worktrees", A, "rebase-merge")));
});

test("finish: without --yes and no human, stops ready; a re-run merges (resume)", () => {
  const r = repo();
  let res = fin(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /ready to merge/);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
  const done = sha(r.co, "HEAD");
  res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-list", "--count", "--grep=finish", "main"), "1", "no second finish commit");
  assert.ok(gitOk(r.root, "merge-base", "--is-ancestor", done, "main"));
});

test("finish: merge stops when the main checkout is on another branch", () => {
  const r = repo();
  git(r.root, "switch", "-q", "-c", "other");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /clean checkout of target `main`/);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.notEqual(git(r.co, "log", "-1", "--format=%s").startsWith("chore(specplane): finish"), true);
});

test("finish: local merge pushes the default branch when a remote exists", () => {
  const r = repo({ remote: true });
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(sha(r.origin, "main"), sha(r.root, "main"));
});

test("finish: pull_request pushes the branch and prints instructions", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /Finished and pushed/);
  assert.match(res.err, /Open a pull request from `plan\/2026-01-01-alpha` into `main`/);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  assert.ok(fs.existsSync(r.co), "worktree kept until cleanup");
});

test("finish: pull_request with a forge pushes, opens a PR from the plan, prints the URL", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "https://github.com/o/r/pull/3");
  const res = finConfirmed(r, false, env);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /Opened pull request: https:\/\/github\.com\/o\/r\/pull\/3/);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  const calls = fs.readFileSync(log, "utf8");
  assert.match(calls, /pr\ncreate\n--head\nplan\/2026-01-01-alpha\n--base\nmain\n--title\nT\n--body\n/);
  assert.match(calls, /Plan `2026-01-01-alpha`/);
  assert.match(calls, /- \[ \] it works/);
});

test("finish: pull_request with forge none prints manual instructions and never calls gh", () => {
  const { r, env, log } = ghRepo("  forge: none\n", "unused");
  const res = finConfirmed(r, false, env);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /Open a pull request from/);
  assert.equal(fs.existsSync(log), false);
});

test("finish: pull_request without a remote fails with no writes", () => {
  const r = repo({ merge: "pull_request" });
  const head = sha(r.co, "HEAD");
  const res = fin(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /needs a remote/);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("finish: frontmatter mode claims review on the default branch first", () => {
  const r = repo({ planCfg: "  status_source: frontmatter\n", remote: false });
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  const log = git(r.root, "log", "--format=%s", "main");
  assert.match(log, /claim 2026-01-01-alpha review/);
  assert.match(log, /finish 2026-01-01-alpha/);
});

test("finish: branch backend switches back to the default branch and deletes the branch", () => {
  const r = repo({ exec: "  backend: branch\n" });
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  assert.equal(git(r.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  assert.ok(fs.existsSync(path.join(r.root, "plans", "archive", A, "PLAN.md")));
});

test("finish: external backend rejects local_merge", () => {
  const r = repo({ exec: "  backend: external\n" });
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /`external` backend does not support `local_merge`/);
});

test("finish refuses a missing target checkout before changing the plan", () => {
  const r = repo({ target: "release" });
  git(r.root, "switch", "-q", "main");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /clean checkout of target `release`/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("finish rebases on a remote-ahead recorded target and advertises its PR base", () => {
  const r = repo({ target: "release", remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-remote-ahead-"));
  ownedDirs.push(clone);
  git(clone, "clone", "-q", r.origin, ".");
  git(clone, "switch", "-q", "release");
  fs.writeFileSync(path.join(clone, "remote.txt"), "remote\n");
  git(clone, "add", "remote.txt");
  git(clone, "commit", "-q", "-m", "remote target advances");
  git(clone, "push", "-q", "origin", "release");
  const remoteTip = sha(clone, "HEAD");
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /into `release`/);
  assert.ok(gitOk(r.co, "merge-base", "--is-ancestor", remoteTip, "HEAD"));
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
});

test("finish refuses a wrong-base open PR before changing or pushing the plan", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "unused");
  const program = path.join(path.dirname(log), "gh");
  fs.writeFileSync(program, `#!/bin/sh\n[ "$1" = "--version" ] && exit 0\n[ "$1" = "pr" ] && [ "$2" = "list" ] && { echo '[{"url":"https://github.com/o/r/pull/1","baseRefName":"other"}]'; exit 0; }\nexit 2\n`, { mode: 0o755 });
  const before = sha(r.co, "HEAD");
  const result = finEnv(r, env);
  assert.equal(result.code, 2);
  assert.match(result.err, /base conflicts with recorded target/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
});

test("a manual done edit does not impersonate a completed finish", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: done"));
  git(r.co, "commit", "-qam", "manual done");
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /no matching finish commit/);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("forge receives the recorded nondefault PR base", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "https://github.com/o/r/pull/7", "release");
  const result = finConfirmed(r, false, env);
  assert.equal(result.code, 0, result.err);
  assert.match(fs.readFileSync(log, "utf8"), /pr\ncreate\n--head\nplan\/2026-01-01-alpha\n--base\nrelease\n/);
});

test("verification edits to target checkout refuse before review claim", () => {
  const r = repo({ planCfg: "  status_source: frontmatter\n" });
  const cfg = path.join(r.root, ".specplane", "config.yaml");
  fs.writeFileSync(cfg, fs.readFileSync(cfg, "utf8").replace("  merge: local_merge\n", `  merge: local_merge\n  test_command: 'printf edited > ${r.root}/base.txt'\n`));
  git(r.root, "add", ".specplane/config.yaml");
  git(r.root, "commit", "-q", "-m", "configure verification");
  const target = sha(r.root, "HEAD");
  const head = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /clean checkout of target/);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.equal(fs.readFileSync(path.join(r.root, "base.txt"), "utf8"), "edited");
});

test("finish rejects a noncanonical stored stack base before rewriting", () => {
  const r = repo();
  git(r.co, "commit", "--allow-empty", "-q", "-m", `chore(specplane): stack ${A} on ${A}\n\nSpecplane-Workflow: stack\nSpecplane-Plan: ${A}\nSpecplane-Stack-Base: HEAD`);
  const head = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Invalid stored commit: HEAD/);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("branch backend resumes target publication without deleting the retained plan branch", () => {
  const r = repo({ remote: true, exec: "  backend: branch\n" });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const failed = finConfirmed(r);
  assert.equal(failed.code, 1, failed.err);
  fs.unlinkSync(hook);
  const unattended = fin(r, "--yes");
  assert.equal(unattended.code, 0, unattended.err);
  assert.match(unattended.err, /awaits publication confirmation/);
  assert.notEqual(sha(r.root, "main"), sha(r.origin, "main"));
  const retry = finConfirmed(r);
  assert.equal(retry.code, 0, retry.err);
  assert.equal(sha(r.root, "main"), sha(r.origin, "main"));
  assert.ok(branchExists(r.root, `plan/${A}`));
});
