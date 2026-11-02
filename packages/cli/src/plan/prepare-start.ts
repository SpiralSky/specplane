import { isDeepStrictEqual } from "node:util";
import { parseConfigText, CONFIG_PATH } from "../config.js";
import { AmbiguousIdError, PlanNotFoundError, PlanStateError, SpecNotFoundError, UnknownRootError } from "../errors.js";
import { run } from "../git/exec.js";
import { readTrailers } from "../git/commit.js";
import { claimFrontmatter } from "./start-frontmatter.js";
import { ID_PATTERN, PLAN_SCHEMA, SPEC_COMMON_SCHEMA, SPEC_FEATURE_SCHEMA, SPEC_ARCHITECTURE_SCHEMA, validator } from "../schemas.js";
import { TYPE_DIRS } from "../spec/resolve.js";
import type { Config, PlanFrontmatter } from "../types.js";
import { lenientFrontmatter, showFile } from "./activity.js";
import { resolveCommit, resolvePlanContext, validatePlanBranches, type PlanBranchSnapshot, type TargetContext } from "./context.js";

export interface PreparedStart {
  context: TargetContext; config: Config; plan: PlanFrontmatter; first: boolean;
  /** Recheck all refs under leases before any mutation. */
  refs: Record<string, string | null>; base: string; stackId: string | null; recoveryClaim?: string;
}
function fail(reason: string): never { throw new PlanStateError(reason); }
function ref(cwd: string, name: string): string | null {
  try { return run("git", ["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd }).trim(); } catch { return null; }
}
function configAt(cwd: string, commit: string): Config {
  return parseConfigText(showFile(commit, CONFIG_PATH, cwd), cwd, { checkSpecRoots: false }).config;
}
function samePaths(a: Config, b: Config): boolean {
  return a.plans.dir === b.plans.dir && isDeepStrictEqual(a.spec_roots, b.spec_roots);
}
function planAt(cwd: string, commit: string, config: Config, id: string): PlanFrontmatter | null {
  const paths = [`${config.plans.dir}/${id}/PLAN.md`, `${config.plans.dir}/archive/${id}/PLAN.md`];
  const found = paths.map(p => showFile(commit, p, cwd)).filter((v): v is string => v !== null);
  if (found.length > 1) fail(`Multiple records for plan ${id}.`);
  if (!found.length) return null;
  const data = lenientFrontmatter(found[0]);
  if (!data || !validator(PLAN_SCHEMA)(data) || data.id !== id) fail(`Invalid plan record for ${id} at ${commit}.`);
  return data as unknown as PlanFrontmatter;
}
function specAt(cwd: string, commit: string, config: Config, raw: string): { id: string; text: string } {
  let id = raw.split("#")[0]; let roots = config.spec_roots;
  const colon = id.indexOf(":");
  if (colon !== -1) { const name = id.slice(0, colon); id = id.slice(colon + 1); roots = roots.filter(r => r.name === name); if (!roots.length) throw new UnknownRootError(name); }
  if (!new RegExp(ID_PATTERN).test(id)) throw new SpecNotFoundError(id);
  const [type, ...rest] = id.split("/");
  const hits = roots.map(r => ({ root: r.name, text: showFile(commit, `${r.path}/${TYPE_DIRS[type]}/${rest.join("/")}.md`, cwd) })).filter(h => h.text !== null);
  if (!hits.length) throw new SpecNotFoundError(id);
  if (hits.length > 1) throw new AmbiguousIdError(id, hits.map(h => h.root));
  return { id, text: hits[0].text! };
}
function snapshot(cwd: string, commit: string | null, id: string, discovery: Config): PlanBranchSnapshot | undefined {
  if (!commit) return undefined;
  const config = configAt(cwd, commit);
  if (!samePaths(discovery, config)) fail("Conflicting plan or specification path interpretation in plan branch.");
  const plan = planAt(cwd, commit, config, id);
  if (!plan) fail(`Plan branch has no record for ${id}.`);
  return { id, commit, binding: plan.execution, comparisonBase: plan.comparison_base };
}
/** Recognize only a complete, metadata-only claim at the selected target tip. */
function recoverableClaim(cwd: string, commit: string, file: string, id: string): boolean {
  try {
    const parents = run("git", ["rev-list", "--parents", "-n", "1", commit], { cwd }).trim().split(" ");
    const trailers = readTrailers(commit, cwd);
    if (parents.length !== 2 || trailers.get("Specplane-Workflow")?.join() !== "claim" || trailers.get("Specplane-Plan")?.join() !== id || run("git", ["log", "-1", "--format=%s", commit], { cwd }).trim() !== `chore(specplane): claim ${id} in_progress`) return false;
    if (run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", commit], { cwd }).trim() !== file) return false;
    const mode = (tree: string) => run("git", ["ls-tree", tree, "--", file], { cwd }).split(" ")[0];
    if (mode(parents[1]) !== mode(commit)) return false;
    const before = showFile(parents[1], file, cwd), after = showFile(commit, file, cwd);
    if (before === null || after === null) return false;
    if (lenientFrontmatter(before)?.status !== "ready") return false;
    const expected = claimFrontmatter(before);
    return expected === after && expected !== before;
  } catch { return false; }
}
/** Evidence must be supplied by a trusted caller after independently verifying a
 * historical repository-default record. `record` identifies that external record;
 * neither current config nor branch-creation reflogs establish the old default. */
export interface LegacyDefaultEvidence {
  originalDefault: string;
  record: string;
}
/** Read-only preparation: no fetch, lease, checkout or persistent mutation. */
export function prepareStart(id: string, discovery: Config, cwd: string, options: { target?: string; freshness?: "fetched" | "local"; legacyEvidence?: LegacyDefaultEvidence } = {}): PreparedStart {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail("Invalid plan ID.");
  const refs: Record<string, string | null> = {};
  const capture = (name: string) => refs[name] = ref(cwd, name);
  const local = capture(`refs/heads/plan/${id}`), remote = capture(`refs/remotes/origin/plan/${id}`);
  const branches = { local: snapshot(cwd, local, id, discovery), remote: snapshot(cwd, remote, id, discovery) };
  const selected = validatePlanBranches(cwd, id, branches);
  const evidence = selected && !selected.binding && typeof options.legacyEvidence?.record === "string" && options.legacyEvidence.record.trim() ? options.legacyEvidence : undefined;
  const head = ref(cwd, "HEAD");
  if (!head) fail("Invoking checkout has no committed HEAD.");
  const hint = !selected && !options.target ? planAt(cwd, head, discovery, id) : null;
  const context = resolvePlanContext(cwd, { id, explicit: options.target, declared: selected ? undefined : hint?.target_branch,
    team: discovery.plans.target_branch, planBranches: branches, freshness: options.freshness,
    legacy: selected && !selected.binding ? { originalDefault: evidence?.originalDefault } : undefined });
  capture(`refs/heads/${context.targetBranch}`); capture(`refs/remotes/origin/${context.targetBranch}`);
  const verify = resolvePlanContext(cwd, { id, explicit: context.targetBranch, freshness: options.freshness });
  if (verify.targetCommit !== context.targetCommit || ![refs[`refs/heads/${context.targetBranch}`], refs[`refs/remotes/origin/${context.targetBranch}`]].includes(context.targetCommit)) fail("Target refs changed during preparation; retry.");
  const config = configAt(cwd, context.targetCommit);
  if (!samePaths(discovery, config)) fail("Conflicting target configuration path interpretation.");
  if (!selected && !options.target && !hint?.target_branch && discovery.plans.target_branch !== config.plans.target_branch) fail("Conflicting target routing configuration.");
  const plan = planAt(cwd, context.targetCommit, config, id);
  if (!plan) throw new PlanNotFoundError(id);
  if (plan.target_branch && plan.target_branch !== context.targetBranch) fail("Target plan declaration conflicts with selected target.");
  if (selected) {
    const branchPlan = planAt(cwd, selected.commit, config, id)!;
    if (plan.comparison_base !== branchPlan.comparison_base) fail("Target and plan branch comparison provenance conflict.");
    if (plan.execution !== undefined && !isDeepStrictEqual(plan.execution, branchPlan.execution)) fail("Target and plan branch execution binding conflict.");
    if (branchPlan.target_branch && branchPlan.target_branch !== context.targetBranch) fail("Plan branch declaration conflicts with execution target.");
    const resumable = config.plans.status_source === "git" ? ["ready"] : ["ready", "in_progress", "review"];
    if (!resumable.includes(plan.status) || !resumable.includes(branchPlan.status)) fail("Cannot resume plan with invalid stored status for its status source.");
    return { context, config, plan, first: false, refs, base: selected.commit, stackId: null };
  }
  if (plan.execution) fail("Target contains an orphaned execution binding; recovery is required.");
  const recoveryClaim = config.plans.status_source === "frontmatter" && plan.status === "in_progress" && recoverableClaim(cwd, context.targetCommit, `${config.plans.dir}/${id}/PLAN.md`, id) ? context.targetCommit : undefined;
  if (plan.status !== "ready" && !recoveryClaim) fail(`Cannot start plan: \`${id}\` is \`${plan.status}\`, not \`ready\`.`);
  if (plan.comparison_base) context.comparisonBase = resolveCommit(cwd, plan.comparison_base, true);
  const unmerged = (plan.depends_on ?? []).filter(dep => planAt(cwd, context.targetCommit, config, dep)?.status !== "done");
  let base = context.targetCommit; let stackId: string | null = null;
  if (unmerged.length && config.plans.dependency_mode === "wait_for_merge") fail(`Cannot start plan: dependency \`${unmerged[0]}\` is not done.`);
  if (unmerged.length > 1) fail(`Cannot stack on more than one unmerged dependency: ${unmerged.join(", ")}.`);
  if (unmerged.length) {
    stackId = unmerged[0]; const dependency = planAt(cwd, context.targetCommit, config, stackId);
    if (!dependency || !["ready", "in_progress", "review"].includes(dependency.status)) fail(`Cannot stack on dependency ${stackId}.`);
    const dl = capture(`refs/heads/plan/${stackId}`), dr = capture(`refs/remotes/origin/plan/${stackId}`);
    const ds = validatePlanBranches(cwd, stackId, { local: snapshot(cwd, dl, stackId, config), remote: snapshot(cwd, dr, stackId, config) });
    if (!ds?.binding || ds.binding.target_branch !== context.targetBranch) fail(`Stack dependency ${stackId} lacks compatible recorded target.`);
    base = ds.commit;
    if (!samePaths(config, configAt(cwd, base))) fail("Conflicting stack configuration path interpretation.");
    const prospective = planAt(cwd, base, config, id);
    if (!prospective || !isDeepStrictEqual(prospective, recoveryClaim ? { ...plan, status: "ready" } : plan)) fail("Stack tree does not contain the authoritative ready plan.");
  }
  for (const raw of plan.specs) {
    const spec = specAt(cwd, context.targetCommit, config, raw);
    const required = config.plans.require_approved_specs === "feature_and_architecture" || (config.plans.require_approved_specs === "feature" && spec.id.startsWith("feature/"));
    if (!required) continue;
    const data = lenientFrontmatter(spec.text);
    const specific = spec.id.startsWith("feature/") ? SPEC_FEATURE_SCHEMA : SPEC_ARCHITECTURE_SCHEMA;
    if (!data || data.id !== spec.id || !validator(SPEC_COMMON_SCHEMA)(data) || !validator(specific)(data) ||
        (data.allow_architecture === true && (typeof data.architecture_reason !== "string" || !data.architecture_reason.trim()))) {
      fail(`Invalid required specification record: ${spec.id}.`);
    }
    if (data.status !== "approved") fail(`Cannot start plan: \`${spec.id}\` is not approved.`);
    if (base !== context.targetCommit && specAt(cwd, base, config, raw).text !== spec.text) fail(`Stack tree has a different required specification revision: ${spec.id}.`);
  }
  return { context, config, plan, first: true, refs, base, stackId, recoveryClaim };
}
