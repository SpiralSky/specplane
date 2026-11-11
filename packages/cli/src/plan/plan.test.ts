import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeRepo } from "../test-repo.js";
import { DEFAULT_PRESET, PRESETS, mode, type Actor, type Preset } from "../perm/permissions.js";
import { acceptRequest, declineRequest, sendRequest } from "../requests/ops.js";
import { listRequests } from "../requests/store.js";
import { validateProject } from "../verify/validate.js";
import { approvePlan, createPlan } from "./create.js";
import { abandonPlan, deletePlan, finishPlan, mergePlan, reviewPlan } from "./finish.js";
import { PlanOpError, loadPlanAt, readStore, worktreeOf, writeStore, type PlanCtx } from "./ctx.js";
import { RequestSent } from "../requests/hold.js";
import { parseGaps, parseHandoff } from "./model.js";
import { resumePlan, retargetPlan, setBudget, startPlan, stepDone, stopPlan } from "./run.js";
import { checkSelection, describePlan, listInfos } from "./status.js";

const ENV = { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" };
const sh = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const F = "docs/specifications/features";
const spec = (id: string, status = "awaiting-review") => `---\nid: feature/${id}\ntitle: ${id}\nstatus: ${status}\nauthors:\n  - human: someone\ncovers: []\n---\n\n# ${id}\n\n## R9: Part\n\nText of ${id}.\n`;

interface Fx { root: string; wt: string; ctx: PlanCtx }
/** Temp repository on `main` with a feature spec, plus a worktree folder outside it. */
function repo(opts: { config?: string; specs?: Record<string, string> } = {}): Fx {
  const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-plan-wt-"));
  const files: Record<string, string> = { [`${F}/export.md`]: spec("export") };
  for (const [id, t] of Object.entries(opts.specs ?? {})) files[`${F}/${id}.md`] = t;
  files[".specplane/config.yaml"] = `paths:\n  features: ${F}\nplans:\n  dir: plans\n  worktree_dir: ${wtBase}\n${opts.config ?? ""}`;
  const root = makeRepo(files);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Pat Person");
  sh(root, "config", "user.email", "pat@example.com");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  return { root, wt: wtBase, ctx: mk(root) };
}
const actor = (role: Actor["role"] = "standard-user"): Actor => role === "llm" ? { role, kind: "llm", name: "claude", model: "claude-sonnet-5-5" } : { role, kind: "human", name: "Pat Person" };
const mk = (root: string, role: Actor["role"] = "standard-user", preset = DEFAULT_PRESET): PlanCtx => ({ root, actor: actor(role), preset, now: new Date("2026-11-10T12:00:00Z"), env: {} });
const ID = "2026-11-10-export-things";
const pad = (n: number) => String(n).padStart(2, "0");
const entry = (n: number, outcome = "done") => `\n## Step ${pad(n)}: Step ${n}\n\n**Date**: 2026-11-10\n**Outcome**: ${outcome}\n\n### What changed\n- \`f${n}.txt\`: work\n\n### Deviations from the step\nNone.\n\n### Gaps found\nNone.\n\n### Open issues\nNone.\n\n### What the next step must know\nNone.\n`;
const step2 = `---\nplan: ${ID}\nstep: 2\ntitle: Second step\n---\n## Goal\n\nMore.\n`;

/** Create, add a second step, commit, approve and return the fixture. */
function approvedPlan(fx: Fx, extra: { implements?: string[]; references?: string[] } = {}): void {
  createPlan(fx.ctx, { words: ["export", "things"], ...extra });
  fs.writeFileSync(path.join(fx.root, `plans/${ID}/steps/02-second-step.md`), step2);
  sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "second step");
  approvePlan(fx.ctx, ID);
}
const audit = (root: string): Record<string, any>[] => {
  const dir = sh(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return fs.readFileSync(path.join(dir, "specplane", "audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
};
const held = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof RequestSent && re.test(e.request.permissions.join(",")), String(re));
const refused = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof PlanOpError && re.test(e.message), String(re));

test("scaffolded plan validates clean and a project without plans reports nothing", () => {
  const fx = repo();
  assert.equal(validateProject(fx.root).findings.filter((f) => f.rule === "plans").length, 0);
  createPlan(fx.ctx, { words: ["export", "things"], implements: ["feature/export"] });
  const r = validateProject(fx.root);
  assert.deepEqual(r.findings.filter((f) => f.rule === "plans"), []);
  const rec = loadPlanAt(fx.root, ID)!;
  assert.equal(rec.progress!.status, "not-started");
  assert.equal(rec.steps.length, 1);
  assert.match(sh(fx.root, "log", "-1", "--format=%B"), /^docs\(export-things\): create plan\n\nSpecplane-Workflow: plan-create\nSpecplane-Plan: 2026-11-10-export-things/);
});

test("validation reports record problems with file and message", () => {
  const fx = repo();
  createPlan(fx.ctx, { words: ["export", "things"], implements: ["feature/export"] });
  const p = (f: string) => path.join(fx.root, "plans", ID, f);
  fs.writeFileSync(p("steps/03-gap.md"), `---\nplan: other\nstep: 4\ntitle: x\n---\n`);
  fs.writeFileSync(p("progress.yaml"), "status: in-progress\ntarget_branch: main\nstart_commit: abc\nbranch: plan/x\ndone: [1]\n");
  fs.writeFileSync(p("HANDOFF.md"), `# H\n${entry(1, "partial")}`);
  fs.writeFileSync(p("spec-gaps.md"), "# G\n\n## G2: case\n\n**Kind**: gap\n**Step**: 1\n**Case**: c\n**Resolution**: r\n**Target spec**: `feature/nope`\n**State**: open\n");
  fs.writeFileSync(p("PLAN.md"), fs.readFileSync(p("PLAN.md"), "utf8").replace("references:", "x:").replace("title:", "references: [plan/2026-11-10-no-such]\ntitle:"));
  const msgs = validateProject(fx.root).findings.filter((f) => f.rule === "plans").map((f) => f.message).join("\n");
  assert.match(msgs, /step numbers must be contiguous/);
  assert.match(msgs, /step plan is "other"/);
  assert.match(msgs, /step 1 is done in progress.yaml but its latest handoff entry is partial/);
  assert.match(msgs, /gap IDs must count up from G1.*found G2/);
  assert.match(msgs, /target spec feature\/nope does not exist/);
  assert.match(msgs, /referenced plan 2026-11-10-no-such does not exist|unresolved reference/);
});

test("validation: id mismatch, reference cycle, outdated reference", () => {
  const fx = repo();
  createPlan(fx.ctx, { words: ["export", "things"], implements: ["feature/export"] });
  createPlan({ ...fx.ctx, now: new Date("2026-11-11T12:00:00Z") }, { words: ["other", "thing"] });
  const A = ID, B = "2026-11-11-other-thing";
  const edit = (id: string, from: string, to: string) => { const f = path.join(fx.root, "plans", id, "PLAN.md"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(from, to)); };
  edit(A, "authors:", `references:\n  - plan/${B}\nauthors:`);
  edit(B, "authors:", `references:\n  - plan/${A}\nauthors:`);
  edit(B, `id: plan/${B}`, "id: plan/wrong");
  fs.writeFileSync(path.join(fx.root, F, "export.md"), spec("export").replace("Text of", "Changed text of"));
  sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "change spec");
  const msgs = validateProject(fx.root).findings.filter((f) => f.rule === "plans");
  const text = msgs.map((f) => `${f.severity} ${f.message}`).join("\n");
  assert.match(text, /error reference cycle among plans: .*2026-11-10-export-things.*2026-11-11-other-thing/);
  assert.match(text, /error PLAN.md id is "plan\/wrong"/);
  assert.match(text, /warning outdated reference: feature\/export was recorded at [0-9a-f]{12} and its latest commit on this branch is [0-9a-f]{12} \(plan 2026-11-10-export-things\)/);
});

test("parsers read handoff entries and gap entries", () => {
  const h = parseHandoff(`# H\n${entry(1)}${entry(1, "partial")}`);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0].missing, []);
  assert.equal(h[1].outcome, "partial");
  const g = parseGaps("## G1: a\n\n**Kind**: gap\n**Step**: 1\n");
  assert.deepEqual(g[0].missing, ["Case", "Resolution", "Target spec", "State"]);
});

test("start refuses an unapproved plan and an unapproved referenced spec, then starts when approved; main is untouched", () => {
  const fx = repo({ specs: { other: spec("other") } });
  createPlan(fx.ctx, { words: ["export", "things"], implements: ["feature/export"] });
  refused(() => startPlan(fx.ctx, ID), /plan itself must be Approved first[\s\S]*feature\/export is not Approved/);
  assert.equal(fs.readdirSync(fx.wt).length, 0, "no worktree was created");
  // Approve the spec through its own file (hand approval is enough for this test): status approved + approval block.
  fs.writeFileSync(path.join(fx.root, F, "export.md"), spec("export").replace("status: awaiting-review", "status: approved").replace("authors:", "approval:\n  by:\n    human: Pat\n  date: 2026-11-10\n  commit: " + sh(fx.root, "rev-parse", "HEAD") + "\nauthors:"));
  sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "approve spec by hand");
  approvePlan(fx.ctx, ID);
  const mainHead = sh(fx.root, "rev-parse", "HEAD");
  const r = startPlan(fx.ctx, ID);
  assert.equal(r.branch, `plan/${ID}`);
  assert.equal(r.target, "main");
  assert.equal(r.startCommit, mainHead);
  assert.ok(!r.path.startsWith(fx.root), "worktree is outside the project");
  assert.equal(r.path, path.join(fx.wt, path.basename(fx.root), ID));
  assert.equal(sh(fx.root, "branch", "--show-current"), "main");
  assert.equal(sh(fx.root, "status", "--porcelain"), "");
  assert.equal(sh(fx.root, "rev-parse", "HEAD"), mainHead);
  assert.equal(sh(r.path, "branch", "--show-current"), `plan/${ID}`);
  const pr = loadPlanAt(r.path, ID)!.progress!;
  assert.equal(pr.status, "in-progress");
  assert.equal(pr.target_branch, "main");
  assert.equal(pr.start_commit, mainHead);
  assert.equal(loadPlanAt(fx.root, ID)!.progress!.status, "not-started", "the main checkout keeps its copy");
  assert.match(sh(r.path, "log", "-1", "--format=%B"), /^chore\(specplane\): start .*\n\nSpecplane-Workflow: start\nSpecplane-Plan: /);
  assert.equal(worktreeOf(fx.root, ID), r.path);
  refused(() => startPlan(fx.ctx, ID), /already exists|is in-progress/);
});

test("start conditions can be turned off, but plan dependencies and cycles still refuse; force-deps records it", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"], implements: ["feature/export"] });
  createPlan({ ...fx.ctx, now: new Date("2026-11-11T12:00:00Z") }, { words: ["base", "work"] });
  const B = "2026-11-11-base-work";
  const f = path.join(fx.root, "plans", ID, "PLAN.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("authors:", `references:\n  - plan/${B}\nauthors:`));
  sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "dep");
  refused(() => startPlan(fx.ctx, ID), /referenced plan 2026-11-11-base-work is not completed/);
  const r = startPlan(fx.ctx, ID, { forceDeps: [B] });
  assert.deepEqual(r.forced, [B]);
  assert.match(fs.readFileSync(path.join(r.path, "plans", ID, "HANDOFF.md"), "utf8"), /not completed: 2026-11-11-base-work/);
});

test("setup command runs once in the worktree; a failing setup removes worktree and branch", () => {
  const ok = repo({ config: "  start_conditions: off\n  setup_command: touch setup-ran\n" });
  createPlan(ok.ctx, { words: ["export", "things"] });
  const r = startPlan(ok.ctx, ID);
  assert.ok(fs.existsSync(path.join(r.path, "setup-ran")));
  const bad = repo({ config: "  start_conditions: off\n  setup_command: echo nope >&2; exit 3\n" });
  createPlan(bad.ctx, { words: ["export", "things"] });
  refused(() => startPlan(bad.ctx, ID), /Setup command failed[\s\S]*nope/);
  assert.equal(sh(bad.root, "branch", "--list", `plan/${ID}`), "");
  assert.equal(sh(bad.root, "worktree", "list").split("\n").length, 1);
  assert.equal(worktreeOf(bad.root, ID), null);
});

test("full flow: steps in order, soft stop, resume, final review, finish, local merge, cleanup", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  approvedPlan(fx, { implements: ["feature/export"] });
  const mainBefore = sh(fx.root, "rev-parse", "HEAD");
  const { path: wt } = startPlan(fx.ctx, ID);
  const info = () => describePlan(fx.ctx, wt, loadPlanAt(wt, ID)!);
  assert.equal(info().status, "in-progress");
  assert.equal(info().next!.number, 1);
  // selection never skips
  const denied = checkSelection(info(), 2, 1);
  assert.equal(denied.ok, false);
  assert.match(denied.message, /step 02 cannot run before step 01 First step/);
  assert.equal(checkSelection(info(), null, "all").steps.length, 2);
  // step-done needs the handoff entry
  refused(() => stepDone(fx.ctx, ID, { step: 1, outcome: "done" }), /no entry for step 01/);
  refused(() => stepDone(fx.ctx, ID, { step: 2, outcome: "done" }), /step 02 cannot be recorded before step 01/);
  const handoff = path.join(wt, "plans", ID, "HANDOFF.md");
  fs.writeFileSync(handoff, `# HANDOFF: ${ID}\n${entry(1)}`);
  fs.writeFileSync(path.join(wt, "f1.txt"), "work\n");
  const d1 = stepDone(fx.ctx, ID, { step: 1, outcome: "done", summary: "do the first step" });
  assert.equal(d1.allDone, false);
  assert.equal(d1.next, 2);
  assert.match(sh(wt, "log", "-1", "--format=%B"), /^feat\(export-things\): do the first step\n\nSpecplane-Workflow: step\nSpecplane-Plan: 2026-11-10-export-things\nSpecplane-Step: 01$/);
  assert.ok(sh(wt, "show", "--stat", "--format=", "HEAD").includes("f1.txt"));
  assert.deepEqual(loadPlanAt(wt, ID)!.progress!.done, [1]);
  // soft stop
  stopPlan(fx.ctx, ID, { kind: "soft", reason: "soft stop at 80% of the weekly limit" });
  const stopped = info();
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.stop!.reason, "soft stop at 80% of the weekly limit");
  assert.equal(listInfos(fx.ctx, true, () => wt).find((i) => i.id === ID)!.status, "stopped");
  assert.equal(listInfos(fx.ctx, false, () => wt).find((i) => i.id === ID)!.status, "not-started");
  refused(() => stepDone(fx.ctx, ID, { step: 2, outcome: "done" }), /is stopped/);
  // resume: soft stop has no session log, next step is 2
  const res = resumePlan(fx.ctx, ID);
  assert.equal(res.next!.number, 2);
  assert.equal(res.sessionLog, null);
  assert.match(res.handoff, /## Step 01/);
  assert.equal(loadPlanAt(wt, ID)!.progress!.stop, undefined);
  assert.equal(info().status, "in-progress");
  fs.appendFileSync(handoff, entry(2));
  const d2 = stepDone(fx.ctx, ID, { step: 2, outcome: "done" });
  assert.equal(d2.allDone, true);
  // all steps done: the plan is in progress with a final review waiting, not completed
  assert.equal(info().status, "in-progress");
  assert.equal(info().reviewPending, true);
  refused(() => finishPlan(fx.ctx, ID, { complete: true }), /Open the final review first/);
  const review = reviewPlan(fx.ctx, ID);
  assert.deepEqual(review.unrun, []);
  assert.equal(review.steps[0].changes[0], "`f1.txt`: work");
  assert.ok(review.acceptance.length >= 1);
  assert.equal(info().status, "in-progress");
  const fin = finishPlan(fx.ctx, ID, { complete: true });
  assert.equal(fin.decision, "completed");
  assert.ok(fs.existsSync(path.join(wt, "plans/archive", ID, "PLAN.md")));
  assert.ok(!fs.existsSync(path.join(wt, "plans", ID)));
  assert.equal(loadPlanAt(wt, ID)!.progress!.status, "completed");
  assert.equal(sh(wt, "status", "--porcelain"), "");
  assert.equal(sh(fx.root, "rev-parse", "HEAD"), mainBefore, "nothing reached main before the merge");
  // merge only locally on the target checkout, after a clean decision
  const m = mergePlan(fx.ctx, ID, { mode: "local" });
  assert.ok(m.merged);
  assert.equal(sh(fx.root, "rev-list", "--parents", "-1", "HEAD").split(" ").length, 3, "a merge commit with two parents");
  assert.ok(fs.existsSync(path.join(fx.root, "plans/archive", ID, "progress.yaml")));
  assert.ok(!fs.existsSync(path.join(fx.root, "plans", ID)));
  assert.ok(fs.existsSync(path.join(fx.root, "f1.txt")));
  assert.ok(!fs.existsSync(wt), "worktree removed after the merge");
  assert.equal(sh(fx.root, "branch", "--list", `plan/${ID}`), "");
  const listed = listInfos(fx.ctx, false, () => fx.root).find((i) => i.id === ID)!;
  assert.equal(listed.status, "completed");
  assert.equal(listed.archived, true);
  const cmds = audit(fx.root).filter((e) => e.outcome === "done").map((e) => e.command);
  for (const c of ["plan create", "plan approve", "plan start", "plan step-done", "plan stop", "plan resume", "plan review", "plan finish", "plan merge"]) assert.ok(cmds.includes(c), c);
});

test("review sent back keeps the plan in progress with the reason; merge refuses when the target moved or from another branch", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const { path: wt } = startPlan(fx.ctx, ID);
  fs.writeFileSync(path.join(wt, "plans", ID, "HANDOFF.md"), `# H\n${entry(1)}`);
  stepDone(fx.ctx, ID, { step: 1, outcome: "done" });
  const rv = reviewPlan(fx.ctx, ID);
  assert.equal(rv.target.branch, "main");
  finishPlan(fx.ctx, ID, { back: "needs a test" });
  assert.equal(loadPlanAt(wt, ID)!.progress!.final_review!.reason, "needs a test");
  assert.equal(loadPlanAt(wt, ID)!.progress!.status, "in-progress");
  refused(() => finishPlan(fx.ctx, ID, { complete: true }), /Open the final review first/);
  reviewPlan(fx.ctx, ID);
  finishPlan(fx.ctx, ID, { complete: true });
  // the target moves after the review
  fs.writeFileSync(path.join(fx.root, "later.txt"), "x"); sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "later");
  refused(() => mergePlan(fx.ctx, ID, { mode: "local" }), /moved after the final review/);
  reviewPlan(fx.ctx, ID);
  sh(fx.root, "switch", "-q", "-c", "elsewhere");
  refused(() => mergePlan(fx.ctx, ID, { mode: "local" }), /runs only in a checkout of the target branch/);
  sh(fx.root, "switch", "-q", "main");
  assert.ok(mergePlan(fx.ctx, ID, { mode: "local" }).merged);
});

test("hard stop resume gives the session log; unexpected end reports stopped; a removed worktree is recreated", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const c = { ...fx.ctx, env: { SPECPLANE_SESSION: "sess-1" } };
  const { path: wt } = startPlan(c, ID);
  assert.equal(describePlan(fx.ctx, wt, loadPlanAt(wt, ID)!).status, "in-progress");
  // a marker older than five minutes means no run
  writeStore(fx.root, `runs/${ID}.json`, { session: "sess-1", pid: null, heartbeat: "2026-11-10T11:50:00Z" });
  const info = describePlan(fx.ctx, wt, loadPlanAt(wt, ID)!);
  assert.equal(info.status, "stopped");
  assert.equal(info.stop!.reason, "session ended unexpectedly");
  assert.equal(loadPlanAt(wt, ID)!.progress!.status, "in-progress", "the file is not rewritten by a status read");
  // remove the checkout; resume recreates it from the branch and offers the session log
  sh(fx.root, "worktree", "remove", "--force", wt);
  const res = resumePlan(c, ID);
  assert.equal(res.recreatedWorktree, true);
  assert.equal(res.sessionLog, "sess-1");
  assert.ok(fs.existsSync(res.path));
  assert.equal(describePlan(fx.ctx, res.path, loadPlanAt(res.path, ID)!).status, "in-progress");
  stopPlan(c, ID, { kind: "hard", reason: "hard stop at 95% of the weekly limit" });
  assert.equal(resumePlan(c, ID).sessionLog, "sess-1");
  // resume a missing target branch asks for a retarget
  stopPlan(c, ID, {});
  sh(fx.root, "branch", "-m", "main", "trunk");
  refused(() => resumePlan(c, ID), /target branch `main` no longer exists/);
  retargetPlan(c, ID, "trunk");
  assert.equal(resumePlan(c, ID).next!.number, 1);
});

test("a step that implements an unapproved specification is waiting and ends a selection", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const sf = path.join(fx.root, "plans", ID, "steps/01-first-step.md");
  fs.writeFileSync(sf, fs.readFileSync(sf, "utf8").replace("title: First step", "title: First step\nimplements: [feature/export]"));
  fs.writeFileSync(path.join(fx.root, "plans", ID, "steps/02-second-step.md"), step2);
  sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "steps");
  const { path: wt } = startPlan(fx.ctx, ID);
  const info = describePlan(fx.ctx, wt, loadPlanAt(wt, ID)!);
  assert.equal(info.next!.waiting, "waiting for approval of feature/export");
  const sel = checkSelection(info, null, "all");
  assert.equal(sel.ok, false);
  assert.match(sel.message, /Step 01 First step is waiting for approval of feature\/export; the plan stops here/);
});

test("budgets are stored in progress.yaml on the plan branch and validated", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const { path: wt } = startPlan(fx.ctx, ID);
  setBudget(fx.ctx, ID, { resource: "weekly", soft: 80, hard: 95 });
  setBudget(fx.ctx, ID, { resource: "5h", soft: 70, hard: 90 });
  assert.deepEqual(loadPlanAt(wt, ID)!.progress!.budget, [{ resource: "weekly", soft: 80, hard: 95 }, { resource: "5h", soft: 70, hard: 90 }]);
  assert.match(sh(wt, "log", "-1", "--format=%B"), /^chore\(specplane\): budget /);
  refused(() => setBudget(fx.ctx, ID, { resource: "weekly", soft: 95, hard: 80 }), /0 < soft <= hard/);
  setBudget(fx.ctx, ID, { resource: "weekly", remove: true });
  assert.deepEqual(loadPlanAt(wt, ID)!.progress!.budget, [{ resource: "5h", soft: 70, hard: 90 }]);
  assert.deepEqual(validateProject(wt).findings.filter((f) => f.rule === "plans" && f.severity === "error"), []);
});

test("abandon archives the plan as abandoned, removes the worktree and keeps the branch; dirty worktree refuses", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const { path: wt } = startPlan(fx.ctx, ID);
  fs.writeFileSync(path.join(wt, "scratch.txt"), "unsaved");
  refused(() => abandonPlan(fx.ctx, ID), /uncommitted changes/);
  assert.ok(fs.existsSync(wt));
  assert.ok(fs.existsSync(path.join(fx.root, "plans", ID)));
  const r = abandonPlan(fx.ctx, ID, { force: true });
  assert.equal(r.kept, `plan/${ID}`);
  assert.ok(!fs.existsSync(wt));
  assert.equal(sh(fx.root, "branch", "--list", `plan/${ID}`), `plan/${ID}`);
  const rec = loadPlanAt(fx.root, ID)!;
  assert.equal(rec.archived, true);
  assert.equal(rec.progress!.status, "abandoned");
  assert.equal(sh(fx.root, "status", "--porcelain"), "");
  const archived = listInfos(fx.ctx, false, () => fx.root).find((i) => i.id === ID)!;
  assert.equal(archived.status, "abandoned");
  refused(() => resumePlan(fx.ctx, ID), /abandoned and cannot be resumed/);
});

test("delete removes the plan folder and the worktree; references to it are reported missing", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  createPlan({ ...fx.ctx, now: new Date("2026-11-11T12:00:00Z") }, { words: ["other", "thing"] });
  const B = "2026-11-11-other-thing";
  const f = path.join(fx.root, "plans", B, "PLAN.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("authors:", `references:\n  - plan/${ID}\nauthors:`));
  sh(fx.root, "add", "-A"); sh(fx.root, "commit", "-q", "-m", "ref");
  const { path: wt } = startPlan(fx.ctx, ID);
  deletePlan(fx.ctx, ID);
  assert.ok(!fs.existsSync(path.join(fx.root, "plans", ID)));
  assert.ok(!fs.existsSync(wt));
  assert.equal(readStore<Record<string, string>>(fx.root, "worktrees.json")![ID], undefined);
  const msgs = validateProject(fx.root).findings.filter((x) => x.rule === "plans").map((x) => x.message).join("\n");
  assert.match(msgs, /plan 2026-11-10-export-things does not exist|referenced plan 2026-11-10-export-things does not exist/);
});

test("permissions: request-user sends a request, deny is refused, nothing runs, and decisions are audited", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const llm = mk(fx.root, "llm");
  held(() => startPlan(llm, ID), /plan.start/);
  assert.equal(fs.readdirSync(fx.wt).length, 0, "no worktree after a refusal");
  assert.equal(sh(fx.root, "branch", "--list", `plan/${ID}`), "");
  const full = PRESETS.find((p) => p.id === "full-manual-editing")!;
  held(() => createPlan(mk(fx.root, "llm", full), { words: ["another", "plan"] }), /plan.create/);
  // allowed for the LLM in the default preset: creating a plan; never completing or approving it
  const made = createPlan(mk(fx.root, "llm"), { words: ["llm", "made"] });
  assert.match(fs.readFileSync(path.join(fx.root, "plans", made.id, "PLAN.md"), "utf8"), /authors:\n {2}- llm: claude-sonnet-5-5/);
  held(() => approvePlan(mk(fx.root, "llm"), made.id), /spec.approve/);
  held(() => finishPlan(llm, ID, { complete: true }), /plan.complete/);
  held(() => abandonPlan(llm, ID), /plan.abandon/);
  held(() => deletePlan(llm, ID), /plan.delete/);
  held(() => setBudget(llm, ID, { resource: "weekly", soft: 1, hard: 2 }), /plan.budget/);
  const log = audit(fx.root);
  const r = log.find((e) => e.command === "plan start" && e.outcome === "request-sent")!;
  assert.equal(r.permission, "plan.start");
  assert.ok(r.request);
  assert.equal(r.actor.role, "llm");
  assert.ok(log.some((e) => e.command === "plan create" && e.outcome === "done" && e.actor.role === "llm"));
  // the soft stop is allowed to the LLM in every preset (checked on a started plan)
  startPlan(fx.ctx, ID);
  stopPlan(llm, ID, { kind: "soft", reason: "blocked" });
  assert.equal(loadPlanAt(worktreeOf(fx.root, ID)!, ID)!.progress!.stop!.kind, "soft");
});

test("create validates names and refuses a duplicate", () => {
  const fx = repo();
  refused(() => createPlan(fx.ctx, { words: ["one"] }), /two to four words/);
  refused(() => createPlan(fx.ctx, { words: ["a", "b", "c", "d", "e"] }), /two to four words/);
  refused(() => createPlan(fx.ctx, { words: ["x", "y"], implements: ["feature/nope"] }), /does not exist/);
  createPlan(fx.ctx, { words: ["export", "things"] });
  assert.throws(() => createPlan(fx.ctx, { words: ["export", "things"] }), /already exists/);
  void worktreeOf;
});

test("CLI: create, approve, start, status, next, step-done, review, finish and merge work end to end", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "cli.js");
  const sp = (...a: string[]) => spawnSync("node", [cli, ...a], { cwd: fx.root, encoding: "utf8", env: ENV });
  const ok = (...a: string[]) => { const r = sp(...a); assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}${r.stdout}`); return r.stdout; };
  const id = /Created plan (\S+)/.exec(ok("plan", "create", "cli", "flow", "--implements", "feature/export"))![1];
  assert.match(id, /^\d{4}-\d{2}-\d{2}-cli-flow$/);
  ok("plan", "approve", id);
  assert.match(ok("plan", "list"), new RegExp(`${id}  not-started  approved  0/1 steps  next 01 First step`));
  const started = ok("plan", "start", id);
  assert.match(started, /Started .* on plan\/.* \(target main\)/);
  const wt = /Worktree: (.*)/.exec(started)![1];
  assert.match(ok("plan", "list", "--live"), new RegExp(`${id}  in-progress  approved  0/1 steps`));
  const denied = sp("plan", "next", id, "--from", "2");
  assert.equal(denied.status, 1);
  assert.match(ok("plan", "next", id), /Next step: 01 First step/);
  fs.writeFileSync(path.join(wt, "plans", id, "HANDOFF.md"), `# H\n${entry(1)}`);
  assert.match(ok("plan", "step-done", id, "--step", "1", "--outcome", "done"), /Every step is done; open the final review/);
  assert.match(ok("plan", "review", id), /Steps that never ran: none/);
  ok("plan", "finish", id, "--complete");
  assert.match(ok("plan", "merge", id, "--local"), /Merged plan\/.* into main/);
  assert.match(ok("plan", "list"), new RegExp(`${id}  completed \\(archived\\)`));
  const refusedOut = sp("plan", "delete", "no-such-plan");
  assert.equal(refusedOut.status, 1);
});

/* ------------------------------------------------------------------ requests in plans */

test("accepting a plan.start request starts the plan once, under the accepter", async () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  try { startPlan(mk(fx.root, "llm"), ID); assert.fail("expected a request"); } catch (e) { assert.ok(e instanceof RequestSent); }
  assert.equal(fs.readdirSync(fx.wt).length, 0);
  const [req] = listRequests(fx.root);
  assert.equal(req.plan, ID);
  const res = await acceptRequest({ root: fx.root, actor: actor(), preset: DEFAULT_PRESET, now: fx.ctx.now }, req.id);
  assert.ok(res.ok, res.reasons.join());
  assert.equal(loadPlanAt(worktreeOf(fx.root, ID)!, ID)!.progress!.status, "in-progress");
  assert.ok(audit(fx.root).some((e) => e.command === "plan start" && e.outcome === "done" && e.request === req.id && e.actor.role === "standard-user"));
});

test("step-done needs plan.step, which is allow for the LLM in every default preset", () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  const { path: wt } = startPlan(fx.ctx, ID);
  fs.writeFileSync(path.join(wt, "plans", ID, "HANDOFF.md"), `# H\n${entry(1)}`);
  const none: Preset = { ...DEFAULT_PRESET, llm: { modes: {} } };
  refused(() => stepDone(mk(fx.root, "llm", none), ID, { step: 1, outcome: "done" }), /plan\.step/);
  for (const p of PRESETS) assert.equal(mode(p, "llm", "plan.step"), "allow", p.id);
  assert.ok(stepDone(mk(fx.root, "llm"), ID, { step: 1, outcome: "done" }).commit);
  assert.ok(audit(fx.root).some((e) => e.command === "plan step-done" && e.permission === "plan.step" && e.outcome === "done"));
});

test("a blocking request soft stops the plan; answering it names the plan to resume and the answer is in the resume context", async () => {
  const fx = repo({ config: "  start_conditions: off\n" });
  createPlan(fx.ctx, { words: ["export", "things"] });
  startPlan(fx.ctx, ID);
  const llm = mk(fx.root, "llm");
  const sent = sendRequest(llm, { command: "spec approve", params: { ids: ["feature/export"] }, permissions: ["spec.approve"], reason: "approve export", plan: ID, blocking: true });
  assert.ok(sent.ok);
  const pr = loadPlanAt(worktreeOf(fx.root, ID)!, ID)!.progress!;
  assert.equal(pr.status, "stopped");
  assert.equal(pr.stop!.reason, `waiting for request ${sent.request!.id}`);
  const dec = await declineRequest({ root: fx.root, actor: actor(), preset: DEFAULT_PRESET, now: fx.ctx.now }, sent.request!.id, "no thanks");
  assert.equal(dec.resume, ID);
  const res = resumePlan(fx.ctx, ID);
  assert.equal(res.answers.length, 1);
  assert.equal(res.answers[0].state, "declined");
  assert.equal(res.answers[0].note, "no thanks");
  // a non-blocking request does not stop the plan and is listed in the final review
  const nb = sendRequest(llm, { command: "spec approve", params: { ids: ["feature/export"] }, permissions: ["spec.approve"], reason: "later", plan: ID });
  assert.equal(loadPlanAt(worktreeOf(fx.root, ID)!, ID)!.progress!.status, "in-progress");
  assert.deepEqual(reviewPlan(fx.ctx, ID).pendingRequests, [nb.request!.id]);
});
