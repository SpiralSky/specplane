import { notesSyncWarnings } from "../../spec/sync.js";
import { collector, type Rule } from "./types.js";

/** The notes store: unreadable records and a local ref behind the remote (`architecture/reference-cli` §5.5, §5.6). Runs after `status`, which reads the store. */
export const rules: Rule[] = [{
  id: "notes",
  severity: "warning",
  source: "committed",
  run(ctx) {
    const { emit, items } = collector();
    if (!ctx.status) return items;
    for (const w of ctx.status.notes.notes.warnings) emit("warning", "notes", w, ".");
    for (const w of notesSyncWarnings(ctx.root)) emit("warning", "notes", w, ".");
    return items;
  },
}];
