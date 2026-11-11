import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseCite } from "../spec/cites.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveCite } from "../spec/project.js";
import { committedSource } from "../spec/source.js";
import { HANDOFF_SECTIONS, findPlan, latestEntry, loadPlans, nextStep, planImplements, planReferences, referencedPlans, type PlanRecord } from "./model.js";
import { readRequest } from "../requests/store.js";
import {
  PlanOpError, assertMeasurable, branchExists, clearRun, commitPaths, currentBranch, git, gitTry, guarded, guardedWith, isDirty, listWorktreePaths, loadPlanAt, mainRoot,
  recoveredStop, planSlug, plansConfig, plansDir, requirePlan, revParse, setWorktree, worktreeOf, writeProgress, writeRun, type PlanCtx,
} from "./ctx.js";
import { planApproval, specApproved } from "./status.js";
import { planCycles } from "./validate.js";

/** Start, step recording, stop, resume, budget and retarget (`architecture/reference-cli` §11.3, §11.4). */

const env = (ctx: PlanCtx) => ctx.env ?? process.env;
const session = (ctx: PlanCtx): string | null => (ctx.actor.session ?? env(ctx).SPECPLANE_SESSION) || null;
const pad = (n: number) => String(n).padStart(2, "0");

/** Where plan worktrees go: `<worktree_dir>/<project-folder>/<plan-id>`, outside the project (`repository-layout` §3). */
export function worktreePathFor(root: string, id: string): string {
  const main = mainRoot(root);
  const cfg = plansConfig(root);
  const base = path.resolve(main, cfg.worktreeDir ?? "../specplane-plans");
  const target = path.join(base, path.basename(main), id);
  const rel = path.relative(main, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new PlanOpError(`plans.worktree_dir resolves inside the project (${target}); set it to a folder outside the project.`);
  }
  return target;
}

export interface StartOpts { target?: string; forceDeps?: string[] }
export interface StartResult { path: string; branch: string; target: string; startCommit: string; forced: string[] }

export function startPlan(ctx: PlanCtx, id: string, o: StartOpts = {}): StartResult {
  return guardedWith({ id, ...o }, ctx, "plan start", [id], ["plan.start"], "Starting a plan", () => startInner(ctx, id, o));
}

function startInner(ctx: PlanCtx, id: string, o: StartOpts): StartResult {
  const root = ctx.root;
  const dir = plansDir(root);
  const target = o.target ?? currentBranch(root);
  if (!target) throw new PlanOpError("Name the target branch with --target; the checkout is not on a branch.");
  if (!branchExists(root, target)) throw new PlanOpError(`Target branch \`${target}\` does not exist.`);
  const targetCommit = revParse(root, `refs/heads/${target}`)!;
  const src = committedSource(root, targetCommit);
  const project = loadProject(src, loadSpecPaths(root).paths);
  const plans = loadPlans(src, dir);
  const rec = plans.find((p) => p.id === id && !p.archived);
  if (!rec) throw new PlanOpError(`Plan \`${id}\` is not committed in ${dir} on \`${target}\`; commit it there first.`);
  if (rec.legacy || !rec.progress) throw new PlanOpError(`Plan \`${id}\` has no progress.yaml; it is in the retired plan format.`);
  if (rec.progress.status !== "not-started") {
    throw new PlanOpError(`Plan \`${id}\` is ${rec.progress.status}; ${rec.progress.status === "stopped" || rec.progress.status === "in-progress" ? "use `specplane plan resume`" : "it cannot be started"}.`);
  }
  if (rec.steps.length === 0) throw new PlanOpError(`Plan \`${id}\` has no steps.`);

  // Start conditions (`plan-execution R27.6`).
  const issues: string[] = [];
  if (plansConfig(root).startConditions) {
    const ap = planApproval(root, project, rec);
    if (ap.status !== "approved") issues.push(`the plan itself must be Approved first (${ap.reasons.join(", ")})`);
    const seen = new Set<string>();
    const needSpec = (specId: string) => { if (!seen.has(specId)) { seen.add(specId); if (!specApproved(root, project, specId)) issues.push(`${specId} is not Approved`); } };
    for (const e of planImplements(rec.fm)) if (e.mode === "implements") needSpec(e.spec);
    for (const raw of planReferences(rec.fm)) {
      const c = parseCite(raw);
      const r = c ? resolveCite(project, c) : null;
      if (r?.ok && r.target.specId) needSpec(r.target.specId);
    }
  }
  const forced: string[] = [];
  for (const dep of referencedPlans(rec.fm)) {
    const d = plans.find((p) => p.id === dep);
    if (!d) { issues.push(`referenced plan ${dep} does not exist`); continue; }
    if (d.progress?.status === "completed") continue;
    if (o.forceDeps?.includes(dep)) forced.push(dep);
    else issues.push(`referenced plan ${dep} is not completed (${d.progress?.status ?? "unknown"}); name it with --force-deps to start anyway`);
  }
  const cycle = planCycles(plans).find((c) => c.includes(id));
  if (cycle) issues.push(`reference cycle among plans: ${[...cycle, cycle[0]].join(" -> ")}`);
  if (issues.length) throw new PlanOpError(`Cannot start plan ${id}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);

  const branch = `plan/${id}`;
  if (branchExists(root, branch)) throw new PlanOpError(`Branch \`${branch}\` already exists.`);
  const wt = worktreePathFor(root, id);
  if (fs.existsSync(wt)) throw new PlanOpError(`${wt} already exists.`);
  git(root, ["worktree", "add", "-b", branch, wt, targetCommit]);
  const undo = () => {
    gitTry(root, ["worktree", "remove", "--force", wt]);
    gitTry(root, ["branch", "-D", branch]);
    setWorktree(root, id, null);
  };
  setWorktree(root, id, wt);
  const setup = plansConfig(root).setupCommand;
  if (setup) {
    try { execFileSync("sh", ["-c", setup], { cwd: wt, stdio: "pipe", env: { ...process.env } }); }
    catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer; message: string };
      undo();
      throw new PlanOpError(`Setup command failed, so the plan did not start and its worktree was removed:\n${(err.stderr?.toString() || err.stdout?.toString() || err.message).trim()}`);
    }
  }
  try {
    const local = loadPlanAt(wt, id)!;
    const first = nextStep(local) ?? 1;
    writeProgress(wt, local, {
      ...local.progress!, status: "in-progress", target_branch: target, start_commit: targetCommit, branch, current_step: first, done: [],
      ...(session(ctx) ? { session: session(ctx)! } : {}),
    });
    const files = [local.progressFile];
    if (forced.length) {
      fs.writeFileSync(path.join(wt, local.handoffFile), `# HANDOFF: ${id}\n\nStarted anyway with plans that were not completed: ${forced.join(", ")}.\n`);
      files.push(local.handoffFile);
    }
    commitPaths(ctx, wt, files, { type: "chore", scope: "specplane", summary: `start ${id}`, workflow: "start", planId: id });
  } catch (e) { undo(); throw e; }
  writeRun(ctx, id, session(ctx), null, true);
  return { path: wt, branch, target, startCommit: targetCommit, forced };
}

/* ------------------------------------------------------------------ step recording */

export interface StepDoneOpts { step: number; outcome: "done" | "partial"; summary?: string; type?: string }

export function stepDone(ctx: PlanCtx, id: string, o: StepDoneOpts): { commit: string; allDone: boolean; next: number | null } {
  // Recording a step needs no permission of its own (`reference-cli §11.3`); the commit it makes is the plan's own bookkeeping.
  return recordedRun(ctx, "plan step-done", [id, String(o.step), o.outcome], { id, ...o }, () => stepDoneInner(ctx, id, o));
}

function recordedRun<T>(ctx: PlanCtx, command: string, args: string[], params: Record<string, unknown>, fn: () => T): T {
  return guardedWith(params, ctx, command, args, [], "Recording a plan step", fn);
}

function stepDoneInner(ctx: PlanCtx, id: string, o: StepDoneOpts) {
  const { root, rec } = requirePlan(ctx, id);
  const pr = rec.progress!;
  if (pr.status !== "in-progress") throw new PlanOpError(`Plan \`${id}\` is ${pr.status}; a step is recorded only while it is in progress.`);
  const next = nextStep(rec);
  if (next === null) throw new PlanOpError("Every step is done.");
  if (o.step !== next) throw new PlanOpError(`Denied: step ${pad(o.step)} cannot be recorded before step ${pad(next)}, which comes first.`);
  const entry = latestEntry(rec, o.step);
  if (!entry) throw new PlanOpError(`HANDOFF.md has no entry for step ${pad(o.step)}; write it first.`);
  if (entry.outcome !== o.outcome) throw new PlanOpError(`The latest handoff entry for step ${pad(o.step)} has outcome ${entry.outcome ?? "(none)"}, not ${o.outcome}.`);
  if (entry.missing.length) throw new PlanOpError(`The handoff entry for step ${pad(o.step)} is missing ${entry.missing.join(", ")}; all ${HANDOFF_SECTIONS.length} sections are required (write \`None.\` for an empty one).`);
  const done = o.outcome === "done" ? [...pr.done, o.step].sort((a, b) => a - b) : pr.done;
  const after = { ...rec, progress: { ...pr, done } };
  const nxt = nextStep(after);
  writeProgress(root, rec, { ...pr, done, current_step: nxt ?? o.step, ...(session(ctx) ? { session: session(ctx)! } : {}) });
  const stepFile = rec.steps.find((s) => s.number === o.step);
  const title = typeof stepFile?.fm.data?.title === "string" ? (stepFile.fm.data.title as string) : `step ${pad(o.step)}`;
  const summary = o.summary?.trim() || (o.outcome === "done" ? `complete ${title.toLowerCase()}` : `partial ${title.toLowerCase()}`);
  // The step's work and its record go in one commit; the session may also have committed its work earlier (R27.4).
  git(root, ["add", "-A", "--", "."]);
  const commit = commitPaths(ctx, root, ["."], { onlyStaged: true, type: o.type ?? "feat", scope: planSlug(id), summary, body: o.outcome === "partial" ? `Partial: step ${pad(o.step)} halted; see the handoff entry for where a re-run starts.` : undefined, workflow: "step", planId: id, step: o.step });
  if (nxt === null && o.outcome === "done") clearRun(ctx.root, id);
  return { commit, allDone: nxt === null && o.outcome === "done", next: nxt };
}

/* ------------------------------------------------------------------ stop, resume */

export interface StopOpts { kind?: "soft" | "user" | "hard" | "failure"; reason?: string; needs?: string }

export function stopPlan(ctx: PlanCtx, id: string, o: StopOpts = {}): { commit: string } {
  return guardedWith({ id, ...o }, ctx, "plan stop", [id, o.kind ?? "user"], ["plan.softstop"], "Stopping a plan", () => {
    const { root, rec } = requirePlan(ctx, id);
    const pr = rec.progress!;
    if (pr.status !== "in-progress" && !(pr.status === "stopped")) throw new PlanOpError(`Plan \`${id}\` is ${pr.status}; only a plan in progress can be stopped.`);
    const kind = o.kind ?? "user";
    writeProgress(root, rec, { ...pr, status: "stopped", stop: { kind, reason: o.reason?.trim() || (kind === "user" ? "stopped by the user" : "stopped"), needs: o.needs?.trim() || "resume the plan" } });
    const commit = commitPaths(ctx, root, [rec.progressFile], { type: "chore", scope: "specplane", summary: `stop ${id}`, workflow: "stop", planId: id });
    clearRun(ctx.root, id);
    return { commit };
  });
}

export interface ResumeResult {
  plan: string;
  path: string;
  next: { number: number; title: string; file: string } | null;
  handoff: string;
  stopped: { kind?: string; reason?: string; needs?: string } | null;
  /** Session whose log a new session skims after a hard stop, a failure or an unexpected end; absent after a soft stop. */
  sessionLog: string | null;
  recreatedWorktree: boolean;
  /** Answers to the request that stopped the plan (`plan-execution R27.5.1`); empty when none did. */
  answers: { request: string; state: string; action: string; reason: string; note: string | null; error?: string }[];
}

export function resumePlan(ctx: PlanCtx, id: string): ResumeResult {
  return guarded(ctx, "plan resume", [id], ["plan.resume"], "Resuming a plan", () => {
    // The live copy is in the plan's worktree, or on the plan branch when the worktree is gone; this checkout's copy is stale.
    const here = loadPlanAt(ctx.root, id);
    if (here?.archived && here.progress && ["completed", "abandoned"].includes(here.progress.status)) throw new PlanOpError(`Plan \`${id}\` is ${here.progress.status} and cannot be resumed; create a new plan.`);
    const wt0 = worktreeOf(ctx.root, id);
    const rec0 = wt0 ? loadPlanAt(wt0, id) : branchExists(ctx.root, `plan/${id}`) ? findPlan(committedSource(ctx.root, `plan/${id}`), plansDir(ctx.root), id) : loadPlanAt(ctx.root, id);
    if (!rec0 || rec0.legacy || !rec0.progress) throw new PlanOpError(`Plan \`${id}\` not found.`);
    const pr0 = rec0.progress;
    if (pr0.status === "completed" || pr0.status === "abandoned") throw new PlanOpError(`Plan \`${id}\` is ${pr0.status} and cannot be resumed; create a new plan.`);
    if (pr0.status === "not-started") throw new PlanOpError(`Plan \`${id}\` has not started; use \`specplane plan start\`.`);
    const branch = pr0.branch ?? `plan/${id}`;
    if (!pr0.target_branch || !branchExists(ctx.root, pr0.target_branch)) {
      throw new PlanOpError(`The target branch ${pr0.target_branch ? `\`${pr0.target_branch}\` ` : ""}no longer exists; the plan stays stopped. Choose a new one with \`specplane plan retarget ${id} --target <branch>\`.`);
    }
    let wt = worktreeOf(ctx.root, id);
    let recreated = false;
    if (!wt) {
      if (!branchExists(ctx.root, branch)) throw new PlanOpError(`Branch \`${branch}\` is gone; the plan cannot be resumed.`);
      wt = worktreePathFor(ctx.root, id);
      git(ctx.root, ["worktree", "add", wt, branch]);
      setWorktree(ctx.root, id, wt);
      recreated = true;
    }
    const rec = loadPlanAt(wt, id)!;
    const pr = rec.progress!;
    const unexpected = pr.status === "in-progress";
    const stop = pr.stop ?? (unexpected ? recoveredStop(ctx, id, pr.session) : null);
    const { stop: _s, ...rest } = pr;
    writeProgress(wt, rec, { ...rest, status: "in-progress", ...(session(ctx) ? { session: session(ctx)! } : {}) });
    if (isDirtyProgress(wt, rec)) commitPaths(ctx, wt, [rec.progressFile], { type: "chore", scope: "specplane", summary: `resume ${id}`, workflow: "resume", planId: id });
    writeRun(ctx, id, session(ctx), null, true);
    const n = nextStep(rec);
    const step = n === null ? null : rec.steps.find((s) => s.number === n)!;
    const hard = stop?.kind === "hard" || stop?.kind === "failure";
    return {
      plan: id, path: wt, stopped: stop ?? null,
      next: step ? { number: n!, title: typeof step.fm.data?.title === "string" ? (step.fm.data.title as string) : step.name, file: step.file } : null,
      handoff: rec.handoffText ?? "", sessionLog: hard ? pr.session ?? null : null, recreatedWorktree: recreated,
      answers: requestAnswers(ctx.root, stop?.reason),
    };
  });
}

function requestAnswers(root: string, reason: string | undefined): ResumeResult["answers"] {
  const m = /waiting for request (\S+)/.exec(reason ?? "");
  const r = m ? readRequest(root, m[1]) : null;
  return r && r.answer ? [{ request: r.id, state: r.state, action: r.action.command, reason: r.reason, note: r.answer.note ?? null, ...(r.answer.error ? { error: r.answer.error } : {}) }] : [];
}

function isDirtyProgress(root: string, rec: PlanRecord): boolean {
  return (gitTry(root, ["status", "--porcelain", "--", rec.progressFile]) ?? "").trim() !== "";
}

/* ------------------------------------------------------------------ budget and retarget */

export interface BudgetOpts { resource: string; soft?: number; hard?: number; remove?: boolean }

export function setBudget(ctx: PlanCtx, id: string, o: BudgetOpts): { commit: string } {
  return guardedWith({ id, ...o }, ctx, "plan budget", [id, o.resource], ["plan.budget"], "Setting a plan budget", () => {
    const { root, rec } = requirePlan(ctx, id);
    const pr = rec.progress!;
    if (pr.status === "completed" || pr.status === "abandoned") throw new PlanOpError(`Plan \`${id}\` is ${pr.status}; its budget cannot change.`);
    const list = (pr.budget ?? []).filter((b) => b.resource !== o.resource);
    if (!o.remove) {
      assertMeasurable(ctx, o.resource);
      if (!(o.soft! > 0) || !(o.hard! >= o.soft!)) throw new PlanOpError("A budget needs 0 < soft <= hard (percent of the resource).");
      list.push({ resource: o.resource, soft: o.soft!, hard: o.hard! });
    }
    const { budget: _b, ...rest } = pr;
    writeProgress(root, rec, { ...rest, ...(list.length ? { budget: list } : {}) });
    const commit = commitPaths(ctx, root, [rec.progressFile], { type: "chore", scope: "specplane", summary: `budget ${id}`, workflow: "budget", planId: id });
    return { commit };
  });
}

export function retargetPlan(ctx: PlanCtx, id: string, target: string): { commit: string } {
  return guardedWith({ id, target }, ctx, "plan retarget", [id, target], ["plan.resume"], "Changing a plan's target branch", () => {
    const { root, rec } = requirePlan(ctx, id);
    const pr = rec.progress!;
    if (!["in-progress", "stopped"].includes(pr.status)) throw new PlanOpError(`Plan \`${id}\` is ${pr.status}; only a started plan has a target.`);
    if (!branchExists(ctx.root, target)) throw new PlanOpError(`Branch \`${target}\` does not exist.`);
    writeProgress(root, rec, { ...pr, target_branch: target });
    return { commit: commitPaths(ctx, root, [rec.progressFile], { type: "chore", scope: "specplane", summary: `retarget ${id}`, workflow: "retarget", planId: id }) };
  });
}


