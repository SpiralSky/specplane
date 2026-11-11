import { checkRequirementIds } from "../../spec/requirements.js";
import { collector, type Rule } from "./types.js";

/** Requirement files and IDs (`architecture/reference-cli` §4.4). */
export const rules: Rule[] = [{
  id: "requirements",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    const req = ctx.wt.requirements;
    for (const p of req.problems) emit("error", "requirements", p.message, p.file);
    for (const u of req.unlisted) emit("warning", "requirements", `${u} is not listed in the central requirements file`, `${ctx.paths.requirements}/${u}`);
    for (const p of checkRequirementIds(req.files, req.central)) emit("error", "requirements", p.message, p.file, p.line);
    return items;
  },
}];
