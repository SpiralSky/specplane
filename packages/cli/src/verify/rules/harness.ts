import { inspectInstallation } from "../../harness/install.js";
import { collector, type Rule } from "./types.js";

/** Installed harness files: missing, older than the CLI, steering stamp mismatch, marker problems (`architecture/reference-cli` §12.6). */
export const rules: Rule[] = [{
  id: "harness",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    for (const f of inspectInstallation(ctx.root)) emit(f.severity, "harness", f.message, f.file);
    return items;
  },
}];
