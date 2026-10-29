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
