import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.js";
import { AlreadyExistsError, SpecplaneError, reportError } from "../errors.js";
import { generatePlansMd } from "../generate/plans-md.js";
import { ask, csv, interactive } from "./spec.js";
import { resolveSpecId } from "../spec/resolve.js";
import { buildGraph, detectCycle } from "../plan/graph.js";
import { PlanNotFoundError } from "../errors.js";
import { planDir } from "../plan/resolve.js";
import { ID_RE_PLAN, planBody } from "../plan/new-template.js";
import { hasOpenPR } from "../git/forge.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { checkoutRoot } from "../git/repo.js";
import { fetchPlanBranches, getPlanActivity, remotePlanFrontmatter, remotePlanIds, type PlanActivity } from "../plan/activity.js";
import { parsePlan } from "../plan/parse.js";
import { listPlans } from "../plan/resolve.js";
import { getEffectiveStatus, type EffectiveStatus } from "../plan/status.js";
import { abandonPlan, archivePlan, cleanupPlan, finishPlan, restackPlan, startPlan } from "../plan/flows.js";
import type { Config, PlanFrontmatter } from "../types.js";

class PlanUsageError extends SpecplaneError {
  readonly exitCode = 1;
}

const STATUSES = ["draft", "ready", "in_progress", "review", "blocked", "done", "abandoned"];

export interface PlanListOptions {
  status?: string;
  json?: boolean;
  live?: boolean;
  /** Commander sets this to false for `--no-fetch`. */
  fetch?: boolean;
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

export type LivePlanListRow = PlanListRow & PlanActivity;

/** Rows sorted by ID descending, plus notes for plans that could not be parsed. */
export function planList(opts: PlanListOptions, root: string, config: Config): { rows: (PlanListRow | LivePlanListRow)[]; problems: string[] } {
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
  if (opts.live) {
    if (opts.fetch !== false) fetchPlanBranches(root);
    const known = new Set(parsed.map((p) => p.fm.id));
    for (const id of remotePlanIds(root)) {
      if (known.has(id)) continue;
      const fm = remotePlanFrontmatter(id, config, root);
      if (fm) parsed.push({ fm, archived: false });
      else problems.push(`Skipped ${id}: PLAN.md on origin/plan/${id} is missing or invalid.`);
    }
  }
  const byId = new Map(parsed.map((p) => [p.fm.id, p.fm]));
  const git = {
    branchExists: (id: string) => branchExists(`plan/${id}`, root) || remoteBranchExists(`plan/${id}`, root),
    hasOpenPr: (id: string) => hasOpenPR(`plan/${id}`, { cwd: root, forge: config.plans.forge }),
  };
  const rows: (PlanListRow | LivePlanListRow)[] = parsed
    .map(({ fm, archived }) => ({
      id: fm.id,
      title: fm.title,
      stored_status: fm.status,
      effective_status: getEffectiveStatus(fm, byId, config, git),
      depends_on: fm.depends_on ?? [],
      specs: fm.specs,
      archived,
      ...(opts.live ? getPlanActivity(fm.id, config, root) : {}),
    }))
    .filter((r) => opts.status === undefined || r.effective_status === opts.status)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { rows, problems };
}

function activityLine(r: LivePlanListRow): string {
  const s = r.steps;
  const parts = [`steps ${s.done + s.skipped}/${s.total}`];
  if (s.next) parts.push(`next ${s.next.number} ${s.next.title} (${s.next.status})`);
  parts.push(`where ${r.where}`);
  if (r.blocked_issues.length > 0) parts.push(`blockers: ${r.blocked_issues.join("; ")}`);
  return `  ${parts.join(", ")}\n`;
}

export function formatPlanList(rows: (PlanListRow | LivePlanListRow)[]): string {
  if (rows.length === 0) return "No plans.\n";
  const w1 = Math.max(...rows.map((r) => r.id.length));
  const w2 = Math.max(...rows.map((r) => r.title.length));
  return rows
    .map((r) => `${r.id.padEnd(w1)}  ${r.title.padEnd(w2)}  ${r.effective_status}\n` + ("where" in r ? activityLine(r) : ""))
    .join("");
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

export interface PlanNewOptions {
  id?: string;
  title?: string;
  specs?: string;
  dependsOn?: string;
}

/** Create a draft plan folder; returns the repository-relative PLAN.md path. */
export async function planNew(opts: PlanNewOptions, root: string, config: Config): Promise<string> {
  let id = opts.id?.trim();
  if (!id) {
    if (!interactive()) throw new PlanUsageError("`plan new` needs `--id` when not run in a terminal.");
    const slug = (await ask("Plan slug: ")).toLowerCase();
    id = `${new Date().toISOString().slice(0, 10)}-${slug}`;
  }
  if (!ID_RE_PLAN.test(id)) {
    throw new PlanUsageError(`Invalid plan ID \`${id}\`: expected YYYY-MM-DD-<slug> with lowercase letters, digits, and hyphens.`);
  }
  const existing = listPlans(config, root);
  if (existing.some((p) => p.id === id)) throw new AlreadyExistsError("Plan", id);

  let title = opts.title?.trim();
  if (!title && interactive()) title = await ask("Title: ");
  if (!title) throw new PlanUsageError("`plan new` needs `--title`.");
  let specs = csv(opts.specs);
  if (specs.length === 0 && interactive()) specs = csv(await ask("Spec IDs (comma-separated): "));
  if (specs.length === 0) throw new PlanUsageError("`plan new` needs `--specs` with at least one spec ID.");
  let deps = csv(opts.dependsOn);
  if (opts.dependsOn === undefined && interactive()) deps = csv(await ask("Depends on plan IDs (comma-separated, optional): "));

  for (const s of specs) resolveSpecId(s, config, undefined, root);
  const known = new Set(existing.map((p) => p.id));
  for (const d of deps) if (!known.has(d)) throw new PlanNotFoundError(d);
  const graph = buildGraph([
    ...existing.map((p) => ({ id: p.id, depends_on: parsePlan(p.dir).frontmatter.depends_on })),
    { id, depends_on: deps },
  ]);
  const cycle = detectCycle(graph);
  if (cycle) throw new PlanUsageError(`Dependency cycle: ${cycle.join(" -> ")}.`);

  const dir = path.join(root, config.plans.dir, id);
  fs.mkdirSync(path.join(dir, "steps"), { recursive: true });
  const fm = [
    `id: ${id}`,
    `title: ${JSON.stringify(title)}`,
    "status: draft",
    `specs: ${JSON.stringify(specs)}`,
    ...(deps.length > 0 ? [`depends_on: ${JSON.stringify(deps)}`] : []),
  ];
  fs.writeFileSync(path.join(dir, "PLAN.md"), `---\n${fm.join("\n")}\n---\n${planBody(title)}`);
  fs.writeFileSync(path.join(dir, "HANDOFF.md"), `# HANDOFF \u2014 ${id}\n`);
  return path.relative(root, path.join(dir, "PLAN.md")).split(path.sep).join("/");
}

export async function planNewCommand(opts: PlanNewOptions): Promise<void> {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    process.stdout.write(`Created ${await planNew(opts, root, config)}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

/** PLAN.md text (frontmatter included) of an active or archived plan. */
export function planShow(id: string, root: string, config: Config): string {
  return fs.readFileSync(path.join(planDir(id, config, root), "PLAN.md"), "utf8");
}

export function planShowCommand(id: string): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    process.stdout.write(planShow(id, root, config));
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

/** The Mermaid graph of PLANS.md, without the code fence. */
export function planGraph(root: string, config: Config): string {
  const md = generatePlansMd(config, root);
  const m = /```mermaid\n([\s\S]*?)\n```/.exec(md);
  return m ? m[1] : "";
}

export function planGraphCommand(): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    process.stdout.write(`${planGraph(root, config)}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

export function planStartCommand(id: string): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const r = startPlan(id, config, root);
    for (const n of r.notices) process.stderr.write(`${n}\n`);
    const where = r.path !== null ? `Worktree: ${r.path}` : `Branch: ${r.branch}`;
    const next = r.next ? `Next step: ${String(r.next.number).padStart(2, "0")} ${r.next.title} (${r.next.status})` : "No pending steps.";
    process.stdout.write(`${r.resumed ? "Resumed" : "Started"} ${r.planId}\n${where}\n${next}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

export async function planFinishCommand(id: string, opts: { yes?: boolean }): Promise<void> {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const confirm = interactive()
      ? async (q: string) => /^y(es)?$/i.test(await ask(`${q} [y/N] `))
      : undefined;
    const r = await finishPlan(id, config, root, { yes: opts.yes, confirm });
    for (const n of r.notices) process.stderr.write(`${n}\n`);
    const word = r.outcome === "merged" ? "Finished and merged" : r.outcome === "pushed" ? "Finished and pushed" : "Finished";
    process.stdout.write(`${word} ${r.planId}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

function withConfig(fn: (root: string, config: Config) => void): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    fn(root, config);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

export function planAbandonCommand(id: string, opts: { deleteBranch?: boolean; force?: boolean }): void {
  withConfig((root, config) => {
    const r = abandonPlan(id, config, root, opts);
    const parts = [r.committed ? (r.archived ? "committed and archived" : "committed") : "already abandoned"];
    if (r.worktreeRemoved) parts.push("worktree removed");
    if (r.branchDeleted) parts.push("branch deleted");
    process.stdout.write(`Abandoned ${r.planId} (${parts.join(", ")})\n`);
  });
}

export function planCleanupCommand(id: string, opts: { force?: boolean }): void {
  withConfig((root, config) => {
    const r = cleanupPlan(id, config, root, opts);
    const parts: string[] = [];
    if (r.worktreeRemoved) parts.push("worktree removed");
    if (r.branchSwitched) parts.push("checkout switched to the default branch");
    if (r.branchDeleted) parts.push("branch deleted");
    process.stdout.write(`Cleaned up ${r.planId}${parts.length ? ` (${parts.join(", ")})` : " (nothing to do)"}\n`);
  });
}

export function planArchiveCommand(id: string): void {
  withConfig((root, config) => {
    const r = archivePlan(id, config, root);
    process.stdout.write(`Archived ${r.planId} to ${r.to}\n`);
  });
}

export function planRestackCommand(id: string, opts: { dryRun?: boolean }): void {
  withConfig((root, config) => {
    const r = restackPlan(id, config, root, opts);
    const text =
      r.outcome === "current"
        ? `${r.planId} is already on the tip of ${r.onto}`
        : `${r.outcome === "dry-run" ? "Would restack" : "Restacked"} ${r.planId} onto ${r.onto}${r.unstacked ? " (no longer stacked)" : ""}`;
    process.stdout.write(`${text}\n`);
  });
}
