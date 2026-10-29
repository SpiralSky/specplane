import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config.js";
import { GitError, RebaseConflictError } from "../errors.js";
import { branchExists, createBranch, deleteBranch, rebaseOnto } from "./branch.js";
import { createWorktree, listWorktrees, removeWorktree, worktreePath } from "./worktree.js";

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  });

function makeRepo(): { tmp: string; repo: string } {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "specplane-write-")));
  const repo = path.join(tmp, "main-checkout");
  fs.mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "base\n");
  g(repo, "add", "a.txt");
  g(repo, "commit", "-q", "-m", "init");
  return { tmp, repo };
}

test("createBranch and deleteBranch", () => {
  const { tmp, repo } = makeRepo();
  createBranch("plan/x", "main", repo);
  assert.ok(branchExists("plan/x", repo));
  assert.equal(g(repo, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main");
  deleteBranch("plan/x", repo);
  assert.ok(!branchExists("plan/x", repo));
  assert.throws(() => deleteBranch("plan/x", repo), GitError);
  fs.rmSync(tmp, { recursive: true });
});

test("rebaseOnto succeeds without conflict", () => {
  const { tmp, repo } = makeRepo();
  g(repo, "switch", "-q", "-c", "plan/a");
  fs.writeFileSync(path.join(repo, "b.txt"), "b\n");
  g(repo, "add", "b.txt");
  g(repo, "commit", "-q", "-m", "b");
  g(repo, "switch", "-q", "main");
  fs.writeFileSync(path.join(repo, "c.txt"), "c\n");
  g(repo, "add", "c.txt");
  g(repo, "commit", "-q", "-m", "c");
  const upstream = g(repo, "merge-base", "main", "plan/a").trim();
  rebaseOnto("main", upstream, "plan/a", repo);
  assert.ok(fs.existsSync(path.join(repo, "b.txt")));
  assert.ok(fs.existsSync(path.join(repo, "c.txt")));
  fs.rmSync(tmp, { recursive: true });
});

test("rebaseOnto aborts on conflict and leaves the branch unchanged", () => {
  const { tmp, repo } = makeRepo();
  g(repo, "switch", "-q", "-c", "plan/a");
  fs.writeFileSync(path.join(repo, "a.txt"), "plan side\n");
  g(repo, "commit", "-q", "-am", "plan edit");
  const before = g(repo, "rev-parse", "plan/a").trim();
  const upstream = g(repo, "rev-parse", "main").trim();
  g(repo, "switch", "-q", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "main side\n");
  g(repo, "commit", "-q", "-am", "main edit");
  assert.throws(() => rebaseOnto("main", upstream, "plan/a", repo), RebaseConflictError);
  assert.equal(g(repo, "rev-parse", "plan/a").trim(), before);
  assert.equal(g(repo, "status", "--porcelain").trim(), "");
  assert.ok(!fs.existsSync(path.join(repo, ".git", "rebase-merge")));
  fs.rmSync(tmp, { recursive: true });
});

test("rebaseOnto rethrows GitError when no rebase started", () => {
  const { tmp, repo } = makeRepo();
  assert.throws(() => rebaseOnto("main", "main", "no-such-branch", repo), GitError);
  fs.rmSync(tmp, { recursive: true });
});

test("createWorktree adds and reuses; removeWorktree refuses dirty unless forced", () => {
  const { tmp, repo } = makeRepo();
  const config = { ...DEFAULT_CONFIG, execution: { ...DEFAULT_CONFIG.execution, worktree_dir: "../wt" } };
  createBranch("plan/p1", "main", repo);
  const p = createWorktree("p1", "plan/p1", config, repo);
  assert.equal(p, worktreePath("p1", config, repo));
  assert.ok(fs.existsSync(path.join(p, "a.txt")));
  assert.equal(createWorktree("p1", "plan/p1", config, repo), p);
  assert.equal(listWorktrees(repo).filter((w) => w.branch === "plan/p1").length, 1);

  fs.writeFileSync(path.join(p, "dirty.txt"), "x");
  assert.throws(() => removeWorktree("p1", config, {}, repo), GitError);
  assert.ok(fs.existsSync(p));
  removeWorktree("p1", config, { force: true }, repo);
  assert.ok(!fs.existsSync(p));
  fs.rmSync(tmp, { recursive: true });
});

test("removeWorktree removes a clean worktree", () => {
  const { tmp, repo } = makeRepo();
  const config = { ...DEFAULT_CONFIG, execution: { ...DEFAULT_CONFIG.execution, worktree_dir: "../wt" } };
  createBranch("plan/p2", "main", repo);
  const p = createWorktree("p2", "plan/p2", config, repo);
  removeWorktree("p2", config, {}, repo);
  assert.ok(!fs.existsSync(p));
  fs.rmSync(tmp, { recursive: true });
});
