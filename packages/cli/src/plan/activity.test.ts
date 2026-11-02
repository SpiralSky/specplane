import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ID = "2026-01-01-alpha";
const OTHER = "2026-01-02-beta";
const plan = (id: string, status = "ready") => `---\nid: ${id}\ntitle: "T ${id}"\nstatus: ${status}\nspecs: [feature/x]\n---\n# P\n`;
const step = (n: number, status: string) => `---\nplan: ${ID}\nstep: ${n}\ntitle: "Step ${n}"\nstatus: ${status}\n---\n# S\n`;

const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const cliRun = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const live = (root: string, ...extra: string[]) =>
  JSON.parse(cliRun(root, "plan", "list", "--json", "--live", ...extra).out) as Record<string, any>[];

function repo(): string {
  const root = makeRepo({
    ".specplane/config.yaml": "spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n",
    "specs/.gitkeep": "",
    [`plans/${ID}/PLAN.md`]: plan(ID),
    [`plans/${ID}/steps/01-a.md`]: step(1, "pending"),
    [`plans/${ID}/steps/02-b.md`]: step(2, "pending"),
    [`plans/${ID}/HANDOFF.md`]: "# H\n",
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** Start the plan on its own branch with step 1 done and a step commit. */
function startPlan(root: string): void {
  git(root, "branch", `plan/${ID}`);
  git(root, "switch", "-q", `plan/${ID}`);
  fs.writeFileSync(path.join(root, `plans/${ID}/steps/01-a.md`), step(1, "done"));
  fs.writeFileSync(path.join(root, `plans/${ID}/HANDOFF.md`), "# H\n- BLOCKED: waiting on x\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "feat(alpha): step 1", "-m", "Specplane-Workflow: step\nSpecplane-Plan: " + ID + "\nSpecplane-Step: 1\nSpecplane-Agent: claude-code\nSpecplane-Session: s1");
  git(root, "switch", "-q", "main");
}

test("activity: local branch fields", () => {
  const root = repo();
  startPlan(root);
  const row = live(root, "--no-fetch")[0];
  assert.equal(row.where, "local");
  assert.equal(row.branch, `plan/${ID}`);
  assert.equal(row.backend, "worktree");
  assert.equal(row.checkout, null);
  assert.deepEqual(row.steps, { total: 2, done: 1, skipped: 0, blocked: 0, next: { number: 2, title: "Step 2", status: "pending" } });
  assert.deepEqual(row.blocked_issues, ["BLOCKED: waiting on x"]);
  assert.equal(row.last_step_commit.step, 1);
  assert.equal(row.last_step_commit.agent, "claude-code");
  assert.equal(row.last_step_commit.session, "s1");
  assert.equal(row.ahead_of_remote, null);
  assert.equal(row.effective_status, "in_progress");
});

test("activity: checkout is the worktree of the plan branch", () => {
  const root = repo();
  startPlan(root);
  const wt = path.join(os.tmpdir(), `wt-${Date.now()}`);
  git(root, "worktree", "add", "-q", wt, `plan/${ID}`);
  assert.equal(fs.realpathSync(live(root)[0].checkout), fs.realpathSync(wt));
});

test("activity: no remote, not started, no throw", () => {
  const root = repo();
  const row = live(root)[0];
  assert.equal(row.where, "none");
  assert.equal(row.branch, null);
  assert.equal(row.last_step_commit, null);
  assert.equal(row.ahead_of_remote, null);
  assert.equal(row.steps.total, 2);
  assert.equal(row.steps.next.number, 1);
});

test("activity: shallow clone does not throw", () => {
  const root = repo();
  startPlan(root);
  const clone = path.join(os.tmpdir(), `shallow-${Date.now()}`);
  spawnSync("git", ["clone", "-q", "--depth", "1", "--no-local", `file://${root}`, clone]);
  const r = cliRun(clone, "plan", "list", "--json", "--live");
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).length, 1);
});

function withRemote(): { root: string; bare: string } {
  const root = repo();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "bare-"));
  git(bare, "init", "-q", "--bare");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "origin", "main");
  return { root, bare };
}

test("activity: ahead_of_remote and single fetch from a bare remote", () => {
  const { root } = withRemote();
  startPlan(root);
  git(root, "push", "-q", "origin", `plan/${ID}`);
  git(root, "fetch", "-q", "origin");
  assert.equal(live(root, "--no-fetch")[0].ahead_of_remote, 0);
  git(root, "switch", "-q", `plan/${ID}`);
  git(root, "commit", "-q", "--allow-empty", "-m", "more");
  git(root, "switch", "-q", "main");
  assert.equal(live(root, "--no-fetch")[0].ahead_of_remote, 1);
});

test("activity: remote-only plan is listed live; --no-fetch skips the fetch", () => {
  const { root, bare } = withRemote();
  // A second clone creates a plan branch that exists only on origin.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "other-"));
  git(other, "clone", "-q", bare, "work");
  const work = path.join(other, "work");
  git(work, "switch", "-q", "-c", `plan/${OTHER}`, "origin/main");
  fs.mkdirSync(path.join(work, `plans/${OTHER}/steps`), { recursive: true });
  fs.writeFileSync(path.join(work, `plans/${OTHER}/PLAN.md`), plan(OTHER));
  fs.writeFileSync(path.join(work, `plans/${OTHER}/steps/01-a.md`), step(1, "done").replace(ID, OTHER));
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "plan", "-m", "Specplane-Workflow: step\nSpecplane-Plan: " + OTHER + "\nSpecplane-Step: 1");
  git(work, "push", "-q", "origin", `plan/${OTHER}`);

  assert.equal(live(root, "--no-fetch").some((r) => r.id === OTHER), false);
  const rows = live(root);
  const row = rows.find((r) => r.id === OTHER);
  assert.ok(row, "remote-only plan listed");
  assert.equal(row.where, "remote");
  assert.equal(row.branch, `plan/${OTHER}`);
  assert.equal(row.checkout, null);
  assert.equal(row.stored_status, "ready");
  assert.equal(row.effective_status, "in_progress");
  assert.equal(row.steps.done, 1);
  assert.equal(row.last_step_commit.step, 1);
  assert.equal(row.ahead_of_remote, null);
});

test("plan list without --live has no activity keys", () => {
  const root = repo();
  const row = JSON.parse(cliRun(root, "plan", "list", "--json").out)[0];
  assert.equal("where" in row, false);
  const text = cliRun(root, "plan", "list", "--live", "--no-fetch").out;
  assert.match(text, /steps 0\/2, next 1 Step 1 \(pending\), where none/);
});

test("generate --print: stdout only; --live marks effective statuses; plain output unchanged", () => {
  const root = repo();
  git(root, "branch", `plan/${ID}`);
  const plain = cliRun(root, "plan", "index", "--print");
  const liveOut = cliRun(root, "plan", "index", "--print", "--live");
  assert.equal(plain.code, 0);
  assert.match(plain.out, /\| ready \|/);
  assert.match(liveOut.out, /\| in_progress \|/);
  assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
  assert.notEqual(cliRun(root, "plan", "index", "--live").code, 0);
  cliRun(root, "plan", "index");
  assert.equal(fs.readFileSync(path.join(root, "plans/PLANS.md"), "utf8"), plain.out);
});
