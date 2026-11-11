import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "./git/exec.js";

/**
 * Where configuration text comes from (`architecture/reference-cli` §3.2): the committed file at HEAD of the
 * checkout, never the working tree. A missing file, a repository without commits and a directory that is not a
 * repository all read as "no file" (all defaults).
 */

export const CONFIG_FILE = ".specplane/config.yaml";

/** `git show HEAD:.specplane/config.yaml`, or `null` when there is no committed file. */
export function readCommittedConfig(root: string): string | null {
  try { return run("git", ["show", `HEAD:${CONFIG_FILE}`], { cwd: root }); } catch { return null; }
}

/** The working-tree file, or `null` when it does not exist. */
export function readWorkingConfig(root: string): string | null {
  try { return fs.readFileSync(path.join(root, CONFIG_FILE), "utf8"); } catch { return null; }
}

/** True when the working-tree file differs from the committed one (a missing file counts as empty on both sides). */
export function configDiffersFromHead(root: string): boolean {
  return (readWorkingConfig(root) ?? "") !== (readCommittedConfig(root) ?? "");
}
