import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "./exec.js";

/**
 * Sections of the pre-commit hook file (`architecture/reference-cli` §14.2). Each check owns the lines between
 * `# specplane:begin <check>` and `# specplane:end <check>`; nothing else in the file is touched.
 */

export type HookCheck = "requirement-ids" | "tests" | "strict";

/** The setting that turns each check on. */
export const HOOK_SETTINGS: Record<string, HookCheck> = {
  "pre_commit.duplicate_requirement_ids": "requirement-ids",
  "pre_commit.tests": "tests",
};

/** The check that strict mode installs (`strict_mode.git_commit_guard`); it is not a `pre_commit.*` setting. */
export const STRICT_CHECK: HookCheck = "strict";

/** Write the hook file even when strict mode made it read-only (`strict_mode.os_permissions`), keeping its mode. */
function writeHook(file: string, text: string): void {
  let m: number | undefined;
  try { m = fs.statSync(file).mode & 0o777; if (!(m & 0o200)) fs.chmodSync(file, m | 0o200); else m = undefined; } catch { m = undefined; }
  try { fs.writeFileSync(file, text); } finally { if (m !== undefined) fs.chmodSync(file, m); }
}

/** Absolute path of the pre-commit hook file, honouring `core.hooksPath` and linked checkouts. */
export function hookFile(root: string): string {
  const p = run("git", ["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit"], { cwd: root }).trim();
  return path.resolve(root, p);
}

const begin = (c: HookCheck) => `# specplane:begin ${c}`;
const end = (c: HookCheck) => `# specplane:end ${c}`;

/** The section text. A missing `specplane` on PATH skips the check with a message rather than blocking every commit. */
function section(check: HookCheck): string[] {
  return [
    begin(check),
    "if command -v specplane >/dev/null 2>&1; then",
    `  specplane check ${check} --staged || exit 1`,
    "else",
    `  echo "specplane: not on PATH; skipped the ${check} pre-commit check" >&2`,
    "fi",
    end(check),
  ];
}

function readLines(file: string): string[] | null {
  try { return fs.readFileSync(file, "utf8").split("\n"); } catch { return null; }
}

/** True when the hook file holds the section for `check`. */
export function hookSectionPresent(root: string, check: HookCheck): boolean {
  return readLines(hookFile(root))?.some((l) => l.trim() === begin(check)) ?? false;
}

/** Insert the section after the shebang line (so an early `exit` in other lines cannot skip it); create the file executable if absent. */
export function installHookSection(root: string, check: HookCheck): "installed" | "already" {
  const file = hookFile(root);
  const lines = readLines(file);
  if (lines?.some((l) => l.trim() === begin(check))) return "already";
  if (!lines) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ["#!/bin/sh", ...section(check), ""].join("\n"), { mode: 0o755 });
    fs.chmodSync(file, 0o755);
    return "installed";
  }
  const at = lines[0]?.startsWith("#!") ? 1 : 0;
  lines.splice(at, 0, ...section(check));
  writeHook(file, lines.join("\n"));
  return "installed";
}

/** Remove only the section for `check`; delete the file when nothing but the shebang and blank lines remain. */
export function removeHookSection(root: string, check: HookCheck): "removed" | "absent" {
  const file = hookFile(root);
  const lines = readLines(file);
  const from = lines?.findIndex((l) => l.trim() === begin(check)) ?? -1;
  if (!lines || from < 0) return "absent";
  let to = lines.findIndex((l, i) => i > from && l.trim() === end(check));
  if (to < 0) to = from; // an unterminated section: remove only its begin marker's block start line
  lines.splice(from, to - from + 1);
  const rest = lines.filter((l, i) => l.trim() !== "" && !(i === 0 && l.startsWith("#!")));
  if (rest.length === 0) fs.rmSync(file, { force: true });
  else writeHook(file, lines.join("\n"));
  return "removed";
}
