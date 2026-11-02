import { isDeepStrictEqual } from "node:util";
import { PlanStateError, PlanNotFoundError } from "../errors.js";
import { run } from "../git/exec.js";
import type { Config } from "../types.js";
import { resolvePlanContext, validatePlanBranches } from "./context.js";
import { configAt, planAt, samePaths, snapshot } from "./prepare-start.js";

function ref(cwd: string, name: string): string | null {
  try { return run("git", ["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd }).trim(); } catch { return null; }
}
export function lifecycleContext(id: string, discovery: Config, cwd: string) {
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
  if (["shelved", "abandoned"].includes(target.status)) throw new PlanStateError(`Cannot execute plan: target record is ${target.status}.`);
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
