import { loadConfig } from "../config.js";
import { SpecplaneError, reportError } from "../errors.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { checkoutRoot } from "../git/repo.js";
import { parsePlan } from "../plan/parse.js";
import { listPlans } from "../plan/resolve.js";
import { getEffectiveStatus, type EffectiveStatus } from "../plan/status.js";
import type { Config, PlanFrontmatter } from "../types.js";

class PlanUsageError extends SpecplaneError {
  readonly exitCode = 1;
}

const STATUSES = ["draft", "ready", "in_progress", "review", "blocked", "done", "abandoned"];

export interface PlanListOptions {
  status?: string;
  json?: boolean;
}

export interface PlanListRow {
  id: string;
  title: string;
  stored_status: string;
  effective_status: EffectiveStatus;
  depends_on: string[];
  specs: string[];
  archived: boolean;
}

/** Rows sorted by ID descending, plus notes for plans that could not be parsed. */
export function planList(opts: PlanListOptions, root: string, config: Config): { rows: PlanListRow[]; problems: string[] } {
  if (opts.status !== undefined && !STATUSES.includes(opts.status)) {
    throw new PlanUsageError(`Unknown plan status \`${opts.status}\`: expected one of ${STATUSES.join(", ")}.`);
  }
  const problems: string[] = [];
  const parsed: { fm: PlanFrontmatter; archived: boolean }[] = [];
  for (const rec of listPlans(config, root)) {
    try {
      parsed.push({ fm: parsePlan(rec.dir).frontmatter, archived: rec.archived });
    } catch (e) {
      if (!(e instanceof SpecplaneError)) throw e;
      problems.push(`Skipped ${rec.id}: ${e.message}`);
    }
  }
  const byId = new Map(parsed.map((p) => [p.fm.id, p.fm]));
  const git = {
    branchExists: (id: string) => branchExists(`plan/${id}`, root) || remoteBranchExists(`plan/${id}`, root),
  };
  const rows = parsed
    .map(({ fm, archived }) => ({
      id: fm.id,
      title: fm.title,
      stored_status: fm.status,
      effective_status: getEffectiveStatus(fm, byId, config, git),
      depends_on: fm.depends_on ?? [],
      specs: fm.specs,
      archived,
    }))
    .filter((r) => opts.status === undefined || r.effective_status === opts.status)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { rows, problems };
}

export function formatPlanList(rows: PlanListRow[]): string {
  if (rows.length === 0) return "No plans.\n";
  const w1 = Math.max(...rows.map((r) => r.id.length));
  const w2 = Math.max(...rows.map((r) => r.title.length));
  return rows.map((r) => `${r.id.padEnd(w1)}  ${r.title.padEnd(w2)}  ${r.effective_status}\n`).join("");
}

export function planListCommand(opts: PlanListOptions): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const { rows, problems } = planList(opts, root, config);
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stdout.write(opts.json ? `${JSON.stringify(rows, null, 2)}\n` : formatPlanList(rows));
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
