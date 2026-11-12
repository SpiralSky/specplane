import { decisionsEnabled, readRecords } from "../../decisions/decisions.js";
import { findDoc, resolveRaw } from "../../spec/project.js";
import { collector, type Rule } from "./types.js";

/**
 * Decision records (`feature/later-releases` R37; `architecture/file-formats` §14), checked only while
 * `decisions.enabled` is on: a record that breaks the format is an error, a `concerns` entry that names nothing is a
 * warning (the spec or plan may have been removed since). A project without records reports nothing (`specifications R68`).
 */
export const rules: Rule[] = [{
  id: "decisions",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    if (!decisionsEnabled(ctx.root)) return items;
    const { records, problems } = readRecords(ctx.root);
    for (const p of problems) emit("error", "decisions", `decision record ${p.id}: ${p.reasons.join("; ")}`, p.file);
    for (const r of records) {
      for (const c of r.concerns) {
        const hit = findDoc(ctx.wt, c) !== undefined || resolveRaw(ctx.wt, c)?.resolution.ok === true;
        if (!hit) emit("warning", "decisions", `decision record ${r.id} concerns \`${c}\`, which does not exist`, r.file);
      }
    }
    return items;
  },
}];
