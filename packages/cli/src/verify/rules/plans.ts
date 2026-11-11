import { loadPlans } from "../../plan/model.js";
import { validatePlanRecords } from "../../plan/validate.js";
import { collector, type Rule } from "./types.js";

/** Plan records (`architecture/reference-cli` §11.1). A project without plans reports nothing (`plans R69`). */
export const rules: Rule[] = [{
  id: "plans",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    validatePlanRecords(loadPlans(ctx.wt.source, ctx.paths.plansDir), ctx.wt, ctx.root, (sev, rule, m, f, l) => emit(sev, rule, m, f, l), ctx.wanted);
    return items;
  },
}];
