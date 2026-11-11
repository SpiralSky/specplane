import { computeStatus } from "../../spec/status.js";
import { collector, type Rule } from "./types.js";

/** Effective status, outdated specs and results, read from committed content (`architecture/reference-cli` §5.2). */
export const rules: Rule[] = [{
  id: "status",
  severity: "warning",
  source: "committed",
  run(ctx) {
    const { emit, items } = collector();
    if (!ctx.head || !ctx.status) { emit("note", "status", "the repository has no commits; effective status is not computed", "."); return items; }
    for (const doc of ctx.head.specs.values()) {
      if (ctx.wanted && !ctx.wanted.has(doc.id)) continue;
      if (!doc.fm.data && !(doc.layer === "requirement" && doc.fm.missing)) continue;
      const st = computeStatus(ctx.head, doc, ctx.status, ctx.wt.source.read(doc.file));
      ctx.statuses.push({ id: doc.id, stored: null, effective: st.status, reasons: st.reasons });
      for (const w of st.warnings) emit("warning", "status", w, doc.file, 1);
      for (const n of st.notes) emit("note", "status", n, doc.file);
    }
    return items;
  },
}];
