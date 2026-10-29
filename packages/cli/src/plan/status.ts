import type { Config, PlanFrontmatter, PlanStatus } from "../types.js";

/** Index status: stored status, except `ready` with an unmet dependency becomes `blocked`. */
export type IndexStatus = PlanStatus | "blocked";

/** `architecture/reference-cli` § Plan status. Reads committed files only. */
export function getIndexStatus(
  plan: Pick<PlanFrontmatter, "status" | "depends_on">,
  plansById: Map<string, Pick<PlanFrontmatter, "status">>,
  config: Config,
): IndexStatus {
  if (plan.status !== "ready") return plan.status;
  if (config.plans.dependency_mode === "wait_for_merge") {
    for (const dep of plan.depends_on ?? []) {
      if (plansById.get(dep)?.status !== "done") return "blocked";
    }
  }
  return "ready";
}

/** Effective status: the index status, plus the git-derived `in_progress` and `review`. */
export type EffectiveStatus = IndexStatus;

/** Git and forge queries behind the effective status; all optional lookups are read-only. */
export interface StatusGit {
  /** True when `plan/<id>` exists locally or as `refs/remotes/origin/plan/<id>`. */
  branchExists(planId: string): boolean;
  /**
   * Forge extension point: true when the forge reports an open PR for `plan/<id>`.
   * Not provided yet (the forge client comes with the plan-flows plan); without it,
   * `review` is never derived and a started plan is `in_progress`.
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
