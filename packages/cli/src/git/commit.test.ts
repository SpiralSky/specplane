import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { CommitFormatError } from "../errors.js";
import type { Config } from "../types.js";
import { branchExists, remoteBranchExists } from "./branch.js";
import { cliTrailers, findLatest, formatMessage, readTrailers } from "./commit.js";
import { listWorktrees, parseWorktreeList, worktreePath } from "./worktree.js";

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stdio: "pipe", encoding: "utf8" });

function makeRepo(): { tmp: string; repo: string } {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "specplane-commit-")));
  const repo = path.join(tmp, "main-checkout");
  fs.mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  g(repo, "add", "a.txt");
  g(repo, "commit", "-q", "-m", "init");
  return { tmp, repo };
}

test("formatMessage orders trailers and appends attribution last", () => {
  const msg = formatMessage({
    type: "feat",
    scope: "x",
    summary: "do thing",
    body: "- a\n- b",
    trailers: {
      "Co-Authored-By": "C <c@example.com>",
      "Specplane-Session": "s1",
      "Specplane-Step": "03",
      "Specplane-Plan": "2026-01-01-x",
      "Specplane-Workflow": "step",
      "Specplane-Agent": "claude-code",
    },
  });
  assert.equal(
    msg,
    "feat(x): do thing\n\n- a\n- b\n\nSpecplane-Workflow: step\nSpecplane-Plan: 2026-01-01-x\nSpecplane-Step: 03\nSpecplane-Agent: claude-code\nSpecplane-Session: s1\nCo-Authored-By: C <c@example.com>\n",
  );
});

test("formatMessage enforces 72 chars except chore(specplane)", () => {
  const long = "y".repeat(80);
  assert.throws(() => formatMessage({ type: "feat", scope: "x", summary: long, trailers: {} }), CommitFormatError);
  const ok = formatMessage({ type: "chore", scope: "specplane", summary: long, trailers: { "Specplane-Workflow": "finish" } });
  assert.ok(ok.startsWith("chore(specplane): yyy"));
});

test("cliTrailers includes agent/session only when set and non-empty", () => {
  assert.deepEqual(cliTrailers("finish", "p", {}), { "Specplane-Workflow": "finish", "Specplane-Plan": "p" });
  assert.deepEqual(cliTrailers("finish", "p", { SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" }), {
    "Specplane-Workflow": "finish",
    "Specplane-Plan": "p",
  });
  const t = cliTrailers("finish", "p", { SPECPLANE_AGENT: "ci", SPECPLANE_SESSION: "s" });
  assert.equal(t["Specplane-Agent"], "ci");
  assert.equal(t["Specplane-Session"], "s");
});

test("readTrailers and findLatest on a temp repo (last wins)", () => {
  const { tmp, repo } = makeRepo();
  g(repo, "commit", "-q", "--allow-empty", "-m", "feat(p): one\n\nSpecplane-Workflow: step\nSpecplane-Step: 01\nSpecplane-Step: 02");
  const stepSha = g(repo, "rev-parse", "HEAD").trim();
  g(repo, "commit", "-q", "--allow-empty", "-m", "chore(specplane): finish p\n\nSpecplane-Workflow: finish\nSpecplane-Plan: p");
  const finishSha = g(repo, "rev-parse", "HEAD").trim();
  g(repo, "commit", "-q", "--allow-empty", "-m", "plain commit");
  const t = readTrailers(stepSha, repo);
  assert.equal(t.get("Specplane-Step"), "02");
  assert.equal(t.get("Specplane-Workflow"), "step");
  assert.equal(readTrailers("HEAD", repo).size, 0);
  assert.equal(findLatest("main", "step", repo), stepSha);
  assert.equal(findLatest("main", "finish", repo), finishSha);
  assert.equal(findLatest("main", "abandon", repo), null);
  fs.rmSync(tmp, { recursive: true });
});

test("branchExists and remoteBranchExists", () => {
  const { tmp, repo } = makeRepo();
  g(repo, "branch", "plan/x");
  assert.equal(branchExists("plan/x", repo), true);
  assert.equal(branchExists("plan/y", repo), false);
  assert.equal(remoteBranchExists("plan/x", repo), false);
  g(repo, "update-ref", "refs/remotes/origin/plan/x", "HEAD");
  assert.equal(remoteBranchExists("plan/x", repo), true);
  fs.rmSync(tmp, { recursive: true });
});

test("parseWorktreeList and listWorktrees", () => {
  const parsed = parseWorktreeList(
    "worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\ndetached\n\nworktree /c\nbare\n",
  );
  assert.deepEqual(parsed.map((w) => [w.path, w.branch, w.detached, w.bare]), [
    ["/a", "main", false, false],
    ["/b", null, true, false],
    ["/c", null, false, true],
  ]);
  const { tmp, repo } = makeRepo();
  const wt = path.join(tmp, "wt");
  g(repo, "worktree", "add", "-q", "-b", "plan/x", wt);
  const list = listWorktrees(repo);
  assert.equal(list.length, 2);
  assert.equal(list[0].path, repo);
  assert.equal(list[1].branch, "plan/x");
  assert.equal(list[1].path, wt);
  const cfg = { execution: { backend: "worktree", worktree_dir: "../.wts" } } as Config;
  assert.equal(worktreePath("p1", cfg, repo), path.join(tmp, ".wts", "main-checkout", "p1"));
  fs.rmSync(tmp, { recursive: true });
});
