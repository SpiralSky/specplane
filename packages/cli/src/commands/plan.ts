import { firstStart } from "../plan/first-start.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.js";
import { AlreadyExistsError, PlanStateError, SpecplaneError, reportError } from "../errors.js";
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
import { fetchPlanBranches, getPlanActivity, hasRemote, remotePlanIds, localPlanIds, planReport, selectedPlanBranch, targetPlanRecord, committedPlanRecord, lenientFrontmatter, type PlanActivity, type PlanReport } from "../plan/activity.js";
import { formatNext, planNext } from "../plan/next.js";
import { attentionFor, type Attention } from "../plan/alerts.js";
import { runPlans, type RunOptions } from "../plan/run.js";
import { stepDone, type StepDoneOptions } from "../plan/step-done.js";
import { parsePlan } from "../plan/parse.js";
import { listPlans } from "../plan/resolve.js";
import { resolveCommit, validateTargetBranch } from "../plan/context.js";
import { blockedReason, getEffectiveStatus, type EffectiveStatus } from "../plan/status.js";
import { abandonPlan, archivePlan, cleanupPlan, finishPlan, mergedStackBase, restackPlan } from "../plan/flows.js";
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

export interface PlanListRow extends PlanReport {
  id: string;
  title: string;
  stored_status: string;
  effective_status: EffectiveStatus;
  depends_on: string[];
  specs: string[];
  archived: boolean;
}

export type LivePlanListRow = PlanListRow & PlanActivity & { attention: Attention[] };

/** Rows sorted by ID descending, plus notes for plans that could not be parsed. */
export function planList(opts: PlanListOptions, root: string, config: Config): { rows: (PlanListRow | LivePlanListRow)[]; problems: string[]; blockedReasons: Map<string, string>; notices: string[] } {
  if (opts.status !== undefined && !STATUSES.includes(opts.status)) {
    throw new PlanUsageError(`Unknown plan status \`${opts.status}\`: expected one of ${STATUSES.join(", ")}.`);
  }
  const problems: string[] = [];
  const notices: string[] = [];
  let freshness: PlanReport["ref_freshness"]["fetch"] = "local";
  const parsed: { fm: PlanFrontmatter; archived: boolean }[] = [];
  for (const rec of listPlans(config, root)) {
    try {
      const committed = committedPlanRecord(rec.id, config, root);
      parsed.push({ fm: committed ? committed.data as unknown as PlanFrontmatter : parsePlan(rec.dir).frontmatter, archived: rec.archived });
    } catch (e) {
      if (!(e instanceof SpecplaneError)) throw e;
      problems.push(`Skipped ${rec.id}: ${e.message}`);
    }
  }
  if (opts.live) {
    if (opts.fetch !== false && hasRemote(root)) {
      if (!fetchPlanBranches(root)) { freshness = "failed"; notices.push("notice: could not fetch origin; showing local refs"); }
      else freshness = "fetched";
    }
    const known = new Set(parsed.map((p) => p.fm.id));
    for (const id of new Set([...localPlanIds(root), ...remotePlanIds(root)])) {
      if (known.has(id)) continue;
      const fm = selectedPlanBranch(id, config, root)?.data as unknown as PlanFrontmatter | undefined;
      if (fm) parsed.push({ fm, archived: false });
      else problems.push(`Skipped ${id}: PLAN.md on origin/plan/${id} is missing or invalid.`);
    }
  }
  for (const item of parsed) {
    const branch = selectedPlanBranch(item.fm.id, config, root);
    const report = planReport(item.fm.id, config, root, item.fm as unknown as Record<string, unknown>, freshness);
    const target = targetPlanRecord(item.fm.id, config, root, report);
    if (target || branch) item.fm = (target?.data ?? branch!.data) as unknown as PlanFrontmatter;
  }
  const byId = new Map(parsed.map((p) => [p.fm.id, p.fm]));
  const blockedReasons = new Map<string, string>();
  const git = {
    branchExists: (id: string) => branchExists(`plan/${id}`, root) || remoteBranchExists(`plan/${id}`, root),
    hasOpenPr: (id: string) => { const fm = byId.get(id); const target = planReport(id, config, root, fm as unknown as Record<string, unknown> ?? null, freshness).target_branch; return target ? hasOpenPR(`plan/${id}`, { cwd: root, forge: config.plans.forge, base: target }) : false; },
  };
  const rows: (PlanListRow | LivePlanListRow)[] = parsed
    .map(({ fm, archived }) => { const report = planReport(fm.id, config, root, fm as unknown as Record<string, unknown>, freshness); const branch = selectedPlanBranch(fm.id, config, root); const target = targetPlanRecord(fm.id, config, root, report); const targetConfig = target?.config ?? config; const dependencies = new Map(byId); if (target) for (const id of fm.depends_on ?? []) { const dep = targetPlanRecord(id, config, root, report); if (dep) dependencies.set(id, dep.data as unknown as PlanFrontmatter); else dependencies.delete(id); } const reason = blockedReason(fm, dependencies, targetConfig); if (reason) blockedReasons.set(fm.id, reason); return ({
      id: fm.id,
      title: fm.title,
      stored_status: fm.status,
      effective_status: getEffectiveStatus(fm, dependencies, targetConfig, git),
      depends_on: fm.depends_on ?? [],
      specs: fm.specs,
      archived,
      ...report,
      ...(opts.live ? { ...getPlanActivity(fm.id, config, root, report.target_branch, branch?.ref ?? target?.ref ?? null), attention: (() => { if (branch?.data.execution || (branch && branch.ref === report.ref_freshness.plan_remote && branch.ref !== report.ref_freshness.plan_local)) return [{kind:"unavailable", detail:"Attention is unavailable for this selected execution snapshot.", command:`specplane plan show ${fm.id}`}]; try { return attentionFor(planNext(fm.id, config, root)); } catch (e) { return [{kind:"unavailable",detail:(e as Error).message,command:`specplane plan show ${fm.id}`}]; } })() } : {}),
    }); })
    .filter((r) => opts.status === undefined || r.effective_status === opts.status)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (opts.live) {
    for (const r of rows) {
      if (r.archived || r.effective_status === "done" || r.effective_status === "abandoned" || !branchExists(`plan/${r.id}`, root) || !r.target_branch || r.integration_status === "unverifiable") continue;
      const baseId = mergedStackBase(r.id, config, root, r.target_branch);
      if (baseId) notices.push(`Base plan \`${baseId}\` has merged; run \`specplane plan restack ${r.id}\`.`);
    }
  }
  return { rows, problems, blockedReasons, notices };
}

function activityLine(r: LivePlanListRow): string {
  const s = r.steps;
  const parts = [`steps ${s.done + s.skipped}/${s.total}`];
  if (s.next) parts.push(`next ${s.next.number} ${s.next.title} (${s.next.status})`);
  parts.push(`where ${r.where}`);
  if (r.backend === "worktree" && r.checkout) parts.push(`checkout ${r.checkout}`);
  if (r.blocked_issues.length > 0) parts.push(`blockers: ${r.blocked_issues.join("; ")}`);
  parts.push(`attention ${r.attention.length}`);
  return `  ${parts.join(", ")}\n`;
}

export function formatPlanList(rows: (PlanListRow | LivePlanListRow)[], blockedReasons: Map<string, string> = new Map()): string {
  if (rows.length === 0) return "No plans.\n";
  const w1 = Math.max(...rows.map((r) => r.id.length));
  const w2 = Math.max(...rows.map((r) => r.title.length));
  return rows
    .map((r) => {
      const reason = r.effective_status === "blocked" ? blockedReasons.get(r.id) : undefined;
      return `${r.id.padEnd(w1)}  ${r.title.padEnd(w2)}  ${r.effective_status}${reason ? `  ${reason}` : ""}  target ${r.target_branch ?? "unknown"}, start ${r.start_base ?? "unknown"}${r.comparison_base ? `, comparison ${r.comparison_base}` : ""}, integration ${r.integration_status}${r.pending_target_branch ? `, pending target ${r.pending_target_branch}` : ""}, refs ${r.ref_freshness.fetch}${r.integration_status === "unverifiable" ? `, reason ${r.integration_reasons.join("; ")}` : ""}\n` + ("where" in r ? activityLine(r) : "");
    })
    .join("");
}

export function planListCommand(opts: PlanListOptions): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const { rows, problems, blockedReasons, notices } = planList(opts, root, config);
    for (const n of notices) process.stderr.write(`${n}\n`);
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stdout.write(opts.json ? `${JSON.stringify(rows, null, 2)}\n` : formatPlanList(rows, blockedReasons));
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

export interface PlanNewOptions {
  id?: string;
  title?: string;
  specs?: string;
  dependsOn?: string;
  target?: string;
  comparisonBase?: string;
  dryRun?: boolean;
}

/** Create a draft plan folder; returns the repository-relative PLAN.md path. */
export async function planNew(opts: PlanNewOptions, root: string, config: Config): Promise<string> {
  let id = opts.id?.trim();
  if (!id) {
    if (!interactive()) throw new PlanUsageError("Plan ID needed: pass `--id`.");
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
  if (!title) {
    const slug = id.slice(11).replace(/-/g, " ");
    title = slug.charAt(0).toUpperCase() + slug.slice(1);
  }
  let specs = csv(opts.specs);
  if (specs.length === 0 && interactive()) specs = csv(await ask("Spec IDs (comma-separated): "));
  if (specs.length === 0) throw new PlanUsageError("`plan new` needs `--specs` with at least one spec ID.");
  let deps = csv(opts.dependsOn);
  if (opts.dependsOn === undefined && interactive()) deps = csv(await ask("Depends on plan IDs (comma-separated, optional): "));

  for (const s of specs) resolveSpecId(s, config, undefined, root);
  const known = new Set(existing.map((p) => p.id));
  for (const d of deps) if (!known.has(d)) throw new PlanNotFoundError(d);
  for (const d of deps) {
    const dependency = existing.find((p) => p.id === d)!;
    if (parsePlan(dependency.dir).frontmatter.status === "abandoned") throw new PlanUsageError(`Dependency \`${d}\` is abandoned.`);
  }
  if (opts.target !== undefined) validateTargetBranch(root, opts.target, id);
  const comparisonBase = opts.comparisonBase === undefined ? undefined : resolveCommit(root, opts.comparisonBase);
  const graph = buildGraph([
    ...existing.map((p) => ({ id: p.id, depends_on: parsePlan(p.dir).frontmatter.depends_on })),
    { id, depends_on: deps },
  ]);
  const cycle = detectCycle(graph);
  if (cycle) throw new PlanUsageError(`Dependency cycle: ${cycle.join(" -> ")}.`);

  const dir = path.join(root, config.plans.dir, id);
  if (opts.dryRun) return path.relative(root, path.join(dir, "PLAN.md")).split(path.sep).join("/");
  fs.mkdirSync(path.join(dir, "steps"), { recursive: true });
  const fm = [
    `id: ${id}`,
    `title: ${JSON.stringify(title)}`,
    "status: draft",
    `specs: ${JSON.stringify(specs)}`,
    ...(deps.length > 0 ? [`depends_on: ${JSON.stringify(deps)}`] : []),
    ...(opts.target !== undefined ? [`target_branch: ${JSON.stringify(opts.target)}`] : []),
    ...(comparisonBase !== undefined ? [`comparison_base: ${JSON.stringify(comparisonBase)}`] : []),
  ];
  fs.writeFileSync(path.join(dir, "PLAN.md"), `---\n${fm.join("\n")}\n---\n${planBody(title)}`);
  fs.writeFileSync(path.join(dir, "HANDOFF.md"), `# HANDOFF \u2014 ${id}\n`);
  fs.writeFileSync(path.join(dir, "steps", ".gitkeep"), "");
  return path.relative(root, path.join(dir, "PLAN.md")).split(path.sep).join("/");
}

export async function planNewCommand(opts: PlanNewOptions): Promise<void> {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    process.stdout.write(`${opts.dryRun ? "Would create" : "Created"} ${await planNew(opts, root, config)}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

/** PLAN.md text (frontmatter included) of an active or archived plan. */
export function planShow(id: string, root: string, config: Config): string {
  const branch = selectedPlanBranch(id, config, root);
  const committed = committedPlanRecord(id, config, root);
  let localText: string | null = committed?.text ?? null;
  if (!localText && !branch) {
    try { localText = fs.readFileSync(path.join(planDir(id, config, root), "PLAN.md"), "utf8"); }
    catch (e) { if (!(e instanceof PlanNotFoundError)) throw e; }
  }
  const report = planReport(id, config, root, branch?.data ?? (localText ? lenientFrontmatter(localText) : null));
  const target = targetPlanRecord(id, config, root, report);
  const text = branch?.text ?? target?.text ?? localText;
  if (text === null) throw new PlanNotFoundError(id);
  const fm = (target?.data ?? branch?.data ?? lenientFrontmatter(text)) as unknown as PlanFrontmatter;
  const dependencies = new Map<string, PlanFrontmatter>();
  for (const dep of fm.depends_on ?? []) { const record = targetPlanRecord(dep, config, root, report); if (record) dependencies.set(dep, record.data as unknown as PlanFrontmatter); }
  const effective_status = getEffectiveStatus(fm, dependencies, target?.config ?? config, {
    branchExists: pid => branchExists(`plan/${pid}`, root) || remoteBranchExists(`plan/${pid}`, root),
    hasOpenPr: pid => !!report.target_branch && hasOpenPR(`plan/${pid}`, {cwd: root, forge: (target?.config ?? config).plans.forge, base: report.target_branch}),
  });
  return `${text}${text.endsWith("\n") ? "" : "\n"}\nDerived plan context:\n${JSON.stringify({ ...report, effective_status }, null, 2)}\n`;
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

export async function planStartCommand(id: string, opts: { fetch?: boolean; json?: boolean; run?: boolean; target?: string; dryRun?: boolean } = {}): Promise<void> {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    if (opts.run) throw new PlanStateError("Standalone --run is unavailable; use an explicitly installed execution extension.");
    const r = firstStart(id, config, root, opts);
    for (const n of r.notices) process.stderr.write(`${n}\n`);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ...r, checkout: r.path }, null, 2)}\n`);
      return;
    }
    if (r.dryRun) { process.stdout.write(`Would start ${id} on ${r.target} at ${r.startBase ?? "unknown"} (${r.freshness})${r.legacy ? " [legacy]" : ""}\n`); return; }
    const where = r.path !== null ? `Worktree: ${r.path}` : `Branch: ${r.branch}`;
    const lines = [`${r.resumed ? "Resumed" : "Started"} ${r.planId}`, `Target: ${r.target_branch}; start base: ${r.start_base ?? "unknown"}; comparison base: ${r.comparison_base ?? "none"}; freshness: ${r.ref_freshness}`, `Backend: ${r.backend} (checkout ${r.backend === "external" ? "not needed" : r.backend === "worktree" ? r.checkoutCreated ? "created" : "resumed" : r.resumed ? "resumed" : "created"})`, where];
    if (r.legacy) lines.splice(2, 0, "Legacy execution; original start base is unavailable.");
    const next = r.next ? `Next step: ${String(r.next.number).padStart(2, "0")} ${r.next.title} (${r.next.status})` : "No pending steps.";
    lines.push(next);
    if (r.backend === "external") {
      lines.push("The environment runs the finish flow itself; do not run `specplane plan finish` locally.");
    } else {
      lines.push(`Continue in ${r.path ?? r.branch}.`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

export async function planFinishCommand(id: string, opts: { yes?: boolean; fetch?: boolean }): Promise<void> {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const confirm = interactive()
      ? async (q: string) => /^y(es)?$/i.test(await ask(`${q} [y/N] `))
      : undefined;
    const r = await finishPlan(id, config, root, { yes: opts.yes, confirm, fetch: opts.fetch });
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
    const parts = [r.archived ? "committed and archived" : "committed"];
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
    if (r.outcome === "dry-run") {
      for (const c of r.commits) process.stdout.write(`${c.sha} ${c.subject}\n`);
    }
  });
}

export function planNextCommand(id: string, opts: { json?: boolean }): void {
  withConfig((root, config) => {
    const n = planNext(id, config, root);
    process.stdout.write(opts.json ? `${JSON.stringify(n, null, 2)}\n` : formatNext(n));
  });
}

export function planStepDoneCommand(id: string, opts: StepDoneOptions): void {
  withConfig((root, config) => {
    const r = stepDone(id, opts, config, root);
    process.stdout.write(`Committed ${r.commit}\nHANDOFF: ${r.handoff} (step ${String(r.step).padStart(2, "0")}, ${r.outcome})\n`);
  });
}

/** CLI orchestration; interrupt observation without terminating the harness session. */
export async function planRunCommand(ids: string[], opts: RunOptions & { json?: boolean }): Promise<void> {
 const controller = new AbortController();
 const interrupt = () => controller.abort();
 process.once("SIGINT", interrupt);
 try {
  const root = checkoutRoot(); const { config } = loadConfig(root);
  const results = await runPlans(ids, config, root, { ...opts, signal: controller.signal }, () => ({ log: s => process.stderr.write(`${s}\n`) }));
  process.exitCode = Math.max(...results.map(r => r.code));
  process.stdout.write(opts.json ? `${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n` : results.map(r => `${r.plan}: ${r.reason}${r.sessionId ? `\nSession: ${r.sessionId}\nAttach: ${r.commands!.attach}\nLogs: ${r.commands!.logs}` : ""}\n`).join(""));
 } catch(e) {
  process.exitCode = 5;
  process.stdout.write(opts.json ? `${JSON.stringify({ok:false,code:5,action:"ask_human",reason:(e as Error).message})}\n` : `${(e as Error).message}\n`);
 } finally { process.removeListener("SIGINT", interrupt); }
}
