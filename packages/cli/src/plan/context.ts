import { isDeepStrictEqual } from "node:util";
import { PlanStateError } from "../errors.js";
import { run } from "../git/exec.js";
import { PLAN_SCHEMA, validator } from "../schemas.js";
import type { ExecutionBinding } from "../types.js";

/** Inputs must come from committed records; callers must recheck refs before mutation. */
export interface TargetInputs {
  id: string;
  explicit?: string;
  declared?: string;
  team?: string;
  comparisonBase?: string;
  binding?: ExecutionBinding;
  previousBinding?: ExecutionBinding;
  /** Independent evidence identifying the historical default, if this is a legacy start. */
  legacy?: { originalDefault?: string };
  freshness?: "fetched" | "local";
  planBranches?: { local?: PlanBranchSnapshot; remote?: PlanBranchSnapshot };
}
/** The caller reads each snapshot from its corresponding captured plan-branch commit. */
export interface PlanBranchSnapshot {
  commit: string;
  id: string;
  binding?: ExecutionBinding;
  comparisonBase?: string;
}
export interface TargetContext {
  targetBranch: string;
  targetCommit: string;
  comparisonBase: string | null;
  binding: ExecutionBinding | null;
  legacy: boolean;
  freshness: "fetched" | "local";
}
function fail(message: string): never { throw new PlanStateError(message); }
function optionalGit(cwd: string, args: string[]): string | null {
  try { return run("git", args, { cwd }).trim(); } catch { return null; }
}
export function validateTargetBranch(cwd: string, name: string, id?: string): void {
  if (typeof name !== "string" || !name || name.startsWith("-") ||
      optionalGit(cwd, ["check-ref-format", "--branch", name]) !== name || name === `plan/${id}`) {
    fail(`Invalid integration target branch: ${String(name)}.`);
  }
}
/** Resolve creation input to a commit; stored values must be canonical full IDs. */
export function resolveCommit(cwd: string, value: string, stored = false): string {
  if (typeof value !== "string" || !value || value.startsWith("-")) fail("Invalid commit input.");
  const commit = optionalGit(cwd, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`]);
  if (!commit || (stored && commit !== value)) fail(`Invalid ${stored ? "stored " : ""}commit: ${value}.`);
  return commit;
}
function defaultTarget(cwd: string): string {
  const symbolic = optionalGit(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (symbolic) {
    if (!symbolic.startsWith("refs/remotes/origin/")) fail("Invalid repository default branch.");
    return symbolic.slice("refs/remotes/origin/".length);
  }
  for (const branch of ["main", "master"]) {
    if (optionalGit(cwd, ["show-ref", "--verify", "--hash", `refs/heads/${branch}`])) return branch;
  }
  return fail("Repository default branch is unavailable.");
}
function targetTip(cwd: string, branch: string): string {
  const local = optionalGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
  const remote = optionalGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`]);
  if (!local && !remote) return fail(`Integration target ${branch} is unavailable.`);
  if (!local) return remote!;
  if (!remote || local === remote) return local;
  if (optionalGit(cwd, ["merge-base", "--is-ancestor", local, remote]) !== null) return remote;
  if (optionalGit(cwd, ["merge-base", "--is-ancestor", remote, local]) !== null) return local;
  return fail(`Integration target ${branch} has divergent local and origin refs.`);
}
export function validateExecutionBinding(cwd: string, id: string, binding: ExecutionBinding, declared?: string, previous?: ExecutionBinding): void {
  if (!validator(PLAN_SCHEMA.properties.execution)(binding)) fail("Malformed execution binding.");
  validateTargetBranch(cwd, binding.target_branch, id);
  validateTargetBranch(cwd, binding.start_target_branch, id);
  resolveCommit(cwd, binding.start_base, true);
  let current = binding.start_target_branch;
  for (const change of binding.target_changes ?? []) {
    validateTargetBranch(cwd, change.from, id);
    validateTargetBranch(cwd, change.to, id);
    if (change.from !== current || change.from === change.to) fail("Inconsistent execution target-change chain.");
    current = change.to;
  }
  if (current !== binding.target_branch || (declared !== undefined && declared !== current)) fail("Inconsistent execution target declaration or chain.");
  if (previous) {
    validateExecutionBinding(cwd, id, previous);
    if (previous.start_base !== binding.start_base || previous.start_target_branch !== binding.start_target_branch) fail("Original execution provenance changed.");
    const oldChanges = previous.target_changes ?? [];
    const changes = binding.target_changes ?? [];
    if (oldChanges.length > changes.length || oldChanges.some((c, i) => c.from !== changes[i].from || c.to !== changes[i].to)) fail("Execution target history changed.");
  }
}
/** Refuse divergent histories, identities, or rewritten immutable metadata. */
export function validatePlanBranches(cwd: string, id: string, branches: NonNullable<TargetInputs["planBranches"]>): PlanBranchSnapshot | undefined {
  const { local, remote } = branches;
  for (const branch of [local, remote]) {
    if (!branch) continue;
    resolveCommit(cwd, branch.commit, true);
    if (branch.id !== id) fail("Conflicting plan branch identity.");
    if (branch.comparisonBase !== undefined) resolveCommit(cwd, branch.comparisonBase, true);
    if (branch.binding) validateExecutionBinding(cwd, id, branch.binding);
  }
  if (!local || !remote) return local ?? remote;
  const localFirst = optionalGit(cwd, ["merge-base", "--is-ancestor", local.commit, remote.commit]) !== null;
  const remoteFirst = optionalGit(cwd, ["merge-base", "--is-ancestor", remote.commit, local.commit]) !== null;
  if (!localFirst && !remoteFirst) fail("Divergent plan branches.");
  const [older, newer] = localFirst ? [local, remote] : [remote, local];
  if (older.comparisonBase !== newer.comparisonBase) fail("Plan comparison provenance changed.");
  if (older.binding && !newer.binding) fail("Execution binding was removed.");
  if (older.binding && newer.binding) validateExecutionBinding(cwd, id, newer.binding, undefined, older.binding);
  if (local.commit === remote.commit && !isDeepStrictEqual(local, remote)) fail("Conflicting plan branch records.");
  return newer;
}
/** Resolve captured context without fetching, writing, or guessing missing legacy provenance. */
export function resolvePlanContext(cwd: string, input: TargetInputs): TargetContext {
  const { id, explicit, declared, team, binding, previousBinding, legacy } = input;
  if (input.planBranches) {
    const selected = validatePlanBranches(cwd, id, input.planBranches);
    if (selected && (!isDeepStrictEqual(selected.binding, binding) || selected.comparisonBase !== input.comparisonBase)) {
      fail("Selected execution context conflicts with plan branch record.");
    }
  }
  for (const name of [explicit, declared, team]) if (name !== undefined) validateTargetBranch(cwd, name, id);
  if (binding && legacy) fail("Execution binding and legacy context conflict.");
  let target: string;
  if (binding) {
    validateExecutionBinding(cwd, id, binding, declared, previousBinding);
    target = binding.target_branch;
    if (explicit !== undefined && explicit !== target) fail("Explicit target conflicts with execution binding.");
  } else if (legacy) {
    const currentDefault = defaultTarget(cwd);
    if (!legacy.originalDefault || legacy.originalDefault !== currentDefault) fail("Legacy target history is ambiguous or repository default changed; recovery is required.");
    target = currentDefault;
    if ((explicit !== undefined && explicit !== target) || (declared !== undefined && declared !== target)) fail("Legacy target conflicts with declaration or explicit target.");
  } else {
    target = explicit ?? declared ?? team ?? defaultTarget(cwd);
    if (declared !== undefined && declared !== target) fail("Explicit target conflicts with plan declaration.");
  }
  validateTargetBranch(cwd, target, id);
  return { targetBranch: target, targetCommit: targetTip(cwd, target),
    comparisonBase: input.comparisonBase === undefined ? null : resolveCommit(cwd, input.comparisonBase, true),
    binding: binding ?? null, legacy: Boolean(legacy), freshness: input.freshness ?? "local" };
}
