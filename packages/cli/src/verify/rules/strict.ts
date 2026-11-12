import * as fs from "node:fs";
import * as path from "node:path";
import { STRICT_CHECK, hookSectionPresent } from "../../git/hooks.js";
import { GUARD_HOOK, guardHookHasStrict, strictMeasureIn, strictSettings } from "../../perm/strict.js";
import { openFiles } from "../../perm/strict-os.js";
import { readCommittedConfig } from "../../config-source.js";
import { collector, type Rule } from "./types.js";

/**
 * Strict mode's measures that the installation cannot carry out (`roles-and-permissions R55.1`, `harness R35.1`): a measure that
 * is in force without the hook, hook section or file permissions it needs is reported, never silently skipped. Codex has no
 * pre-tool hook, so a Codex-only project gets the harness measure reported as not enforceable.
 */
export const rules: Rule[] = [{
  id: "strict",
  severity: "warning",
  source: "committed",
  run(ctx) {
    const { emit, items } = collector();
    const s = strictSettings(readCommittedConfig(ctx.root));
    if (!s.enabled) return items;
    const claude = fs.existsSync(path.join(ctx.root, ".claude/hooks/specplane-cli-block.sh")) || fs.existsSync(path.join(ctx.root, GUARD_HOOK));
    const codex = fs.existsSync(path.join(ctx.root, ".codex/config.toml")) || fs.existsSync(path.join(ctx.root, ".agents/skills/specplane"));
    if (strictMeasureIn(s, "edit_block")) {
      if (claude && !guardHookHasStrict(ctx.root)) emit("warning", "strict", "strict_mode.edit_block is on but the installed Claude hook does not block specification edits; run `specplane init --harness claude` again", GUARD_HOOK);
      if (codex) emit("warning", "strict", "strict_mode.edit_block is on, but Codex has no pre-tool hook, so direct edits of specifications by Codex are not blocked", ".codex/config.toml");
      if (!claude && !codex) emit("warning", "strict", "strict_mode.edit_block is on but no harness is installed, so nothing blocks direct edits of specifications", ".specplane/config.yaml");
    }
    if (strictMeasureIn(s, "git_commit_guard") && !hookSectionPresent(ctx.root, STRICT_CHECK)) {
      emit("warning", "strict", "strict_mode.git_commit_guard is on but the strict check is missing from the pre-commit hook; turn the setting off and on again to reinstall it", ".specplane/config.yaml");
    }
    if (strictMeasureIn(s, "os_permissions")) {
      const open = openFiles(ctx.root);
      if (open.length) emit("warning", "strict", `strict_mode.os_permissions is on but ${open.length} file(s) are not locked down (${open.slice(0, 3).join(", ")}${open.length > 3 ? ", ..." : ""}); turn the setting off and on again to apply it`, ".specplane/config.yaml");
    }
    return items;
  },
}];
