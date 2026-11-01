import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SpecplaneError } from "../errors.js";
import { claude } from "./claude.js";
import { codex } from "./codex.js";

/** Collects the `Created`/`Updated`/`Skipped` lines printed by `init`. */
export class Report {
  readonly lines: string[] = [];
  constructor(private readonly root: string) {}
  private rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }
  created(abs: string): void {
    this.lines.push(`Created ${this.rel(abs)}`);
  }
  updated(abs: string): void {
    this.lines.push(`Updated ${this.rel(abs)}`);
  }
  skipped(abs: string, reason = "already exists"): void {
    this.lines.push(`Skipped ${this.rel(abs)} (${reason})`);
  }
  add(line: string): void {
    this.lines.push(line);
  }
}

/** An agent harness that `specplane init` can install (`architecture/claude-integration`). */
export interface Harness {
  name: string;
  /** True when the harness is already present in the repository. */
  detect(root: string): boolean;
  /** Write the harness files, recording one report line per file. */
  install(root: string, report: Report): void;
  /** Repo-relative POSIX directories of the installed skills, one per skill (skill contract drift checks). */
  skillDirs(root: string): string[];
  /** Repo-relative standing-instructions file (for the freshness check). */
  rulesFile: string;
  /** Path of the bundled rules template relative to `templatesDir(name)`; enables the rules-file freshness check. */
  rulesTemplate?: string;
  /** Upstream contract snapshots for this harness’s installed skills only; template-relative paths. */
  bundledContracts?: Record<string, string>;
  /** Harness-specific Workflows line for the standing instructions (default: neutral). */
  workflowsLine?: string;
}

/** Skill directories (`<base>/<name>`, repo-relative POSIX) under `base` that contain a `SKILL.md`. */
export function skillDirsIn(root: string, base: string): string[] {
  const abs = path.join(root, base);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(abs, e.name, "SKILL.md")))
    .map((e) => `${base}/${e.name}`)
    .sort();
}

export class UnknownHarnessError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(name: string, known: string[]) {
    super(`Unknown harness \`${name}\`. Known harnesses: ${known.join(", ")}`);
  }
}

/** Directory with the bundled templates of a harness, resolved relative to this compiled module. */
export function templatesDir(name: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "templates", name);
}

export const HARNESSES: Harness[] = [claude, codex];

export const NO_HARNESS_HINT =
  "No `.claude/` directory found. To enable Claude Code integration, run `specplane init --harness claude`.";

/** Harnesses to install: the requested one, else every detected one. Unknown name throws. */
export function selectHarnesses(
  root: string,
  requested: string | undefined,
  registry: Harness[] = HARNESSES,
): Harness[] {
  if (requested === "none") return [];
  if (requested !== undefined) {
    const h = registry.find((x) => x.name === requested);
    if (!h) throw new UnknownHarnessError(requested, registry.map((x) => x.name));
    return [h];
  }
  return registry.filter((h) => h.detect(root));
}
