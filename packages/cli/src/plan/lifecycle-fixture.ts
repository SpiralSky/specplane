import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";
import { startFixture } from "./setup-fixture.js";

interface R { root: string; wt: string }

/** Each test file owns its repositories, environment and cleanup. */
export function createLifecycleFixture() {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");

  const ENV: NodeJS.ProcessEnv = {
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

  /** Temp repo on `main` (no remote) with plans A and B (B depends on A) and a private worktree dir. */
  function repo(planCfg = "", objectFormat = "sha1"): R {
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-lc-"));
    const root = makeRepo({
      ".specplane/config.yaml": `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  require_approved_specs: none\n${planCfg}execution:\n  worktree_dir: ${wt}\n`,
      "specs/features/example.md": "---\nid: feature/example\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n",
      [`plans/${A}/PLAN.md`]: plan(A),
      [`plans/${B}/PLAN.md`]: plan(B, "ready", `depends_on: [${A}]\n`),
      "base.txt": "base\n",
    });
    ownedDirs.push(root, wt);
    git(root, "init", "-q", "-b", "main", `--object-format=${objectFormat}`);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    return { root, wt };
  }

  const wtOf = (r: R, id: string) => path.join(r.wt, path.basename(r.root), id);

  const start = (r: R, id: string) => {
    startFixture(r.root, id, ENV);
  };

  const commitFile = (cwd: string, file: string, content: string, msg: string) => {
    fs.writeFileSync(path.join(cwd, file), content);
    git(cwd, "add", file);
    git(cwd, "commit", "-q", "-m", msg);
  };

  const hasBranch = (r: R, id: string) => gitOk(r.root, "show-ref", "--verify", "--quiet", `refs/heads/plan/${id}`);

  const count = (r: R, ref: string) => Number(git(r.root, "rev-list", "--count", ref));

  /** A started, B stacked on A, each with one own commit. */
  function stacked(): R {
    const r = repo("  dependency_mode: stack\n  merge: local_merge\n");
    start(r, A);
    commitFile(wtOf(r, A), "a.txt", "a\n", "alpha work");
    start(r, B);
    commitFile(wtOf(r, B), "b.txt", "b\n", "beta work");
    return r;
  }
  return { cli, ENV, git, gitOk, sp, A, B, plan, ownedDirs, repo, wtOf, start, commitFile, hasBranch, count, stacked };
}
