import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { GitError, NotARepoError } from "../errors.js";
import { run } from "./exec.js";
import { checkoutRoot, defaultBranch, mainRoot } from "./repo.js";

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stdio: "pipe" });

function makeRepo(): { tmp: string; repo: string } {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "specplane-repo-")));
  const repo = path.join(tmp, "main-checkout");
  fs.mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  g(repo, "add", "a.txt");
  g(repo, "commit", "-q", "-m", "init");
  return { tmp, repo };
}

test("run returns stdout and throws GitError on failure", () => {
  const { tmp, repo } = makeRepo();
  assert.equal(run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo }).trim(), "main");
  assert.throws(() => run("git", ["no-such-subcommand"], { cwd: repo }), GitError);
  fs.rmSync(tmp, { recursive: true });
});

test("run does not interpret shell syntax in arguments", () => {
  const { tmp, repo } = makeRepo();
  const out = run("git", ["log", "-1", "--format=%s", "--grep=$(touch pwned)"], { cwd: repo });
  assert.equal(out, "");
  assert.equal(fs.existsSync(path.join(repo, "pwned")), false);
  fs.rmSync(tmp, { recursive: true });
});

test("checkoutRoot and mainRoot differ inside a linked worktree", () => {
  const { tmp, repo } = makeRepo();
  const wt = path.join(tmp, "wt");
  g(repo, "worktree", "add", "-q", "-b", "plan/x", wt);
  assert.equal(checkoutRoot(repo), repo);
  assert.equal(mainRoot(repo), repo);
  assert.equal(checkoutRoot(wt), wt);
  assert.equal(mainRoot(wt), repo);
  fs.rmSync(tmp, { recursive: true });
});

test("defaultBranch falls back to main, then master", () => {
  const { tmp, repo } = makeRepo();
  assert.equal(defaultBranch(repo), "main");
  g(repo, "branch", "-m", "main", "master");
  assert.equal(defaultBranch(repo), "master");
  fs.rmSync(tmp, { recursive: true });
});

test("outside a repository throws NotARepoError", () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "specplane-norepo-")));
  assert.throws(() => checkoutRoot(tmp), NotARepoError);
  assert.throws(() => mainRoot(tmp), NotARepoError);
  fs.rmSync(tmp, { recursive: true });
});
