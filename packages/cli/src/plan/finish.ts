import * as fs from "node:fs";
import * as path from "node:path";
import { parseCite } from "../spec/cites.js";
import { specFingerprint } from "../spec/fingerprint.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveCite, type Project } from "../spec/project.js";
import { committedSource } from "../spec/source.js";
import { run } from "../git/exec.js";
import { storeDir } from "../repo/store.js";
import { latestEntry, readPlan, planImplements, planReferences, stepNumbers, stepTitle, type PlanRecord } from "./model.js";
import {
  PlanOpError, branchExists, clearRun, commitPaths, currentBranch, git, gitTry, guarded, guardedWith, humanName, isDirty, loadPlanAt, nowIso,
  plansDir, readStore, removeStore, requirePlan, revParse, setWorktree, worktreeOf, writeProgress, writeStore, type PlanCtx,
} from "./ctx.js";
import { specApproved } from "./status.js";

/** Final review, finishing, merging, abandoning and deleting (`architecture/reference-cli` §11.6, §11.7). */

const pad = (n: number) => String(n).padStart(2, "0");
const actorBy = (ctx: PlanCtx): Record<string, string> => (ctx.actor.kind === "llm" ? { llm: ctx.actor.model ?? ctx.actor.name } : { human: humanName(ctx.root) ?? ctx.actor.name });

/* ------------------------------------------------------------------ review */

export interface SpecChange { spec: string; status: string; where: "target" | "plan-branch"; note: string }
export interface PlanReview {
  plan: string;
  status: string;
  steps: { number: number; title: string; done: boolean; outcome: string | null; changes: string[] }[];
  unrun: number[];
  openGaps: { id: string; kind: string; case: string; state: string }[];
  pendingRequests: string[];
  acceptance: string[];
  changedOnTarget: SpecChange[];
  changedOnPlanBranch: SpecChange[];
  target: { branch: string | null; commit: string | null };
  notes: string[];
}

function acceptanceCriteria(rec: PlanRecord): string[] {
  const body = rec.fm?.body ?? "";
  const m = /^## Acceptance criteria\s*$/m.exec(body);
  if (!m) return [];
  const rest = body.slice(m.index + m[0].length).split(/^## /m)[0];
  return rest.split("\n").map((l) => /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);
}

function specIdsOf(rec: PlanRecord, project: Project): string[] {
  const ids = new Set<string>();
  for (const e of planImplements(rec.fm)) if (e.spec) ids.add(e.spec);
  for (const raw of planReferences(rec.fm)) {
    const c = parseCite(raw);
    const r = c ? resolveCite(project, c) : null;
    if (r?.ok && r.target.specId) ids.add(r.target.specId);
  }
  return [...ids].sort();
}

/** Assemble the final review and record the target tip it was shown against (`plan-execution §2`). Read-only for the project. */
export function reviewPlan(ctx: PlanCtx, id: string): PlanReview {
  return guarded(ctx, "plan review", [id], ["info.retrieve"], "Opening the final review", () => reviewInner(ctx, id));
}

function reviewInner(ctx: PlanCtx, id: string): PlanReview {
  const { root, rec } = requirePlan(ctx, id);
  const pr = rec.progress!;
  const notes: string[] = [];
  const done = new Set(pr.done);
  const steps = rec.steps.filter((s) => s.number !== null).map((s) => {
    const e = latestEntry(rec, s.number!);
    const changes = (e?.sections["What changed"] ?? "").split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter((l) => l && l !== "None.");
    return { number: s.number!, title: stepTitle(s), done: done.has(s.number!), outcome: e?.outcome ?? null, changes };
  });
  const unrun = steps.filter((s) => !s.done).map((s) => s.number);
  const openGaps = rec.gaps.filter((g) => g.fields.State === "open").map((g) => ({ id: `G${g.n}`, kind: g.fields.Kind ?? "", case: g.fields.Case ?? g.title, state: g.fields.State }));
  const reqDir = path.join(storeDir(ctx.root), "requests");
  const pendingRequests: string[] = [];
  try {
    for (const f of fs.readdirSync(reqDir)) {
      try { const r = JSON.parse(fs.readFileSync(path.join(reqDir, f), "utf8")) as { id: string; plan: string | null; state: string }; if (r.plan === id && r.state === "pending") pendingRequests.push(r.id); } catch { /* skip */ }
    }
  } catch { /* no requests */ }
  const target = pr.target_branch ?? null;
  const tip = target && branchExists(ctx.root, target) ? revParse(ctx.root, `refs/heads/${target}`) : null;
  if (target && !tip) notes.push(`Target branch ${target} no longer exists; changes on it cannot be shown.`);
  const changedOnTarget: SpecChange[] = [];
  const changedOnPlanBranch: SpecChange[] = [];
  if (pr.start_commit) {
    const paths = loadSpecPaths(root).paths;
    const at = (rev: string) => loadProject(committedSource(root, rev), paths);
    const start = at(pr.start_commit);
    const planHead = at("HEAD");
    const tipP = tip ? at(tip) : null;
    for (const spec of specIdsOf(rec, planHead)) {
      const fp = (p: Project | null) => { const d = p?.specs.get(spec); return d ? specFingerprint(d.text) : null; };
      const s0 = fp(start);
      if (tipP && fp(tipP) !== s0) changedOnTarget.push({ spec, where: "target", status: specApproved(ctx.root, tipP, spec) ? "approved" : "awaiting-review", note: fp(tipP) === null ? "removed on the target branch" : "content changed on the target branch since the plan started" });
      if (fp(planHead) !== s0) changedOnPlanBranch.push({ spec, where: "plan-branch", status: specApproved(root, planHead, spec) ? "approved" : "awaiting-review", note: "changed by the plan" });
    }
  }
  if (target && tip) writeStore(ctx.root, `reviews/${id}.json`, { target_branch: target, target_commit: tip, seen: nowIso(ctx) });
  return { plan: id, status: pr.status, steps, unrun, openGaps, pendingRequests, acceptance: acceptanceCriteria(rec), changedOnTarget, changedOnPlanBranch, target: { branch: target, commit: tip }, notes };
}

export function formatReview(r: PlanReview): string {
  const L: string[] = [`Final review of ${r.plan} (${r.status})`, ""];
  L.push("Steps:");
  for (const s of r.steps) L.push(`  ${pad(s.number)} ${s.title}: ${s.done ? "done" : s.outcome === "partial" ? "partial" : "not run"}${s.changes.length ? `; ${s.changes.join("; ")}` : ""}`);
  L.push("", `Steps that never ran: ${r.unrun.length ? r.unrun.map(pad).join(", ") : "none"}`);
  L.push("", "Open gaps and assumptions:");
  if (!r.openGaps.length) L.push("  none"); else for (const g of r.openGaps) L.push(`  ${g.id} (${g.kind}): ${g.case}`);
  L.push("", `Unanswered requests: ${r.pendingRequests.length ? r.pendingRequests.join(", ") : "none"}`);
  L.push("", "Acceptance criteria (the review lists them; deciding is the user's):");
  if (!r.acceptance.length) L.push("  none written"); else for (const a of r.acceptance) L.push(`  - ${a}`);
  L.push("", "Specifications changed on the target branch since the plan started:");
  if (!r.changedOnTarget.length) L.push("  none"); else for (const c of r.changedOnTarget) L.push(`  ${c.spec} (${c.status}): ${c.note}`);
  L.push("", "Specifications changed by the plan on its own branch:");
  if (!r.changedOnPlanBranch.length) L.push("  none"); else for (const c of r.changedOnPlanBranch) L.push(`  ${c.spec} (${c.status})`);
  for (const n of r.notes) L.push("", n);
  L.push("", `Decide with: specplane plan finish ${r.plan} --complete | --back <reason>`);
  return L.join("\n") + "\n";
}

/* ------------------------------------------------------------------ finish */

export function finishPlan(ctx: PlanCtx, id: string, o: { complete?: boolean; back?: string }): { decision: "completed" | "back-in-progress"; commit: string; unrun: number[] } {
  return guardedWith({ id, ...o }, ctx, "plan finish", [id, o.complete ? "--complete" : "--back"], ["plan.complete"], "Declaring the final review decision", () => {
    if (!!o.complete === !!o.back) throw new PlanOpError("Give exactly one of --complete or --back <reason>.");
    const { root, rec } = requirePlan(ctx, id);
    const pr = rec.progress!;
    if (rec.archived) throw new PlanOpError(`Plan \`${id}\` is already archived.`);
    if (pr.status !== "in-progress") throw new PlanOpError(`Plan \`${id}\` is ${pr.status}; the final review decides a plan that is in progress.`);
    if (!readStore(ctx.root, `reviews/${id}.json`)) throw new PlanOpError(`Open the final review first: \`specplane plan review ${id}\`.`);
    if (isDirty(root)) throw new PlanOpError("The plan checkout has uncommitted changes; commit them before the decision.");
    const by = actorBy(ctx);
    const unrun = stepNumbers(rec).filter((n) => !pr.done.includes(n));
    if (o.back !== undefined) {
      if (!o.back.trim()) throw new PlanOpError("--back needs a reason.");
      writeProgress(root, rec, { ...pr, final_review: { decision: "back-in-progress", reason: o.back.trim(), by } });
      const commit = commitPaths(ctx, root, [rec.progressFile], { type: "chore", scope: "specplane", summary: `review ${id}`, body: `Final review sent back: ${o.back.trim()}`, workflow: "finish", planId: id });
      removeStore(ctx.root, `reviews/${id}.json`);
      return { decision: "back-in-progress" as const, commit, unrun };
    }
    const dir = plansDir(root);
    writeProgress(root, rec, { ...pr, status: "completed", final_review: { decision: "completed", by } });
    const dest = `${dir}/archive/${id}`;
    if (fs.existsSync(path.join(root, dest))) throw new PlanOpError(`${dest} already exists.`);
    fs.mkdirSync(path.join(root, dir, "archive"), { recursive: true });
    git(root, ["add", "-A", "--", rec.dir]);
    git(root, ["mv", rec.dir, dest]);
    const commit = commitPaths(ctx, root, [rec.dir, dest], { onlyStaged: true, type: "chore", scope: "specplane", summary: `finish ${id}`, workflow: "finish", planId: id });
    clearRun(ctx.root, id);
    return { decision: "completed" as const, commit, unrun };
  });
}

/* ------------------------------------------------------------------ merge */

export interface MergeOpts { mode: "pr" | "local"; force?: boolean }
export interface MergeResult { mode: "pr" | "local"; message: string; merged: boolean; commit?: string }

function removePlanWorktree(ctx: PlanCtx, id: string, force: boolean): void {
  const wt = worktreeOf(ctx.root, id);
  if (!wt) { setWorktree(ctx.root, id, null); return; }
  git(ctx.root, ["worktree", "remove", ...(force ? ["--force"] : []), wt]);
  setWorktree(ctx.root, id, null);
  // The project folder is removed with the last plan checkout.
  try { fs.rmdirSync(path.dirname(wt)); } catch { /* not empty */ }
}

export function mergePlan(ctx: PlanCtx, id: string, o: MergeOpts): MergeResult {
  return guardedWith({ id, ...o }, ctx, "plan merge", [id, o.mode === "pr" ? "--pr" : "--local"], ["plan.complete"], "Merging a plan", () => {
    const branch = `plan/${id}`;
    if (!branchExists(ctx.root, branch)) throw new PlanOpError(`Branch \`${branch}\` does not exist.`);
    const wt = worktreeOf(ctx.root, id);
    const rec = loadPlanAt(wt ?? ctx.root, id) ?? (gitTry(ctx.root, ["rev-parse", "--verify", "--quiet", branch]) ? readFromBranch(ctx.root, branch, id) : null);
    if (!rec || rec.progress?.status !== "completed") throw new PlanOpError(`Plan \`${id}\` is not completed; declare it with \`specplane plan finish ${id} --complete\` first.`);
    const target = rec.progress.target_branch!;
    if (o.mode === "pr") {
      try {
        const out = run("gh", ["pr", "create", "--base", target, "--head", branch, "--title", `Plan ${id}`, "--body", `Completed plan ${id}.`], { cwd: ctx.root });
        return { mode: "pr" as const, merged: false, message: out.trim() };
      } catch (e) {
        return { mode: "pr" as const, merged: false, message: `Could not run \`gh pr create\` (${(e as Error).message.split("\n")[0]}). Push \`${branch}\` and open a pull request into \`${target}\` yourself; nothing was pushed.` };
      }
    }
    if (currentBranch(ctx.root) !== target) throw new PlanOpError(`A local merge runs only in a checkout of the target branch \`${target}\`; this checkout is on ${currentBranch(ctx.root) ?? "no branch"}.`);
    if (isDirty(ctx.root, false)) throw new PlanOpError("This checkout has uncommitted changes; commit or stash them before a local merge.");
    const seen = readStore<{ target_commit: string }>(ctx.root, `reviews/${id}.json`);
    const tip = revParse(ctx.root, `refs/heads/${target}`);
    if (rec.progress.final_review === undefined) throw new PlanOpError("The plan has no recorded final review decision.");
    if (seen && seen.target_commit !== tip) throw new PlanOpError(`\`${target}\` moved after the final review (it was ${seen.target_commit.slice(0, 12)}, now ${tip?.slice(0, 12)}); open the review again with \`specplane plan review ${id}\` first.`);
    if (wt && isDirty(wt) && !o.force) throw new PlanOpError(`The plan worktree ${wt} has uncommitted changes; merging would leave it in place. Commit them, or use --force to discard them.`);
    try {
      git(ctx.root, ["merge", "--no-ff", "-m", `Merge plan ${id}`, branch]);
    } catch (e) {
      const conflicts = (gitTry(ctx.root, ["diff", "--name-only", "--diff-filter=U"]) ?? "").trim().split("\n").filter(Boolean);
      gitTry(ctx.root, ["merge", "--abort"]);
      throw new PlanOpError(`Merge conflict; nothing was merged and the merge was aborted. Conflicting paths:\n${conflicts.map((c) => `  ${c}`).join("\n") || `  (${(e as Error).message.split("\n")[0]})`}\nResolve them yourself; Specplane never resolves conflicts.`);
    }
    const commit = git(ctx.root, ["rev-parse", "HEAD"]).trim();
    removePlanWorktree(ctx, id, !!o.force);
    git(ctx.root, ["branch", "-d", branch]);
    removeStore(ctx.root, `reviews/${id}.json`);
    clearRun(ctx.root, id);
    return { mode: "local" as const, merged: true, commit, message: `Merged ${branch} into ${target}; the worktree and branch were removed.` };
  });
}

function readFromBranch(root: string, branch: string, id: string): PlanRecord | null {
  const dir = plansDir(root);
  const src = committedSource(root, branch);
  return src.exists(`${dir}/archive/${id}`) ? readPlan(src, `${dir}/archive`, id, true) : null;
}

/* ------------------------------------------------------------------ abandon and delete */

export function abandonPlan(ctx: PlanCtx, id: string, o: { force?: boolean } = {}): { commit: string; kept: string | null } {
  return guardedWith({ id, ...o }, ctx, "plan abandon", [id], ["plan.abandon"], "Abandoning a plan", () => {
    const dir = plansDir(ctx.root);
    const rec = loadPlanAt(ctx.root, id);
    if (!rec) throw new PlanOpError(`Plan \`${id}\` not found in ${dir}.`);
    if (rec.archived) throw new PlanOpError(`Plan \`${id}\` is already archived (${rec.progress?.status}).`);
    const status = rec.progress?.status;
    if (status === "completed" || status === "abandoned") throw new PlanOpError(`Plan \`${id}\` is ${status}.`);
    if ((gitTry(ctx.root, ["status", "--porcelain", "--", rec.dir]) ?? "").trim()) throw new PlanOpError(`${rec.dir} has uncommitted changes; commit or stash them first.`);
    const wt = worktreeOf(ctx.root, id);
    if (wt && isDirty(wt) && !o.force) throw new PlanOpError(`The plan worktree ${wt} has uncommitted changes, so it is not removed and nothing was changed. Commit them, or use --force to discard them.`);
    const branch = `plan/${id}`;
    // The run is stopped first; then the plan record is taken from the plan branch.
    clearRun(ctx.root, id);
    if (branchExists(ctx.root, branch) && committedSource(ctx.root, branch).exists(rec.dir)) git(ctx.root, ["checkout", branch, "--", rec.dir]);
    const cur = loadPlanAt(ctx.root, id)!;
    const { stop: _s, ...rest } = cur.progress!;
    writeProgress(ctx.root, cur, { ...rest, status: "abandoned" });
    const dest = `${dir}/archive/${id}`;
    if (fs.existsSync(path.join(ctx.root, dest))) throw new PlanOpError(`${dest} already exists.`);
    fs.mkdirSync(path.join(ctx.root, dir, "archive"), { recursive: true });
    git(ctx.root, ["add", "-A", "--", rec.dir]);
    git(ctx.root, ["mv", rec.dir, dest]);
    const commit = commitPaths(ctx, ctx.root, [rec.dir, dest], { onlyStaged: true, type: "chore", scope: "specplane", summary: `abandon ${id}`, workflow: "abandon", planId: id });
    if (wt) removePlanWorktree(ctx, id, !!o.force);
    removeStore(ctx.root, `reviews/${id}.json`);
    return { commit, kept: branchExists(ctx.root, branch) ? branch : null };
  });
}

export function deletePlan(ctx: PlanCtx, id: string, o: { force?: boolean } = {}): { commit: string } {
  return guardedWith({ id, ...o }, ctx, "plan delete", [id], ["plan.delete"], "Deleting a plan", () => {
    const rec = loadPlanAt(ctx.root, id);
    if (!rec) throw new PlanOpError(`Plan \`${id}\` not found.`);
    if ((gitTry(ctx.root, ["status", "--porcelain", "--", rec.dir]) ?? "").trim()) throw new PlanOpError(`${rec.dir} has uncommitted changes; commit or stash them first.`);
    const wt = worktreeOf(ctx.root, id);
    if (wt && isDirty(wt) && !o.force) throw new PlanOpError(`The plan worktree ${wt} has uncommitted changes, so nothing was changed. Commit them, or use --force to discard them.`);
    clearRun(ctx.root, id);
    git(ctx.root, ["rm", "-r", "-q", "--ignore-unmatch", "--", rec.dir]);
    fs.rmSync(path.join(ctx.root, rec.dir), { recursive: true, force: true });
    const commit = commitPaths(ctx, ctx.root, [rec.dir], { onlyStaged: true, type: "chore", scope: "specplane", summary: `delete ${id}`, workflow: "delete", planId: id });
    if (wt) removePlanWorktree(ctx, id, !!o.force);
    removeStore(ctx.root, `reviews/${id}.json`);
    return { commit };
  });
}
