import { readFileSync } from "node:fs";
import * as path from "node:path";
import { CONFIG_PATH, parseConfig } from "../config.js";
import { ConfigError } from "../errors.js";
import { BYPASS_MEASURES } from "../perm/bypass.js";
import { STRICT_MEASURES } from "../perm/strict.js";

/** Read-only hook plumbing: working-tree settings, with the core's YAML and path normalization. */
export function guardConfig(root: string) {
  // Missing/unreadable files and malformed protection settings must not silently become defaults.
  const { config, findings } = parseConfig(readFileSync(path.join(root, CONFIG_PATH), "utf8"));
  const errors = findings.filter((f) => f.severity === "error" &&
    (f.key === CONFIG_PATH || /^(paths|subprojects|strict_mode|bypass_guards)(\.|$)/.test(f.key)));
  if (errors.length) throw new ConfigError(null, errors.map((f) => f.message).join("\n"));
  const subprojects = config.values.subprojects as Array<{ name: string; path: string }>;
  return {
    version: 1,
    spec_dirs: [config.paths.requirements, config.paths.features, config.paths.architecture,
      ".specplane/decisions", ".specplane/roles",
      ...subprojects.flatMap((s) => ["requirements", "features", "architecture"].map((layer) => `${s.path}/${layer}`))],
    strict: Object.fromEntries(STRICT_MEASURES.map((m) =>
      [m, config.values["strict_mode.enabled"] === true && config.values[`strict_mode.${m}`] !== false])),
    bypass: Object.fromEntries(BYPASS_MEASURES.map((m) => [m, config.values[`bypass_guards.${m}`] !== false])),
  };
}
