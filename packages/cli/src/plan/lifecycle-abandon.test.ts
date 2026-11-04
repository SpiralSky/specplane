import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createLifecycleFixture } from "./lifecycle-fixture.js";
import { capturePlanSnapshot } from "../generate/snapshot.js";
import { generatePlansMd } from "../generate/plans-md.js";

const { git, sp, A, B, plan, ownedDirs, repo, wtOf, start, hasBranch } = createLifecycleFixture();

test("abandon: commits on main, archives, removes worktree, and resumes cleanup", () => {
  const r = repo();
  start(r, A);
  const res = sp(r.root, "plan", "abandon", A);
  assert.equal(res.code, 0, res.err);
  const body = git(r.root, "log", "-1", "--format=%B");
  assert.match(body, /^chore\(specplane\): abandon 2026-01-01-alpha\n/);
  assert.match(body, /Specplane-Workflow: abandon/);
  assert.match(fs.readFileSync(path.join(r.root, "plans", "archive", A, "PLAN.md"), "utf8"), /status: abandoned/);
  assert.ok(!fs.existsSync(path.join(r.root, "plans", A)));
  assert.ok(!fs.existsSync(wtOf(r, A)), "worktree removed");
  assert.ok(hasBranch(r, A), "branch kept");
  const head = git(r.root, "rev-parse", "HEAD");
  const again = sp(r.root, "plan", "abandon", A, "--delete-branch");
  assert.equal(again.code, 1);
  assert.match(again.err, /is `abandoned`/);
  assert.equal(git(r.root, "rev-parse", "HEAD"), head, "no second commit");
  assert.ok(hasBranch(r, A), "completed abandonment retains the branch");
  assert.equal(git(r.root, "status", "--porcelain"), "");
});

test("abandon: dirty worktree refuses without --force and leaves no partial state", () => {
  const r = repo("  archive_done: false\n");
  start(r, A);
  fs.writeFileSync(path.join(wtOf(r, A), "base.txt"), "dirty\n");
  const head = git(r.root, "rev-parse", "HEAD");
  const res = sp(r.root, "plan", "abandon", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /uncommitted changes/);
  assert.equal(git(r.root, "rev-parse", "HEAD"), head);
  assert.match(fs.readFileSync(path.join(r.root, "plans", A, "PLAN.md"), "utf8"), /status: ready/);
  const forced = sp(r.root, "plan", "abandon", A, "--force");
  assert.equal(forced.code, 0, forced.err);
  assert.ok(!fs.existsSync(wtOf(r, A)));
  assert.match(fs.readFileSync(path.join(r.root, "plans", A, "PLAN.md"), "utf8"), /status: abandoned/);
});

test("abandon: wrong branch and done plans fail with no writes", () => {
  const r = repo();
  git(r.root, "switch", "-q", "-c", "other");
  let res = sp(r.root, "plan", "abandon", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /provide an up-to-date target checkout/);
  git(r.root, "switch", "-q", "main");
  fs.writeFileSync(path.join(r.root, "plans", A, "PLAN.md"), plan(A, "done"));
  git(r.root, "commit", "-qam", "done");
  res = sp(r.root, "plan", "abandon", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /is `done`/);
  fs.writeFileSync(path.join(r.root, "plans", A, "PLAN.md"), plan(A, "abandoned"));
  git(r.root, "commit", "-qam", "abandoned");
  res = sp(r.root, "plan", "abandon", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot abandon plan: `2026-01-01-alpha` is `abandoned`\./);
  assert.equal(sp(r.root, "plan", "abandon", "2026-01-09-none").code, 1);
});

test("abandon: shelved target rolls back a failed commit and retries publication of the same commit", () => {
  const r = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-abandon-remote-")); ownedDirs.push(bare);
  git(bare, "init", "--bare", "-q"); git(r.root, "remote", "add", "origin", bare); git(r.root, "push", "-u", "origin", "main");
  start(r, A);
  const file = path.join(r.root, "plans", A, "PLAN.md");
  fs.writeFileSync(file, plan(A, "shelved", "shelved_from: ready\n")); git(r.root, "commit", "-qam", "shelve"); git(r.root, "push", "origin", "main");
  const before = git(r.root, "rev-parse", "HEAD");
  const hook = path.join(r.root, ".git", "hooks", "pre-commit"); fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.notEqual(sp(r.root, "plan", "abandon", A).code, 0); fs.rmSync(hook);
  assert.equal(git(r.root, "rev-parse", "HEAD"), before); assert.match(fs.readFileSync(file, "utf8"), /shelved_from: ready/); assert.equal(git(r.root, "status", "--porcelain"), "");
  const reject = path.join(bare, "hooks", "pre-receive"); fs.writeFileSync(reject, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const failed = sp(r.root, "plan", "abandon", A); assert.equal(failed.code, 1); assert.match(failed.err, /Publication pending/);
  const retained = git(r.root, "rev-parse", "HEAD"); assert.notEqual(retained, before);
  const archived = fs.readFileSync(path.join(r.root, "plans", "archive", A, "PLAN.md"), "utf8"); assert.match(archived, /status: abandoned/); assert.doesNotMatch(archived, /shelved_from/);
  fs.rmSync(reject); const retry = sp(r.root, "plan", "abandon", A); assert.equal(retry.code, 0, retry.err);
  assert.equal(git(r.root, "rev-parse", "HEAD"), retained); assert.equal(git(bare, "rev-parse", "refs/heads/main"), retained); assert.ok(!fs.existsSync(wtOf(r, A)));
});

test("abandon refuses unsupported YAML status without writing", () => {
  const r = repo();
  const file = path.join(r.root, "plans", A, "PLAN.md");
  fs.writeFileSync(file, plan(A).replace("status: ready", "status: >-\n  ready"));
  git(r.root, "commit", "-qam", "layout");
  const before = git(r.root, "rev-parse", "HEAD");
  const result = sp(r.root, "plan", "abandon", A);
  assert.notEqual(result.code, 0);
  assert.equal(git(r.root, "rev-parse", "HEAD"), before);
  assert.equal(git(r.root, "status", "--porcelain"), "");
});

test("abandon retries cleanup after a post-commit ignored file appears", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, ".gitignore"), "secret.txt\n"); git(r.root, "add", ".gitignore"); git(r.root, "commit", "-qm", "ignore");
  start(r, A);
  const wt = wtOf(r, A), secret = path.join(wt, "secret.txt");
  const hook = path.join(r.root, ".git", "hooks", "post-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nprintf preserve > '${secret}'\n`, { mode: 0o755 });
  const first = sp(r.root, "plan", "abandon", A, "--delete-branch");
  assert.notEqual(first.code, 0); assert.equal(fs.readFileSync(secret, "utf8"), "preserve");
  const retained = git(r.root, "rev-parse", "HEAD");
  fs.rmSync(hook); fs.rmSync(secret);
  const retry = sp(r.root, "plan", "abandon", A, "--delete-branch");
  assert.equal(retry.code, 0, retry.err); assert.equal(git(r.root, "rev-parse", "HEAD"), retained);
  assert.ok(!fs.existsSync(wt)); assert.ok(!hasBranch(r, A));
});

test("abandon preserves concurrent plan edits when commit fails", () => {
  const r = repo();
  const extra = path.join(r.root, "plans", A, "notes.txt");
  fs.writeFileSync(extra, "original\n"); git(r.root, "add", `plans/${A}/notes.txt`); git(r.root, "commit", "-qm", "notes");
  const hook = path.join(r.root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nprintf concurrent > 'plans/archive/${A}/notes.txt'\nexit 1\n`, { mode: 0o755 });
  const before = git(r.root, "rev-parse", "HEAD");
  const result = sp(r.root, "plan", "abandon", A);
  assert.notEqual(result.code, 0); assert.match(result.err, /retained for inspection/);
  assert.equal(git(r.root, "rev-parse", "HEAD"), before);
  assert.equal(fs.readFileSync(path.join(r.root, "plans", "archive", A, "notes.txt"), "utf8"), "concurrent");
  assert.notEqual(git(r.root, "diff", "--cached", "--name-only"), "");
});

test("abandon retries published cleanup after a post-commit ignored file appears", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, ".gitignore"), "secret.txt\n"); git(r.root, "add", ".gitignore"); git(r.root, "commit", "-qm", "ignore");
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-abandon-published-")); ownedDirs.push(bare);
  git(bare, "init", "--bare", "-q"); git(r.root, "remote", "add", "origin", bare); git(r.root, "push", "-u", "origin", "main");
  start(r, A);
  const wt = wtOf(r, A), secret = path.join(wt, "secret.txt");
  const hook = path.join(r.root, ".git", "hooks", "post-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nprintf preserve > '${secret}'\n`, { mode: 0o755 });
  const first = sp(r.root, "plan", "abandon", A, "--delete-branch");
  assert.notEqual(first.code, 0); assert.equal(fs.readFileSync(secret, "utf8"), "preserve");
  const retained = git(r.root, "rev-parse", "HEAD"); assert.equal(git(bare, "rev-parse", "refs/heads/main"), retained);
  fs.rmSync(hook); fs.rmSync(secret);
  const retry = sp(r.root, "plan", "abandon", A, "--delete-branch");
  assert.equal(retry.code, 0, retry.err); assert.equal(git(r.root, "rev-parse", "HEAD"), retained);
  assert.ok(!fs.existsSync(wt)); assert.ok(!hasBranch(r, A));
});

test("abandon retains a hook-modified commit without publishing it", () => {
  const r = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-abandon-hook-")); ownedDirs.push(bare);
  git(bare, "init", "--bare", "-q"); git(r.root, "remote", "add", "origin", bare); git(r.root, "push", "-u", "origin", "main");
  const before = git(r.root, "rev-parse", "HEAD");
  const hook = path.join(r.root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nprintf altered > base.txt\ngit add base.txt\n", { mode: 0o755 });
  const result = sp(r.root, "plan", "abandon", A);
  assert.notEqual(result.code, 0); assert.match(result.err, /parent, tree or trailers changed/);
  assert.notEqual(git(r.root, "rev-parse", "HEAD"), before); assert.equal(git(bare, "rev-parse", "refs/heads/main"), before);
});

test("abandon retains the actual commit when a post-commit hook creates a same-tree child", () => {
  const r = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-abandon-child-")); ownedDirs.push(bare);
  git(bare, "init", "--bare", "-q"); git(r.root, "remote", "add", "origin", bare); git(r.root, "push", "-u", "origin", "main");
  const before = git(r.root, "rev-parse", "HEAD");
  const hook = path.join(r.root, ".git", "hooks", "post-commit");
  fs.writeFileSync(hook, "#!/bin/sh\ngit -c core.hooksPath=/dev/null commit --allow-empty -qm child\n", { mode: 0o755 });
  const result = sp(r.root, "plan", "abandon", A);
  const child = git(r.root, "rev-parse", "HEAD"), actual = git(r.root, "rev-parse", "HEAD^");
  assert.equal(result.code, 1); assert.match(result.err, new RegExp(`commit ${actual} retained; HEAD moved to ${child}`));
  assert.equal(git(r.root, "rev-parse", `${actual}^{tree}`), git(r.root, "rev-parse", `${child}^{tree}`));
  assert.equal(git(bare, "rev-parse", "refs/heads/main"), before);
  assert.equal(sp(r.root, "plan", "abandon", A).code, 1);
});

test("abandon rejects a modified pending record without deleting the branch", () => {
  const r = repo(); start(r, A);
  const wt = wtOf(r, A); git(r.root, "config", "core.excludesFile", path.join(r.root, ".git", "ignore"));
  fs.writeFileSync(path.join(r.root, ".git", "ignore"), "secret\n");
  const hook = path.join(r.root, ".git", "hooks", "post-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nprintf preserve > '${path.join(wt, "secret")}'\n`, { mode: 0o755 });
  assert.equal(sp(r.root, "plan", "abandon", A, "--delete-branch").code, 1);
  const dir = path.join(r.root, ".git", "specplane-abandon");
  const journal = path.join(dir, fs.readdirSync(dir)[0]);
  const data = JSON.parse(fs.readFileSync(journal, "utf8")); data.planLocal = "0".repeat(40); fs.writeFileSync(journal, JSON.stringify(data));
  fs.rmSync(path.join(wt, "secret"));
  const retry = sp(r.root, "plan", "abandon", A, "--delete-branch");
  assert.equal(retry.code, 1); assert.match(retry.err, /Pending abandonment record/); assert.ok(hasBranch(r, A)); assert.ok(fs.existsSync(wt));
});

test("abandon recovers the exact 64-character commit in a SHA-256 repository", () => {
  const r = repo("", "sha256"); start(r, A);
  const wt = wtOf(r, A);
  git(r.root, "config", "core.excludesFile", path.join(r.root, ".git", "ignore"));
  fs.writeFileSync(path.join(r.root, ".git", "ignore"), "secret\n");
  const hook = path.join(r.root, ".git", "hooks", "post-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nprintf preserve > '${path.join(wt, "secret")}'\n`, { mode: 0o755 });
  assert.equal(sp(r.root, "plan", "abandon", A).code, 1);
  const commit = git(r.root, "rev-parse", "HEAD"); assert.equal(commit.length, 64);
  fs.rmSync(hook); fs.rmSync(path.join(wt, "secret"));
  const retry = sp(r.root, "plan", "abandon", A); assert.equal(retry.code, 0, retry.err);
  assert.equal(git(r.root, "rev-parse", "HEAD"), commit);
});

test("abandon retains moved HEAD and staged edits when a failing hook updates the ref", () => {
  const r = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-abandon-failing-hook-")); ownedDirs.push(bare);
  git(bare, "init", "--bare", "-q"); git(r.root, "remote", "add", "origin", bare); git(r.root, "push", "-u", "origin", "main");
  const before = git(r.root, "rev-parse", "HEAD");
  const hook = path.join(r.root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nchild=$(git commit-tree 'HEAD^{tree}' -p HEAD -m unrelated)\ngit update-ref HEAD \"$child\"\nexit 1\n", { mode: 0o755 });
  const result = sp(r.root, "plan", "abandon", A);
  const head = git(r.root, "rev-parse", "HEAD");
  assert.equal(result.code, 1); assert.notEqual(head, before); assert.match(result.err, new RegExp(`HEAD moved to ${head}`));
  assert.match(result.err, /retained for reconciliation/); assert.equal(git(bare, "rev-parse", "refs/heads/main"), before);
  assert.notEqual(git(r.root, "diff", "--cached", "--name-only"), "");
});

test("abandon refuses an existing pending record before writing the plan", () => {
  const r = repo();
  const dir = path.join(r.root, ".git", "specplane-abandon"); fs.mkdirSync(dir);
  const name = createHash("sha256").update(A).digest("hex") + ".json";
  const journal = path.join(dir, name); fs.writeFileSync(journal, "existing\n");
  const before = git(r.root, "rev-parse", "HEAD");
  const result = sp(r.root, "plan", "abandon", A);
  assert.equal(result.code, 1); assert.match(result.err, /Pending abandonment record exists/);
  assert.equal(git(r.root, "rev-parse", "HEAD"), before); assert.equal(git(r.root, "status", "--porcelain"), "");
  assert.equal(fs.readFileSync(journal, "utf8"), "existing\n");
});

test("abandon refuses disabled reflog recording before writes", () => {
  const r = repo(); git(r.root, "config", "core.logAllRefUpdates", "false");
  const before = git(r.root, "rev-parse", "HEAD");
  const result = sp(r.root, "plan", "abandon", A);
  assert.equal(result.code, 1); assert.match(result.err, /reflog recording is disabled/);
  assert.equal(git(r.root, "rev-parse", "HEAD"), before); assert.equal(git(r.root, "status", "--porcelain"), "");
  assert.ok(!fs.existsSync(path.join(r.root, ".git", "specplane-abandon")));
});

for (const archive of [true, false]) {
  test(`abandon commits the prospective plan index with archive_done=${archive}`, () => {
    const r = repo(`  archive_done: ${archive}\n`);
    start(r, A);
    const index = path.join(r.root, 'plans/PLANS.md');
    const result = sp(r.root, 'plan', 'abandon', A);
    assert.equal(result.code, 0, result.err);
    const expected = generatePlansMd(capturePlanSnapshot(r.root, 'head'));
    assert.equal(fs.readFileSync(index, 'utf8'), expected);
    assert.equal(git(r.root, 'show', 'HEAD:plans/PLANS.md'), expected.trim());
    assert.ok(expected.includes(archive ? `archive/${A}/PLAN.md` : `${A}/PLAN.md`));
    assert.match(expected, /abandoned/);
    assert.equal(git(r.root, 'status', '--porcelain'), '');
  });
}

test('abandon restores the prior plan index when its commit hook fails', () => {
  const r = repo();
  const index = path.join(r.root, 'plans/PLANS.md');
  const original = generatePlansMd(capturePlanSnapshot(r.root, 'head'));
  fs.writeFileSync(index, original);
  git(r.root, 'add', 'plans/PLANS.md');
  git(r.root, 'commit', '-qm', 'capture existing plan index');
  const before = git(r.root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(r.root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = sp(r.root, 'plan', 'abandon', A);
  assert.equal(result.code, 2, result.err);
  assert.match(result.err, /Git command failed: `git commit /);
  assert.equal(git(r.root, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(index, 'utf8'), original);
  assert.match(fs.readFileSync(path.join(r.root, 'plans', A, 'PLAN.md'), 'utf8'), /status: ready/);
  assert.equal(git(r.root, 'status', '--porcelain'), '');
});

test('abandon preserves a hidden edit to its existing plan index', () => {
  const r = repo();
  const index = path.join(r.root, 'plans/PLANS.md');
  fs.writeFileSync(index, generatePlansMd(capturePlanSnapshot(r.root, 'head')));
  git(r.root, 'add', 'plans/PLANS.md');
  git(r.root, 'commit', '-qm', 'capture existing plan index');
  git(r.root, 'update-index', '--assume-unchanged', 'plans/PLANS.md');
  fs.writeFileSync(index, 'private index edits\n');
  const before = git(r.root, 'rev-parse', 'HEAD');
  const result = sp(r.root, 'plan', 'abandon', A);
  assert.equal(result.code, 1);
  assert.match(result.err, /plan index differs from HEAD/);
  assert.equal(git(r.root, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(index, 'utf8'), 'private index edits\n');
  assert.match(fs.readFileSync(path.join(r.root, 'plans', A, 'PLAN.md'), 'utf8'), /status: ready/);
});

test('abandon preserves a hard-linked plan index and its other pathname', () => {
  const r = repo();
  const index = path.join(r.root, 'plans/PLANS.md');
  const original = generatePlansMd(capturePlanSnapshot(r.root, 'head'));
  fs.writeFileSync(index, original);
  git(r.root, 'add', 'plans/PLANS.md');
  git(r.root, 'commit', '-qm', 'capture existing plan index');
  const other = path.join(r.root, '.git', 'private-plan-index');
  fs.linkSync(index, other);
  const before = git(r.root, 'rev-parse', 'HEAD');
  const result = sp(r.root, 'plan', 'abandon', A);
  assert.equal(result.code, 1);
  assert.match(result.err, /plan index must be a regular file with one link/);
  assert.equal(git(r.root, 'rev-parse', 'HEAD'), before);
  assert.equal(fs.readFileSync(index, 'utf8'), original);
  assert.equal(fs.readFileSync(other, 'utf8'), original);
  assert.equal(fs.statSync(index).nlink, 2);
  assert.match(fs.readFileSync(path.join(r.root, 'plans', A, 'PLAN.md'), 'utf8'), /status: ready/);
  assert.equal(git(r.root, 'status', '--porcelain'), '');
});
