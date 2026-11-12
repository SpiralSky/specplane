import type { SpecPaths } from "../../spec/paths.js";
import type { Project } from "../../spec/project.js";
import type { StatusCtx } from "../../spec/status.js";

/** The rule registry's shared types (`architecture/reference-cli` §6.1). */

export type Severity = "error" | "warning" | "note";

export interface Finding {
  severity: Severity;
  /** Rule family: `config`, `requirements`, `spec-format`, `cites`, `status`, `notes`, `plans`, `permissions`. */
  rule: string;
  message: string;
  file: string;
  line?: number;
  /** The subproject the finding belongs to; absent for the root project (`later-releases R39`). */
  project?: string;
  /** Section ID the finding is in, when known. */
  section?: string;
  /** `worktree` when the file differs from HEAD (or is not committed), else `committed`. */
  source: "committed" | "worktree";
}

/** A finding before the runner has decided whether its file is committed or only in the working tree. */
export type RawFinding = Omit<Finding, "source">;

export interface StatusRow { id: string; stored: string | null; effective: string; reasons: string[] }

/** What a rule reads: both snapshots, the scope, and the one read of the notes store. */
export interface RuleCtx {
  root: string;
  paths: SpecPaths;
  /** Configuration findings from loading the settings. */
  config: { severity: "error" | "warning"; message: string }[];
  /** The working-tree project. */
  wt: Project;
  /** The project at HEAD; null when the repository has no commits. */
  head: Project | null;
  /** IDs the command was limited to, or null for everything. */
  wanted: Set<string> | null;
  /** Status context over HEAD; null when there is no HEAD. */
  status: StatusCtx | null;
  /** Filled by the `status` family for the report. */
  statuses: StatusRow[];
}

export interface Rule {
  /** The rule family, also the `rule` of its findings. */
  id: string;
  /** The highest severity the rule can report. */
  severity: Severity;
  /** The snapshot it reads: status-like rules read `committed`; format rules read the `worktree`. */
  source: "committed" | "worktree";
  run(ctx: RuleCtx): RawFinding[];
}

export type Emit = (severity: Severity, rule: string, message: string, file: string, line?: number, section?: string) => void;

/** An emitter that collects raw findings into a list. */
export function collector(): { emit: Emit; items: RawFinding[] } {
  const items: RawFinding[] = [];
  const emit: Emit = (severity, rule, message, file, line, section) => {
    items.push({ severity, rule, message, file, ...(line !== undefined ? { line } : {}), ...(section ? { section } : {}) });
  };
  return { emit, items };
}
