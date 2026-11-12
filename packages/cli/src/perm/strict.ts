import * as fs from "node:fs";
import * as path from "node:path";
import { readCommittedConfig, readWorkingConfig } from "../config-source.js";
import { parseYaml } from "../yaml.js";

/**
 * Strict mode (`feature/roles-and-permissions` R55.1). `strict_mode.enabled` turns it on as a whole; each measure is
 * then on unless `strict_mode.<measure>` is off. Off by default. The Claude hook, the pre-commit section and the file
 * permission changes are the enforcement; this module only decides which measures apply (`architecture/reference-cli` §15).
 */
export const STRICT_MEASURES = ["edit_block", "git_commit_guard", "os_permissions"] as const;
export type StrictMeasure = (typeof STRICT_MEASURES)[number];

export const STRICT_MEASURE_DOCS: Readonly<Record<StrictMeasure, string>> = {
  edit_block: "The harness blocks file-tool and shell writes to specification, decision record and role files, which the LLM must change through Specplane actions",
  git_commit_guard: "A pre-commit check refuses a commit from an LLM's process that stages specification changes its role may not make directly, and the harness blocks --no-verify and edits of the git hooks",
  os_permissions: "Specplane makes the hooks, the Claude settings and the pre-commit hook read-only, keeps the local store private to its owner, and the harness blocks chmod on them",
};

export interface StrictSettings { enabled: boolean; measures: Record<string, boolean> }

const words: Record<string, boolean> = { on: true, off: false, true: true, false: false };
const asBool = (v: unknown): boolean | undefined => typeof v === "boolean" ? v : typeof v === "string" && v in words ? words[v] : undefined;

/** Strict mode as stated in a configuration file's text. */
export function strictSettings(text: string | null): StrictSettings {
  try {
    const doc = text === null ? null : parseYaml(text) as { strict_mode?: unknown } | null;
    const map = doc?.strict_mode;
    if (typeof map !== "object" || map === null || Array.isArray(map)) return { enabled: false, measures: {} };
    const measures: Record<string, boolean> = {};
    let enabled = false;
    for (const [k, v] of Object.entries(map)) {
      const b = asBool(v);
      if (b === undefined) continue;
      if (k === "enabled") enabled = b; else measures[k] = b;
    }
    return { enabled, measures };
  } catch { return { enabled: false, measures: {} }; }
}

/** True when strict mode is on and the measure is not turned off, in the given settings. */
export const strictMeasureIn = (s: StrictSettings, measure: StrictMeasure): boolean => s.enabled && s.measures[measure] !== false;

/** The measures in force according to the committed configuration (what the core enforces). */
export function strictMeasureOn(root: string, measure: StrictMeasure): boolean {
  try { return strictMeasureIn(strictSettings(readCommittedConfig(root)), measure); } catch { return false; }
}

/** The measures in force according to the working-tree configuration (what the hook scripts read; used by setting effects). */
export function strictMeasureInWorkingTree(root: string, measure: StrictMeasure): boolean {
  return strictMeasureIn(strictSettings(readWorkingConfig(root)), measure);
}

/** Warnings for `validate`: a name that is no measure, and a measure stated on while strict mode is off. */
export function strictFindings(enabled: boolean, map: Record<string, boolean> | undefined): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!(STRICT_MEASURES as readonly string[]).includes(k)) out.push(`setting \`strict_mode.${k}\` names no strict mode measure; allowed: ${STRICT_MEASURES.join(", ")}`);
    else if (v === true && !enabled) out.push(`strict mode measure \`${k}\` is on but \`strict_mode.enabled\` is off, so it has no effect`);
  }
  return out;
}

/** The Claude hook script that carries the harness part of strict mode; an older installed copy lacks it. */
export const GUARD_HOOK = ".claude/hooks/specplane-bypass-guard.sh";

/** True when the installed Claude guard hook handles strict mode. */
export function guardHookHasStrict(root: string): boolean {
  try { return fs.readFileSync(path.join(root, GUARD_HOOK), "utf8").includes("strict_mode"); } catch { return false; }
}
