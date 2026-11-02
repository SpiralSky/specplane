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
const start = (cwd: string, id: string) => {
  const r = spawnSync(process.execPath, [cli, "plan", "start", id], { cwd, encoding: "utf8", env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const A = "2026-01-01-alpha";
const B = "2026-01-02-beta";
const C = "2026-01-03-gamma";
const plan = (id: string, status = "ready", extra = "") =>
  `---\nid: ${id}\ntitle: "T ${id}"\nstatus: ${status}\nspecs: [feature/example]\n${extra}---\n# P\n`;
const step = (id: string, n: number, status = "pending") =>
  `---\nplan: ${id}\nstep: ${n}\ntitle: first\nstatus: ${status}\n---\n# s\n`;
const specFile = (status: string) => `---\nid: feature/example\ntitle: X\nstatus: ${status}\nauthor: user\n---\n# X\n`;

interface Opts {
  planCfg?: string;
  exec?: string;
  specStatus?: string;
  plans?: Record<string, string>;
  remote?: boolean;
}

const ownedDirs: string[] = [];
after(() => { for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true }); });

/** Repo on `main` (plus a bare origin unless `remote: false`) and a private worktree directory. */
function repo(o: Opts = {}): { root: string; wt: string; origin: string } {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-wt-"));
  const files: Record<string, string> = {
    ".specplane/config.yaml": `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n${o.planCfg ?? ""}execution:\n  worktree_dir: ${wt}\n${o.exec ?? ""}`,
    "specs/features/example.md": specFile(o.specStatus ?? "approved"),
    [`plans/${A}/PLAN.md`]: plan(A),
    [`plans/${A}/steps/01-first.md`]: step(A, 1),
  };
  for (const [k, v] of Object.entries(o.plans ?? {})) files[`plans/${k}/PLAN.md`] = v;
  const root = makeRepo(files);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-origin-"));
  if (o.remote !== false) {
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", origin);
    git(root, "push", "-q", "origin", "main");
    git(root, "fetch", "-q", "origin");
  }
  ownedDirs.push(root, wt, origin);
  return { root, wt, origin };
}
const branchExists = (root: string, b: string) => spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${b}`], { cwd: root }).status === 0;
const wtPath = (r: { root: string; wt: string }, id: string) => path.join(r.wt, path.basename(r.root), id);

test("start: --no-fetch skips the fetch and works from local refs", () => {
  const r = repo();
  // The remote is unavailable while the captured local refs remain intact.
  git(r.root, "remote", "set-url", "origin", path.join(r.wt, "missing-origin"));
  const bad = spawnSync(process.execPath, [cli, "plan", "start", A], { cwd: r.root, encoding: "utf8", env: ENV });
  assert.notEqual(bad.status, 0, "a fetch failure surfaces without --no-fetch");
  const ok = spawnSync(process.execPath, [cli, "plan", "start", A, "--no-fetch"], { cwd: r.root, encoding: "utf8", env: ENV });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(branchExists(r.root, `plan/${A}`), true);
});

test("start: first start creates branch and worktree, runs hook, announces (Scenario 1)", () => {
  const r = repo({ planCfg: '  setup_hook: "echo hooked > hook.txt"\n' });
  const head = git(r.root, "rev-parse", "main");
  const res = start(r.root, A);
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-parse", `plan/${A}^`), head);
  assert.match(git(r.root, "show", `plan/${A}:plans/${A}/PLAN.md`), /start_base:/);
  assert.equal(git(r.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.ok(fs.existsSync(path.join(wtPath(r, A), "hook.txt")));
  assert.ok(res.out.includes(`Worktree: ${wtPath(r, A)}`));
  assert.ok(res.out.includes("Next step: 01 first"));
  assert.ok(res.out.includes("Backend: worktree (checkout created)"));
  assert.ok(res.out.includes("Continue"));
  const j = spawnSync(process.execPath, [cli, "plan", "start", A, "--json"], { cwd: r.root, encoding: "utf8", env: ENV });
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.nextCommand, null);
  assert.equal(parsed.checkout, wtPath(r, A));
  assert.equal(parsed.resumed, true);
  const again = start(r.root, A);
  assert.ok(again.out.includes("Backend: worktree (checkout resumed)"));
});

test("start: unapproved spec fails before any write (Scenario 2)", () => {
  const r = repo({ specStatus: "draft", planCfg: "  require_approved_specs: feature\n" });
  const res = start(r.root, A);
  assert.equal(res.code, 1);
  assert.match(res.err, /`feature\/example` is not approved/);
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  assert.equal(fs.existsSync(wtPath(r, A)), false);
});

test("start: dependency not done (Scenario 3), and non-ready plan", () => {
  const r = repo({ plans: { [B]: plan(B, "ready", `depends_on: [${A}]\n`), [C]: plan(C, "draft") } });
  let res = start(r.root, B);
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot start plan: dependency `2026-01-01-alpha` is not done\./);
  res = start(r.root, C);
  assert.match(res.err, /Cannot start plan: `2026-01-03-gamma` is `draft`, not `ready`\./);
  assert.equal(branchExists(r.root, `plan/${B}`), false);
});

test("start: stacking on one unmerged dependency writes a marker commit (Scenario 6)", () => {
  const r = repo({ planCfg: "  dependency_mode: stack\n", plans: { [B]: plan(B, "ready", `depends_on: [${A}]\n`) } });
  assert.equal(start(r.root, A).code, 0);
  // Make alpha's branch differ from main.
  const wtA = wtPath(r, A);
  fs.writeFileSync(path.join(wtA, "a.txt"), "a");
  git(wtA, "add", "a.txt");
  git(wtA, "commit", "-q", "-m", "work");
  const tipA = git(r.root, "rev-parse", `plan/${A}`);
  const res = start(r.root, B);
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-parse", `plan/${B}~2`), tipA);
  const msg = git(r.root, "log", "-1", "--format=%B", `plan/${B}^`);
  assert.match(msg, /^chore\(specplane\): stack 2026-01-02-beta on 2026-01-01-alpha\n/);
  const lines = msg.split("\n").filter((l) => l.startsWith("Specplane-"));
  assert.deepEqual(lines, [
    "Specplane-Workflow: stack",
    `Specplane-Plan: ${B}`,
    `Specplane-Stack-Base: ${tipA}`,
  ]);
});

test("start: stacking on two unmerged dependencies fails", () => {
  const r = repo({
    planCfg: "  dependency_mode: stack\n",
    plans: { [B]: plan(B), [C]: plan(C, "ready", `depends_on: [${A}, ${B}]\n`) },
  });
  assert.equal(start(r.root, A).code, 0);
  assert.equal(start(r.root, B).code, 0);
  const res = start(r.root, C);
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot stack on more than one unmerged dependency: 2026-01-01-alpha, 2026-01-02-beta\./);
  assert.equal(branchExists(r.root, `plan/${C}`), false);
});

test("start: setup hook failure removes the worktree (Scenario 7)", () => {
  const r = repo({ planCfg: '  setup_hook: "exit 3"\n' });
  const res = start(r.root, A);
  assert.equal(res.code, 1);
  assert.match(res.err, /Setup hook failed/);
  assert.equal(fs.existsSync(wtPath(r, A)), false);
});

test("start: resume re-uses branch and worktree and skips dependency and approval checks (Scenario 8)", () => {
  const r = repo();
  assert.equal(start(r.root, A).code, 0);
  const tip = git(r.root, "rev-parse", `plan/${A}`);
  // Spec turns draft on main afterwards; resume must not care.
  fs.writeFileSync(path.join(r.root, "specs/features/example.md"), specFile("draft"));
  git(r.root, "commit", "-q", "-am", "draft again");
  fs.writeFileSync(path.join(r.root, "specs/features/example.md"), specFile("draft"));
  const res = start(r.root, A);
  assert.equal(res.code, 0, res.err);
  assert.ok(res.out.startsWith(`Resumed ${A}`));
  assert.equal(git(r.root, "rev-parse", `plan/${A}`), tip);
  assert.ok(res.out.includes(wtPath(r, A)));
});

test("start: resume tracks a remote-only branch", () => {
  const r = repo();
  assert.equal(start(r.root, A).code, 0);
  git(r.root, "worktree", "remove", "--force", wtPath(r, A));
  git(r.root, "push", "-q", "origin", `plan/${A}`);
  git(r.root, "branch", "-D", `plan/${A}`);
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  const res = start(r.root, A);
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-parse", "--abbrev-ref", `plan/${A}@{upstream}`), `origin/plan/${A}`);
});

test("start: branch backend needs a clean tree, then switches", () => {
  const r = repo({ exec: "", planCfg: "" });
  fs.writeFileSync(path.join(r.root, ".specplane/config.yaml"), fs.readFileSync(path.join(r.root, ".specplane/config.yaml"), "utf8").replace(/execution:[\s\S]*/, "execution:\n  backend: branch\n"));
  git(r.root, "commit", "-q", "-am", "backend");
  fs.writeFileSync(path.join(r.root, "dirty.txt"), "x");
  let res = start(r.root, A);
  assert.equal(res.code, 1);
  assert.match(res.err, /uncommitted changes/);
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  fs.rmSync(path.join(r.root, "dirty.txt"));
  res = start(r.root, A);
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-parse", "--abbrev-ref", "HEAD"), `plan/${A}`);
  assert.ok(res.out.includes(`Branch: plan/${A}`));
  assert.ok(res.out.includes("Backend: branch (checkout created)"));
  assert.ok(res.out.includes("Continue"));
});

const list = (cwd: string, ...a: string[]) => {
  const r = spawnSync(process.execPath, [cli, "plan", "list", "--live", ...a], { cwd, encoding: "utf8", env: ENV });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test("list --live: prints the checkout, and one notice when the fetch fails", () => {
  const r = repo();
  assert.equal(start(r.root, A).code, 0);
  const ok = list(r.root);
  assert.equal(ok.code, 0, ok.err);
  assert.ok(ok.out.includes(`checkout ${wtPath(r, A)}`));
  assert.equal(ok.err, "");
  git(r.root, "remote", "set-url", "origin", path.join(r.wt, "missing-origin"));
  const bad = list(r.root);
  assert.equal(bad.code, 0, bad.err);
  assert.equal(bad.err.split("notice: could not fetch origin; showing local refs").length - 1, 1);
  assert.ok(bad.out.includes(`checkout ${wtPath(r, A)}`));
  const quiet = list(r.root, "--no-fetch");
  assert.equal(quiet.code, 0);
  assert.equal(quiet.err, "");
});

test("start: external backend only creates the branch and announces", () => {
  const r = repo({ exec: "  backend: external\n" });
  const res = start(r.root, A);
  assert.equal(res.code, 0, res.err);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.equal(fs.existsSync(wtPath(r, A)), false);
  assert.equal(git(r.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.ok(res.out.includes(`Branch: plan/${A}`));
  assert.ok(res.out.includes("Backend: external"));
  assert.ok(res.out.includes("do not run `specplane plan finish` locally"));
  assert.ok(!res.out.includes("&& claude"));
});

test("start: frontmatter mode writes a claim commit on the default branch and pushes it", () => {
  const r = repo({ planCfg: "  status_source: frontmatter\n" });
  const res = start(r.root, A);
  assert.equal(res.code, 0, res.err);
  const msg = git(r.root, "log", "-1", "--format=%B", "main");
  assert.match(msg, /^chore\(specplane\): claim 2026-01-01-alpha in_progress\n/);
  assert.match(msg, /Specplane-Workflow: claim\nSpecplane-Plan: 2026-01-01-alpha/);
  assert.match(fs.readFileSync(path.join(r.root, `plans/${A}/PLAN.md`), "utf8"), /^status: in_progress$/m);
  assert.equal(git(r.root, "rev-parse", "main"), git(r.origin, "rev-parse", "main"));
  assert.equal(git(r.root, "rev-parse", `plan/${A}^`), git(r.root, "rev-parse", "main"));
});

test("start: frontmatter claim refuses when the main checkout is not on the default branch", () => {
  const r = repo({ planCfg: "  status_source: frontmatter\n" });
  git(r.root, "switch", "-q", "-c", "other");
  const res = start(r.root, A);
  assert.equal(res.code, 1);
  assert.match(res.err, /Claim requires a local checkout/);
  assert.equal(branchExists(r.root, `plan/${A}`), false);
});


test("start: ambiguous unbound legacy history is refused without writes", () => {
  const r = repo();
  git(r.root, "branch", `plan/${A}`);
  const tip = git(r.root, "rev-parse", `plan/${A}`);
  const res = start(r.root, A);
  assert.equal(res.code, 1); assert.match(res.err, /Legacy target history is ambiguous/);
  assert.equal(git(r.root, "rev-parse", `plan/${A}`), tip);
  assert.equal(fs.existsSync(wtPath(r, A)), false);
});
