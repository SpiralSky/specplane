import { loadSpecPaths } from "../spec/paths.js";
import { loadProject } from "../spec/project.js";
import { committedSource, headCommit, worktreeSource } from "../spec/source.js";
import { StatusCtx } from "../spec/status.js";
import { RULES } from "./rules/index.js";
import type { Finding, Severity, StatusRow } from "./rules/types.js";

/** The validation runner over the rule registry (`architecture/reference-cli` §6.1). Read-only. */

export type { Finding, Severity };

export interface Report {
  findings: Finding[];
  counts: { errors: number; warnings: number; notes: number };
  /** IDs of the specs that were checked. */
  checked: string[];
  /** Effective status of each checked spec, computed from HEAD. */
  statuses: StatusRow[];
}

export interface ValidateOptions { ids?: string[] }

/** Run every rule and return the report. `root` is the checkout root. */
export function validateProject(root: string, opts: ValidateOptions = {}): Report {
  const { paths, findings: config } = loadSpecPaths(root);
  const head = headCommit(root);
  const wt = loadProject(worktreeSource(root), paths);
  const headProject = head ? loadProject(committedSource(root, head), paths) : null;
  const sourceOf = (file: string): "committed" | "worktree" => {
    const then = headProject?.source.read(file) ?? null;
    return then !== null && then === wt.source.read(file) ? "committed" : "worktree";
  };
  const wanted = opts.ids?.length ? new Set(opts.ids) : null;
  const ctx = { root, paths, config, wt, head: headProject, wanted, status: headProject ? new StatusCtx(root, headProject) : null, statuses: [] as StatusRow[] };
  const findings: Finding[] = [];
  for (const rule of RULES) for (const f of rule.run(ctx)) findings.push({ ...f, source: sourceOf(f.file) });
  const checked = [...wt.specs.values()].filter((d) => !wanted || wanted.has(d.id)).map((d) => d.id);

  findings.sort((a, b) => (a.file === b.file ? (a.line ?? 0) - (b.line ?? 0) : a.file < b.file ? -1 : 1));
  const counts = { errors: 0, warnings: 0, notes: 0 };
  for (const f of findings) counts[f.severity === "error" ? "errors" : f.severity === "warning" ? "warnings" : "notes"]++;
  return { findings, counts, checked, statuses: ctx.statuses };
}

/** Plain-text report: one line per finding and a summary. */
export function formatReport(r: Report): string {
  const lines = r.findings.map((f) => `[${f.severity}] ${f.file}${f.line !== undefined ? `:${f.line}` : ""} (${f.rule}${f.source === "worktree" ? ", worktree" : ""}): ${f.message}`);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  lines.push(`Summary: ${plural(r.checked.length, "spec")} checked, ${plural(r.counts.errors, "error")}, ${plural(r.counts.warnings, "warning")}, ${plural(r.counts.notes, "note")}`);
  return lines.join("\n") + "\n";
}
