import { isDeepStrictEqual } from "node:util";
import { PlanStateError, PlanNotFoundError } from "../errors.js";
import { run } from "../git/exec.js";
import type { Config } from "../types.js";
import { resolvePlanContext, validatePlanBranches } from "./context.js";
import { configAt, planAt, samePaths, snapshot } from "./prepare-start.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { listWorktrees } from "../git/worktree.js";
import { lenientFrontmatter, showFile } from "./activity.js";

/** Uncommitted execution bindings never become managed execution context. */
export function refusePendingRetarget(id: string, config: Config, cwd: string): void {
  const tree = listWorktrees(cwd).find(t => !t.bare && t.branch === `plan/${id}`);
  if (!tree) return;
  for (const file of [`${config.plans.dir}/${id}/PLAN.md`, `${config.plans.dir}/archive/${id}/PLAN.md`]) {
    const committed = showFile('HEAD', file, tree.path);
    if (committed === null) continue;
    const before = lenientFrontmatter(committed);
    let working: string;
    try { working = fs.readFileSync(path.join(tree.path, file), 'utf8'); } catch { throw new PlanStateError('Plan recording is missing; commit or discard pending edits.'); }
    const staged = showFile('', file, tree.path);
    for (const text of [working, staged]) {
      const data = text === null ? null : lenientFrontmatter(text);
      if (!before || !data || !isDeepStrictEqual(before.execution, data.execution) || before.target_branch !== data.target_branch)
        throw new PlanStateError('Pending retarget metadata must be committed or discarded before managed execution.');
    }
  }
}

function ref(cwd: string, name: string): string | null {
  try { return run("git", ["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd }).trim(); } catch { return null; }
}
export function lifecycleContext(id: string, discovery: Config, cwd: string, operation: "finish" | "restack" = "finish") {
  refusePendingRetarget(id, discovery, cwd);
  const refs: Record<string, string | null> = {};
  const capture = (name: string) => refs[name] = ref(cwd, name);
  const local = capture(`refs/heads/plan/${id}`), remote = capture(`refs/remotes/origin/plan/${id}`);
  const branches = { local: snapshot(cwd, local, id, discovery), remote: snapshot(cwd, remote, id, discovery) };
  const selected = validatePlanBranches(cwd, id, branches);
  if (!selected) throw new PlanNotFoundError(id);
  if (!local || selected.commit !== local) throw new PlanStateError("Local plan branch is stale or unavailable; reconcile it before mutation.");
  const context = resolvePlanContext(cwd, { id, planBranches: branches });
  capture(`refs/heads/${context.targetBranch}`); capture(`refs/remotes/origin/${context.targetBranch}`);
  const verified = resolvePlanContext(cwd, { id, explicit: context.targetBranch });
  if (verified.targetCommit !== context.targetCommit || ![refs[`refs/heads/${context.targetBranch}`], refs[`refs/remotes/origin/${context.targetBranch}`]].includes(context.targetCommit)) throw new PlanStateError("Target refs changed during preparation; retry.");
  const config = configAt(cwd, context.targetCommit);
  if (!samePaths(discovery, config)) throw new PlanStateError("Conflicting target configuration path interpretation.");
  const target = planAt(cwd, context.targetCommit, config, id);
  const plan = planAt(cwd, selected.commit, config, id);
  if (!target || !plan) throw new PlanNotFoundError(id);
  if (target.target_branch && target.target_branch !== context.targetBranch || plan.target_branch && plan.target_branch !== context.targetBranch ||
      target.comparison_base !== plan.comparison_base || target.execution && !isDeepStrictEqual(target.execution, plan.execution))
    throw new PlanStateError("Conflicting target and plan execution provenance.");
  const allowed = config.plans.status_source === "git" ? ["ready"] : ["in_progress", "review"];
  const targetAllowed = [...allowed, ...(operation === "finish" ? ["done"] : [])];
  const planAllowed = [...allowed, ...(operation === "finish" ? ["done"] : [])];
  if (!targetAllowed.includes(target.status) || !planAllowed.includes(plan.status)) throw new PlanStateError(`Cannot ${operation}: target status ${target.status}, plan status ${plan.status} is not executable for ${config.plans.status_source} mode.`);
  return { context, refs, config, plan, target };
}
export function checkStackTarget(id: string, expected: string, config: Config, cwd: string, refs: Record<string, string | null>): string {
  const l = `refs/heads/plan/${id}`, r = `refs/remotes/origin/plan/${id}`;
  refs[l] = ref(cwd, l); refs[r] = ref(cwd, r);
  const selected = validatePlanBranches(cwd, id, { local: snapshot(cwd, refs[l], id, config), remote: snapshot(cwd, refs[r], id, config) });
  if (!selected?.binding || selected.binding.target_branch !== expected) throw new PlanStateError(`Stack dependency ${id} lacks compatible recorded target.`);
  return selected.commit;
}
export function recheckLifecycleRefs(cwd: string, refs: Record<string, string | null>): void {
  for (const [name, value] of Object.entries(refs)) if (ref(cwd, name) !== value) throw new PlanStateError(`Ref ${name} changed during operation; retry.`);
}
