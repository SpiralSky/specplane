import { loadSettings } from "../../config.js";
import { HOOK_SETTINGS, hookSectionPresent } from "../../git/hooks.js";
import { collector, type Rule } from "./types.js";

/** A `pre_commit.*` setting that is on while its hook section is missing (`architecture/reference-cli` §14.2). */
export const rules: Rule[] = [{
  id: "pre-commit",
  severity: "warning",
  source: "committed",
  run(ctx) {
    const { emit, items } = collector();
    const values = loadSettings(ctx.root).config.values;
    for (const [key, check] of Object.entries(HOOK_SETTINGS)) {
      if (values[key] === true && !hookSectionPresent(ctx.root, check)) {
        emit("warning", "pre-commit", `${key} is on but the ${check} check is missing from the pre-commit hook; turn the setting off and on again to reinstall it`, ".specplane/config.yaml");
      }
    }
    return items;
  },
}];
