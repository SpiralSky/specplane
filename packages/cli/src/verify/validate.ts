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

/** The families that also run inside each subproject. */
const SUBPROJECT_RULES = new Set(["requirements", "spec-format", "cites"]);

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
  // Each subproject is checked like the root project, and its findings name it (`later-releases R39`).
  if (!wanted) {
    for (const sub of wt.subprojects.values()) {
      const subCtx = { ...ctx, wt: sub, paths: sub.paths };
      for (const rule of RULES.filter((r) => SUBPROJECT_RULES.has(r.id))) for (const f of rule.run(subCtx)) findings.push({ ...f, project: sub.name, source: sourceOf(f.file) });
    }
  }
  const checked: string[] = [...wt.specs.values()].filter((d) => !wanted || wanted.has(d.id)).map((d) => d.id);
  for (const sub of wt.subprojects.values()) if (!wanted) for (const d of sub.specs.values()) checked.push(`${sub.name}:${d.id}`);

  findings.sort((a, b) => (a.file === b.file ? (a.line ?? 0) - (b.line ?? 0) : a.file < b.file ? -1 : 1));
  const counts = { errors: 0, warnings: 0, notes: 0 };
  for (const f of findings) counts[f.severity === "error" ? "errors" : f.severity === "warning" ? "warnings" : "notes"]++;
  return { findings, counts, checked, statuses: ctx.statuses };
}

/** Plain-text report: one line per finding and a summary. */
export function formatReport(r: Report): string {
  const lines = r.findings.map((f) => `[${f.severity}] ${f.file}${f.line !== undefined ? `:${f.line}` : ""} (${f.project ? `project ${f.project}, ` : ""}${f.rule}${f.source === "worktree" ? ", worktree" : ""}): ${f.message}`);
  const names = [...new Set(r.findings.map((f) => f.project ?? "root"))];
  if (r.findings.some((f) => f.project)) {
    for (const n of names) {
      const own = r.findings.filter((f) => (f.project ?? "root") === n);
      lines.push(`Project ${n}: ${own.filter((f) => f.severity === "error").length} errors, ${own.filter((f) => f.severity === "warning").length} warnings`);
    }
  }
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  lines.push(`Summary: ${plural(r.checked.length, "spec")} checked, ${plural(r.counts.errors, "error")}, ${plural(r.counts.warnings, "warning")}, ${plural(r.counts.notes, "note")}`);
  return lines.join("\n") + "\n";
}
