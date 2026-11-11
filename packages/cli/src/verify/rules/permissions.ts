import { undocumentedPermissions } from "../../perm/catalog.js";
import { collector, type Rule } from "./types.js";

/** A catalog permission without a description or steering key is a warning (`architecture/reference-cli` §7.4). */
export const rules: Rule[] = [{
  id: "permissions",
  severity: "warning",
  source: "worktree",
  run() {
    const { emit, items } = collector();
    for (const id of undocumentedPermissions()) emit("warning", "permissions", `permission \`${id}\` has no description or steering key`, ".");
    return items;
  },
}];
