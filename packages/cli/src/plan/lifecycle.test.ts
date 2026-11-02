import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SPECPLANE_AGENT: "", SPECPLANE_SESSION: "",
};
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const gitOk = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env: ENV }).status === 0;
const sp = (cwd: string, ...a: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: "utf8", env: ENV, input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const A = "2026-01-01-alpha";
const B = "2026-01-02-beta";
const plan = (id: string, status = "ready", extra = "") =>
  `---\nid: ${id}\ntitle: "T ${id}"\nstatus: ${status}\nspecs: [feature/example]\n${extra}---\n# P\n`;

const ownedDirs: string[] = [];
after(() => { for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true }); });

interface R { root: string; wt: string }
/** Temp repo on `main` (no remote) with plans A and B (B depends on A) and a private worktree dir. */
function repo(planCfg = ""): R {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-lc-"));
  const root = makeRepo({
    ".specplane/config.yaml": `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  require_approved_specs: none\n${planCfg}execution:\n  worktree_dir: ${wt}\n`,
    "specs/features/example.md": "---\nid: feature/example\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n",
    [`plans/${A}/PLAN.md`]: plan(A),
    [`plans/${B}/PLAN.md`]: plan(B, "ready", `depends_on: [${A}]\n`),
    "base.txt": "base\n",
  });
  ownedDirs.push(root, wt);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return { root, wt };
}
const wtOf = (r: R, id: string) => path.join(r.wt, path.basename(r.root), id);
const start = (r: R, id: string) => {
  const res = sp(r.root, "plan", "start", id);
  assert.equal(res.code, 0, res.err);
};
const commitFile = (cwd: string, file: string, content: string, msg: string) => {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
};
const hasBranch = (r: R, id: string) => gitOk(r.root, "show-ref", "--verify", "--quiet", `refs/heads/plan/${id}`);
const count = (r: R, ref: string) => Number(git(r.root, "rev-list", "--count", ref));

test("abandon: commits on main, archives, removes worktree, keeps branch; a second abandon fails", () => {
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
  assert.equal(again.code, 1, "abandoning an abandoned plan fails");
  assert.match(again.err, /Cannot abandon plan: `2026-01-01-alpha` is `abandoned`\./);
  assert.equal(git(r.root, "rev-parse", "HEAD"), head, "no second commit");
  assert.ok(hasBranch(r, A), "branch kept by the failed run");
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
  assert.match(res.err, /main checkout is on `other`, not `main`/);
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

test("cleanup: refuses until done on main; then removes worktree and branch; idempotent", () => {
  const r = repo();
  start(r, A);
  const wt = wtOf(r, A);
  let res = sp(r.root, "plan", "cleanup", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /not `done` on `main`/);
  assert.ok(fs.existsSync(wt) && hasBranch(r, A), "nothing removed");

  fs.writeFileSync(path.join(wt, "plans", A, "PLAN.md"), plan(A, "done"));
  git(wt, "commit", "-qam", "done");
  git(r.root, "merge", "-q", "--squash", `plan/${A}`);
  git(r.root, "commit", "-q", "-m", "squash");
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

/** A started, B stacked on A, each with one own commit. */
function stacked(): R {
  const r = repo("  dependency_mode: stack\n");
  start(r, A);
  commitFile(wtOf(r, A), "a.txt", "a\n", "alpha work");
  start(r, B);
  commitFile(wtOf(r, B), "b.txt", "b\n", "beta work");
  return r;
}

test("restack: after a squash merge only beta's own commits are replayed (Scenario 6a)", () => {
  const r = stacked();
  const wa = wtOf(r, A);
  const alphaPlan = path.join(wa, "plans", A, "PLAN.md");
  fs.writeFileSync(alphaPlan, fs.readFileSync(alphaPlan, "utf8").replace("status: ready", "status: done"));
  git(wa, "commit", "-qam", "alpha done");
  git(r.root, "merge", "-q", "--squash", `plan/${A}`);
  git(r.root, "commit", "-q", "-m", "squash alpha");
  const before = git(r.root, "rev-parse", `plan/${B}`);
  const live = sp(r.root, "plan", "list", "--live", "--no-fetch");
  assert.equal(live.code, 0, live.err);
  assert.ok(live.err.includes(`Base plan \`${A}\` has merged; run \`specplane plan restack ${B}\`.`), live.err);
  const dry = sp(r.root, "plan", "restack", B, "--dry-run");
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^Would restack .* onto [0-9a-f]+ \(no longer stacked\)$/m);
  assert.match(dry.out, /^[0-9a-f]{7} beta work$/m, "dry run lists the commits to replay");
  assert.doesNotMatch(dry.out, /alpha work/, "the stack marker and base commits are not listed");
  assert.equal(git(r.root, "rev-parse", `plan/${B}`), before, "dry run changes nothing");
  const res = sp(r.root, "plan", "restack", B);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /no longer stacked/);
  const own = git(r.root, "log", "--format=%s", `main..plan/${B}`);
  assert.match(own, /beta work/);
  assert.doesNotMatch(own, /alpha work/);
  assert.equal(git(r.root, "merge-base", "main", `plan/${B}`), git(r.root, "rev-parse", "main"));
  assert.equal(git(r.root, "show", `plan/${B}:a.txt`), "a");
  // No longer stacked: a second restack errors, and start's resume hint is gone.
  const again = sp(r.root, "plan", "restack", B);
  assert.equal(again.code, 1);
  assert.match(again.err, /Cannot restack: `2026-01-02-beta` is not stacked\./);
  const resume = sp(r.root, "plan", "start", B);
  assert.equal(resume.code, 0, resume.err);
  assert.doesNotMatch(resume.err, /has merged/);
  assert.doesNotMatch(sp(r.root, "plan", "list", "--live", "--no-fetch").err, /has merged/);
});

test("restack: unmerged base appends a new marker; second run is a no-op", () => {
  const r = stacked();
  const wa = wtOf(r, A);
  fs.writeFileSync(path.join(wa, "a.txt"), "a2\n");
  git(wa, "commit", "-q", "--amend", "-a", "--no-edit");
  const newTip = git(r.root, "rev-parse", `plan/${A}`);
  const res = sp(r.root, "plan", "restack", B);
  assert.equal(res.code, 0, res.err);
  assert.doesNotMatch(res.out, /no longer stacked/);
  assert.equal(git(r.root, "show", `plan/${B}:a.txt`), "a2");
  const marker = git(r.root, "log", "-1", "--format=%B", `plan/${B}`);
  assert.match(marker, /^chore\(specplane\): stack 2026-01-02-beta on 2026-01-01-alpha\n/);
  assert.match(marker, new RegExp(`Specplane-Stack-Base: ${newTip}`));
  assert.equal(git(r.root, "log", "--format=%s", `plan/${A}..plan/${B}`).split("\n").filter((l) => /beta work/.test(l)).length, 1);
  const head = git(r.root, "rev-parse", `plan/${B}`);
  const again = sp(r.root, "plan", "restack", B);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /already on the tip/);
  assert.equal(git(r.root, "rev-parse", `plan/${B}`), head);
});

test("restack preserves ignored files touched only by intermediate commits", () => {
  const r = stacked();
  const child = wtOf(r, B);
  commitFile(child, "transient", "temporary", "add transient");
  git(child, "rm", "-q", "transient");
  git(child, "commit", "-q", "-m", "remove transient");
  fs.writeFileSync(path.join(r.root, ".git", "info", "exclude"), "transient\n");
  const file = path.join(child, "transient");
  const bytes = Buffer.from([0, 255, 4]);
  fs.writeFileSync(file, bytes);
  commitFile(wtOf(r, A), "advance", "base advances", "advance base");
  const head = git(child, "rev-parse", "HEAD");
  const result = sp(r.root, "plan", "restack", B);
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Ignored file.*conflicts/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(git(child, "rev-parse", "HEAD"), head);
});

test("restack rejects a noncanonical stored stack base before rewriting", () => {
  const r = stacked();
  const child = wtOf(r, B);
  git(child, "commit", "--allow-empty", "-q", "-m", `chore(specplane): stack ${B} on ${A}\n\nSpecplane-Workflow: stack\nSpecplane-Plan: ${B}\nSpecplane-Stack-Base: HEAD`);
  const head = git(child, "rev-parse", "HEAD");
  const result = sp(r.root, "plan", "restack", B);
  assert.equal(result.code, 1, result.err);
  assert.match(result.err, /Invalid stored commit: HEAD/);
  assert.equal(git(child, "rev-parse", "HEAD"), head);
});

test("restack: conflicts are listed and the checkout is left mid-rebase; non-stacked plans error", () => {
  const r = stacked();
  commitFile(wtOf(r, B), "a.txt", "b-edit\n", "beta edits a");
  const wa = wtOf(r, A);
  fs.writeFileSync(path.join(wa, "a.txt"), "a2\n");
  git(wa, "commit", "-q", "--amend", "-a", "--no-edit");
  const before = git(r.root, "rev-parse", `plan/${B}`);
  const res = sp(r.root, "plan", "restack", B);
  assert.equal(res.code, 1);
  assert.match(res.err, /has conflicts; resolve manually/);
  assert.match(res.err, /a\.txt/);
  assert.equal(git(r.root, "rev-parse", `plan/${B}`), before);
  assert.match(git(wtOf(r, B), "status", "--porcelain"), /^UU a\.txt$/m, "rebase left in progress");
  git(wtOf(r, B), "rebase", "--abort");
  assert.equal(git(wtOf(r, B), "status", "--porcelain"), "");
  const plain = sp(r.root, "plan", "restack", A);
  assert.equal(plain.code, 1);
  assert.match(plain.err, /is not stacked/);
  assert.equal(count(r, `plan/${B}`) > 0, true);
});

test("restack refuses a cross-target base without rewriting the child", () => {
  const r = stacked();
  git(r.root, "branch", "release");
  const wa = wtOf(r, A);
  const file = path.join(wa, "plans", A, "PLAN.md");
  const original = fs.readFileSync(file, "utf8");
  const changed = original.replace(/(start_target_branch: )"main"/, '$1"release"').replace(/(target_branch: )"main"/, '$1"release"');
  assert.notEqual(changed, original);
  fs.writeFileSync(file, changed);
  git(wa, "commit", "-qam", "change base binding");
  const before = git(r.root, "rev-parse", `plan/${B}`);
  const result = sp(r.root, "plan", "restack", B);
  assert.equal(result.code, 1);
  assert.match(result.err, /compatible recorded target/);
  assert.equal(git(r.root, "rev-parse", `plan/${B}`), before);
  assert.equal(git(wtOf(r, B), "status", "--porcelain"), "");
});

test("restack reports rewritten head when the new marker commit fails", () => {
  const r = stacked();
  commitFile(wtOf(r, A), "more.txt", "more\n", "advance base");
  const before = git(r.root, "rev-parse", `plan/${B}`);
  const hook = path.join(r.root, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const result = sp(r.root, "plan", "restack", B);
  fs.unlinkSync(hook);
  const after = git(r.root, "rev-parse", `plan/${B}`);
  assert.equal(result.code, 1);
  assert.notEqual(after, before);
  assert.match(result.err, new RegExp(`Restack rebase completed at ${after}.*marker creation failed`));
  assert.equal(git(wtOf(r, B), "status", "--porcelain"), "");
});

test("restack refuses a draft target record before rewriting", () => {
  const r = stacked();
  const file = path.join(r.root, "plans", B, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: draft"));
  git(r.root, "commit", "-qam", "draft child");
  const before = git(r.root, "rev-parse", `plan/${B}`);
  const result = sp(r.root, "plan", "restack", B);
  assert.equal(result.code, 1);
  assert.match(result.err, /target status draft/);
  assert.equal(git(r.root, "rev-parse", `plan/${B}`), before);
});
