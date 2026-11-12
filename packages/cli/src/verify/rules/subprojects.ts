import type { Project } from "../../spec/project.js";
import { collector, type Emit, type Rule } from "./types.js";

/** Subproject rules (`feature/later-releases` R39.3, R39.4; `architecture/file-formats` §12.4). */

const normalize = (text: string): string => text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();

/**
 * R39.4: the root project's requirements outrank a subproject's. A contradiction is a judgement, so the rule
 * flags the case it can see: a subproject requirement with the title of a root requirement but a different text.
 */
export function checkPrecedence(root: Project, sub: Project, emit: Emit): void {
  const byTitle = new Map<string, { id: string; text: string }>();
  for (const f of root.requirements.files) for (const r of f.requirements) byTitle.set(r.title.trim().toLowerCase(), { id: r.id, text: normalize(r.text) });
  for (const f of sub.requirements.files) {
    for (const r of f.requirements) {
      const same = byTitle.get(r.title.trim().toLowerCase());
      if (same && same.text !== normalize(r.text)) {
        emit("warning", "subprojects", `${r.id} "${r.title}" has the title of root requirement ${same.id} with a different text; the root requirement wins (R39.4), so resolve the difference`, f.file, r.startLine);
      }
    }
  }
}

export const rules: Rule[] = [{
  id: "subprojects",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    for (const p of ctx.wt.subprojectProblems) emit("error", "subprojects", p.message, p.dir);
    for (const sub of ctx.wt.subprojects.values()) checkPrecedence(ctx.wt, sub, (sev, rule, m, f, l, s) => {
      emit(sev, rule, m, f, l, s);
      items[items.length - 1].project = sub.name;
    });
    return items;
  },
}];
