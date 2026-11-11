import { loadSettings } from "../config.js";
import { steeringWarnings } from "../harness/steering.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject } from "../spec/project.js";
import { worktreeSource } from "../spec/source.js";
import { computeCoverage } from "./coverage.js";
import { validateProject, type Finding } from "./validate.js";

/**
 * The warnings collector (`architecture/reference-cli` §6.3, `verification R24`): the warning findings of the
 * validation rules, uncovered items (`§6.4`) and the checks that are not validation, in one list. Recomputed on every
 * call; nothing is stored or dismissed, and a warning never blocks.
 */

export type WarningSubject = "spec" | "plan" | "permission" | "installation";

export interface Warning {
  text: string;
  subject: WarningSubject;
  why: string;
  /** The spec, plan or requirement ID the warning is about, when it is about one; `warnings <id>` narrows to it. */
  ref?: string;
}

export interface CollectOptions {
  /** An audit append failed during this command (set by the audit writer, read from the runner). */
  auditUnwritable?: boolean;
  /** Limit validation to these IDs, as `specplane warnings <id>` does. */
  ids?: string[];
}

const WHY: Record<string, string> = {
  "spec-format": "Spec files follow the format of architecture/file-formats §2.",
  cites: "Cites must resolve and be listed (architecture/reference-cli §4.3).",
  requirements: "Requirement files are listed and numbered consistently (§4.4).",
  status: "A spec or result is outdated against what it depends on (§5.2).",
  notes: "The local notes store has a problem or is behind its remote (§5.5, §5.6).",
  plans: "Plan records and their references are checked (§11.1).",
  tests: "Test declarations are well formed and unique per section (§10.1).",
  permissions: "Every permission has a description and steering text (§7.4).",
  config: "Configuration is read from HEAD (§3.2).",
};

const SUBJECT: Record<string, WarningSubject> = { plans: "plan", permissions: "permission", config: "installation", notes: "installation" };

/** The spec or plan ID a repository-relative file belongs to, or undefined. */
function refOf(file: string, dirs: { requirements: string; features: string; architecture: string; plans: string }): string | undefined {
  const stem = (rel: string): string => rel.replace(/\.md$/, "");
  if (file.startsWith(`${dirs.features}/`)) return `feature/${stem(file.slice(dirs.features.length + 1))}`;
  if (file.startsWith(`${dirs.architecture}/`)) return `architecture/${stem(file.slice(dirs.architecture.length + 1))}`;
  if (file.startsWith(`${dirs.requirements}/`)) return `requirement/${stem(file.slice(dirs.requirements.length + 1))}`;
  if (file.startsWith(`${dirs.plans}/`)) {
    const rest = file.slice(dirs.plans.length + 1).replace(/^archive\//, "");
    return rest.split("/")[0] || undefined;
  }
  return undefined;
}

function fromFinding(f: Finding, dirs: Parameters<typeof refOf>[1]): Warning {
  const ref = refOf(f.file, dirs);
  const where = f.file === "." ? "" : ` (${f.file}${f.line !== undefined ? `:${f.line}` : ""})`;
  return { text: `${f.message}${where}`, subject: SUBJECT[f.rule] ?? "spec", why: WHY[f.rule] ?? `Reported by the ${f.rule} rule.`, ...(ref ? { ref } : {}) };
}

/**
 * Installation checks that are not validation: the harness installation older than the installed Specplane
 * (`§12.6`) and the steering stamp older than the active preset or steering (`§12.4`). Local generation is checked
 * here; delivered-file ownership and installed stamps join when the new harness installer lands.
 */
function installationWarnings(root: string): Warning[] {
  return steeringWarnings(root).map((text) => ({ text, subject: "installation", why: "Steering must match active permissions and committed custom steering (§12.4)." }));
}

/** Collect every warning. Throws when the repository cannot be read; the caller decides what that means. */
export function collectWarnings(root: string, opts: CollectOptions = {}): Warning[] {
  const out: Warning[] = [];
  const { paths } = loadSpecPaths(root);
  const dirs = { requirements: paths.requirements, features: paths.features, architecture: paths.architecture, plans: paths.plansDir };
  const report = validateProject(root, opts.ids?.length ? { ids: opts.ids } : {});
  for (const f of report.findings) if (f.severity === "warning") out.push(fromFinding(f, dirs));

  const coverage = computeCoverage(loadProject(worktreeSource(root), paths), (loadSettings(root).config.values["coverage.requirement_only"] as string[] | undefined) ?? []);
  for (const i of coverage.uncovered) {
    const by = i.kind === "requirement" ? "a feature or architecture spec" : "an architecture spec";
    out.push({
      text: `${i.kind === "requirement" ? "requirement" : "feature spec"} ${i.id} is not covered by ${by}${i.requirementOnly ? " (listed as requirement-only in the configuration)" : ""}`,
      subject: "spec",
      why: "Requirements and feature specs that nothing covers are reported (verification R64).",
      ref: i.id,
    });
  }

  if (opts.auditUnwritable) out.push({ text: "the audit log could not be written", subject: "installation", why: "Every action is meant to be logged (verification R13)." });
  out.push(...installationWarnings(root));
  return out;
}

/** The warnings narrowed to one spec, plan or requirement ID. */
export function narrowWarnings(all: Warning[], id: string): Warning[] {
  return all.filter((w) => w.ref === id);
}
