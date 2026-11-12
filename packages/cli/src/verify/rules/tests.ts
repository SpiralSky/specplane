import { allSpecs } from "../../spec/project.js";
import { loadSettings } from "../../config.js";
import { GIT_LOG_WARNING } from "../logs.js";
import { declarations, allTests } from "../tests.js";
import { collector, type Rule } from "./types.js";

/**
 * Test declarations (`architecture/reference-cli` §10.1, `architecture/file-formats` §11.2): a duplicate label in a
 * section and an invalid `specplane-test` block are errors; a block on an intelligent test and `tests.logs: git` are warnings.
 */
export const rules: Rule[] = [{
  id: "tests",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    for (const doc of allSpecs(ctx.wt)) {
      if (doc.layer === "requirement") continue;
      for (const d of doc.index.duplicateTests) {
        emit("error", "tests", `test label ${d.label} is declared twice in ${d.sectionId ?? "the preamble"} (first at line ${d.first}); its tests are not run`, doc.file, d.second, d.sectionId ?? undefined);
      }
      for (const t of allTests(declarations(doc))) {
        if (t.blockError) emit("error", "tests", `${t.id}: ${t.blockError}`, doc.file, t.blockLine, t.sectionId ?? undefined);
        else if (t.kind === "intelligent" && t.blockLine !== undefined) emit("warning", "tests", `${t.id} is intelligent; the CLI never runs it, so its specplane-test block is ignored`, doc.file, t.blockLine, t.sectionId ?? undefined);
      }
    }
    try {
      if (loadSettings(ctx.root).config.values["tests.logs"] === "git") emit("warning", "tests", GIT_LOG_WARNING, ".specplane/config.yaml");
    } catch { /* an unreadable configuration is reported by the config family */ }
    return items;
  },
}];
