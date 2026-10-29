import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
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
const planMd = (status = "ready") =>
  `---\nid: ${A}\ntitle: "T"\nstatus: ${status}\nspecs: [feature/x]\n---\n# P\n\n## Acceptance criteria\n\n- [ ] it works\n`;
const stepMd = (n: number, status: string) => `---\nplan: ${A}\nstep: ${n}\ntitle: s${n}\nstatus: ${status}\n---\n# s\n`;

interface Opts {
  planCfg?: string;
  exec?: string;
  remote?: boolean;
  steps?: string[];
  planStatus?: string;
  merge?: string;
}
interface R { root: string; wt: string; origin: string; co: string }

/** Repo on `main`, plan started via the CLI, steps set to the given statuses and committed on the plan branch. */
function repo(o: Opts = {}): R {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-fwt-"));
  const root = makeRepo({
    ".specplane/config.yaml": `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  merge: ${o.merge ?? "local_merge"}\n  require_approved_specs: none\n${o.planCfg ?? ""}execution:\n  worktree_dir: ${wt}\n${o.exec ?? ""}`,
    "specs/features/x.md": "---\nid: feature/x\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n",
    [`plans/${A}/PLAN.md`]: planMd(o.planStatus),
    "base.txt": "base\n",
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-forigin-"));
  if (o.remote) {
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", origin);
    git(root, "push", "-q", "origin", "main");
    git(root, "fetch", "-q", "origin");
  }
  const res = sp(root, "plan", "start", A);
  assert.equal(res.code, 0, res.err);
  const inRoot = /backend: (branch|external)/.test(o.exec ?? "");
  const co = inRoot ? root : path.join(wt, path.basename(root), A);
  if ((o.exec ?? "").includes("external")) git(root, "switch", "-q", `plan/${A}`);
  (o.steps ?? ["done"]).forEach((st, i) => {
    const dir = path.join(co, "plans", A, "steps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `0${i + 1}-s.md`), stepMd(i + 1, st));
  });
  git(co, "add", "-A");
  git(co, "commit", "-q", "-m", "work");
  return { root, wt, origin, co };
}
const fin = (r: R, ...a: string[]) => sp(r.co, "plan", "finish", A, ...a);
const sha = (cwd: string, ref: string) => git(cwd, "rev-parse", ref);
const branchExists = (root: string, b: string) => gitOk(root, "show-ref", "--verify", "--quiet", `refs/heads/${b}`);

test("finish: local merge without a remote (Scenarios 4, 4a)", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, "later.txt"), "x");
  git(r.root, "add", "later.txt");
  git(r.root, "commit", "-q", "-m", "main moves");
  const res = fin(r, "--yes");
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
  assert.match(res.err, /Acceptance criteria/);
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
  assert.match(res.err, /Rebase of `plan\/2026-01-01-alpha` onto `main` has conflicts; resolve manually\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.ok(!fs.existsSync(path.join(r.root, ".git", "worktrees", A, "rebase-merge")));
});

test("finish: without --yes and no human, stops ready; a re-run merges (resume)", () => {
  const r = repo();
  let res = fin(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /ready to merge/);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
  const done = sha(r.co, "HEAD");
  res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-list", "--count", "--grep=finish", "main"), "1", "no second finish commit");
  assert.ok(gitOk(r.root, "merge-base", "--is-ancestor", done, "main"));
});

test("finish: merge stops when the main checkout is on another branch", () => {
  const r = repo();
  git(r.root, "switch", "-q", "-c", "other");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /the main checkout is on `other`, not `main`/);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.equal(git(r.co, "log", "-1", "--format=%s").startsWith("chore(specplane): finish"), true);
});

test("finish: local merge pushes the default branch when a remote exists", () => {
  const r = repo({ remote: true });
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  assert.equal(sha(r.origin, "main"), sha(r.root, "main"));
});

test("finish: pull_request pushes the branch and prints instructions", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const res = fin(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /Finished and pushed/);
  assert.match(res.err, /Open a pull request from `plan\/2026-01-01-alpha` into `main`/);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  assert.ok(fs.existsSync(r.co), "worktree kept until cleanup");
});

/** Stub `gh` first on PATH; origin looks like GitHub but fetches/pushes resolve to the local bare repo. */
function ghRepo(planCfg: string, ghOut: string): { r: R; env: NodeJS.ProcessEnv; log: string } {
  const r = repo({ remote: true, merge: "pull_request", planCfg });
  git(r.root, "config", "remote.origin.url", "https://github.com/o/r.git");
  git(r.root, "config", `url.${r.origin}.insteadOf`, "https://github.com/o/r.git");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-gh-"));
  const log = path.join(bin, "calls.log");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\necho -- >> '${log}'\n[ "$1" = "--version" ] && exit 0\necho '${ghOut}'\n`, { mode: 0o755 });
  return { r, env: { ...ENV, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, log };
}
const finEnv = (r: R, env: NodeJS.ProcessEnv) => {
  const x = spawnSync(process.execPath, [cli, "plan", "finish", A], { cwd: r.co, encoding: "utf8", env, input: "" });
  return { code: x.status, out: x.stdout, err: x.stderr };
};

test("finish: pull_request with a forge pushes, opens a PR from the plan, prints the URL", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "https://github.com/o/r/pull/3");
  const res = finEnv(r, env);
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
  const res = finEnv(r, env);
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
  const log = git(r.root, "log", "--format=%s", "main");
  assert.match(log, /claim 2026-01-01-alpha review/);
  assert.match(log, /finish 2026-01-01-alpha/);
});

test("finish: branch backend switches back to the default branch and deletes the branch", () => {
  const r = repo({ exec: "  backend: branch\n" });
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
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
