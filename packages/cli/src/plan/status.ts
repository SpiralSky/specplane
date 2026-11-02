import type { Config, PlanFrontmatter, PlanStatus } from "../types.js";

/** Index status: stored status, except `ready` with an unmet dependency becomes `blocked`. */
export type IndexStatus = PlanStatus | "blocked";

/** Dependencies of a `ready` plan that are not `done`, in `depends_on` order. */
function unmergedDependencies(
  plan: Pick<PlanFrontmatter, "depends_on">,
  plansById: Map<string, Pick<PlanFrontmatter, "status">>,
): string[] {
  return (plan.depends_on ?? []).filter((dep) => plansById.get(dep)?.status !== "done");
}

/** `architecture/reference-cli` § Plan status. Reads committed files only. */
export function getIndexStatus(
  plan: Pick<PlanFrontmatter, "status" | "depends_on">,
  plansById: Map<string, Pick<PlanFrontmatter, "status">>,
  config: Config,
): IndexStatus {
  if (plan.status !== "ready") return plan.status;
  const unmerged = unmergedDependencies(plan, plansById);
  if (config.plans.dependency_mode === "wait_for_merge") {
    return unmerged.length > 0 ? "blocked" : "ready";
  }
  if ((plan.depends_on ?? []).some(dep => plansById.get(dep)?.status === "shelved")) return "blocked";
  // Stack mode: a plan can stack on one unmerged dependency, but not two (`feature/plan-status`).
  return unmerged.length > 1 ? "blocked" : "ready";
}

/** Text shown with a `blocked` index status (`architecture/reference-cli` § Plan status). */
export function blockedReason(
  plan: Pick<PlanFrontmatter, "depends_on">,
  plansById: Map<string, Pick<PlanFrontmatter, "status">>,
  config: Config,
): string | null {
  if (config.plans.dependency_mode !== "stack") return null;
  const shelved = (plan.depends_on ?? []).find(dep => plansById.get(dep)?.status === "shelved");
  if (shelved) return `Cannot stack on shelved dependency: ${shelved}; resume it first.`;
  const unmerged = unmergedDependencies(plan, plansById);
  if (unmerged.length <= 1) return null;
  return `Cannot stack on more than one unmerged dependency: ${unmerged.map((u) => `\`${u}\``).join(", ")}.`;
}

/** Effective status: the index status, plus the git-derived `in_progress` and `review`. */
export type EffectiveStatus = IndexStatus;

/** Git and forge queries behind the effective status; all optional lookups are read-only. */
export interface StatusGit {
  /** True when `plan/<id>` exists locally or as `refs/remotes/origin/plan/<id>`. */
  branchExists(planId: string): boolean;
  /**
   * True when the forge reports an open PR for `plan/<id>`. Absent when no forge is
   * configured; then `review` is never derived and a started plan is `in_progress`.
   */
  hasOpenPr?(planId: string): boolean;
}

/** `architecture/reference-cli` § Plan status. Never written to files. */
export function getEffectiveStatus(
  plan: Pick<PlanFrontmatter, "id" | "status" | "depends_on">,
  plansById: Map<string, Pick<PlanFrontmatter, "status">>,
  config: Config,
  git: StatusGit,
): EffectiveStatus {
  const index = getIndexStatus(plan, plansById, config);
  if (index !== "ready") return index;
  if (config.plans.status_source === "frontmatter") return "ready";
  if (git.branchExists(plan.id)) return git.hasOpenPr?.(plan.id) ? "review" : "in_progress";
  return "ready";
}
