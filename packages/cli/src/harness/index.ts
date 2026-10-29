import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SpecplaneError } from "../errors.js";

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
  /** Directories holding installed skills (for skill contract drift checks). */
  skillDirs(root: string): string[];
  /** Repo-relative standing-instructions file (for the freshness check). */
  rulesFile: string;
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

// Stub: completed in step 04 (install copies templates and merges settings).
const claude: Harness = {
  name: "claude",
  detect: (root) => fs.existsSync(path.join(root, ".claude")),
  install: () => {},
  skillDirs: (root) => [path.join(root, ".claude", "skills")],
  rulesFile: ".claude/rules/specplane.md",
};

export const HARNESSES: Harness[] = [claude];

export const NO_HARNESS_HINT =
  "No `.claude/` directory found. To enable Claude Code integration, run `specplane init --harness claude`.";

/** Harnesses to install: the requested one, else every detected one. Unknown name throws. */
export function selectHarnesses(
  root: string,
  requested: string | undefined,
  registry: Harness[] = HARNESSES,
): Harness[] {
  if (requested !== undefined) {
    const h = registry.find((x) => x.name === requested);
    if (!h) throw new UnknownHarnessError(requested, registry.map((x) => x.name));
    return [h];
  }
  return registry.filter((h) => h.detect(root));
}
