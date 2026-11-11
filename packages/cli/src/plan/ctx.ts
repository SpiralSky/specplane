import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { audit } from "../audit/log.js";
import { loadSettings } from "../config.js";
import { SpecplaneError } from "../errors.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { mainRoot } from "../git/repo.js";
import { guard, type Actor, type Authorized, type Preset } from "../perm/permissions.js";
import { holdRequest, RequestSent, sentMessage } from "../requests/hold.js";
import { storeDir } from "../repo/store.js";
import { loadProject } from "../spec/project.js";
import { committedSource, worktreeSource } from "../spec/source.js";
import { loadSpecPaths } from "../spec/paths.js";
import { findPlan, type PlanRecord, type Progress } from "./model.js";

/** Shared context, guard, audit, store and git helpers of the plan operations (`architecture/reference-cli` §11). */

export interface PlanCtx {
  /** Root of the checkout the command runs in. */
  root: string;
  actor: Actor;
  preset: Preset;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Request being accepted, recorded in the audit log (`reference-cli` §8). */
  request?: string;
  /** Resources the harness can measure for budgets; unset when no adapter said (`reference-cli` §11.4). */
  measurable?: string[];
}

export class PlanOpError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(message: string) { super(message); }
}

export const git = (cwd: string, args: string[]): string => run("git", args, { cwd });
export const gitTry = (cwd: string, args: string[]): string | null => { try { return run("git", args, { cwd }); } catch { return null; } };
export const today = (ctx: PlanCtx): string => (ctx.now ?? new Date()).toISOString().slice(0, 10);
export const nowIso = (ctx: PlanCtx): string => (ctx.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");

export function plansConfig(root: string) { return loadSettings(root).config.plans; }
export function plansDir(root: string): string { return loadSettings(root).config.plans.dir.replace(/\/+$/, ""); }

/** A budget on a resource the harness cannot measure is refused when it is set (`harness R35.1`). */
export function assertMeasurable(ctx: PlanCtx, resource: string): void {
  if (ctx.measurable && !ctx.measurable.includes(resource)) {
    throw new PlanOpError(`The harness cannot measure \`${resource}\` (it measures: ${ctx.measurable.join(", ") || "nothing"}), so a budget on it would not be enforced and was not set.`);
  }
}

/* ------------------------------------------------------------------ guard and audit */

/**
 * Run the guard for a command. Deny audits and throws `PlanOpError`; `request user` stores a request and throws
 * `RequestSent`, so no part of the action runs. `params` are what accepting the request runs again.
 */
export function authorize(ctx: PlanCtx, needs: (string | string[])[], describe: string, command: string, args: string[], params: Record<string, unknown> = {}): Authorized {
  const g = guard(ctx.preset, ctx.actor, needs, describe);
  if (g.kind === "allow") return g.token;
  if (g.kind === "request") {
    const planId = typeof params.id === "string" ? params.id : null;
    const rec = holdRequest({ root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission, command, params, reason: `${describe} (\`${command} ${args.join(" ")}\`).`, plan: planId, now: ctx.now, env: ctx.env });
    throw new RequestSent(rec, sentMessage(rec));
  }
  audit(ctx.root, { command, args, permission: g.permission, outcome: "refused", reason: g.message, request: ctx.request, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name } }, ctx.now);
  throw new PlanOpError(g.message);
}

export function auditDone(ctx: PlanCtx, command: string, args: string[], permission: string | null, extra: { old?: unknown; new?: unknown } = {}): void {
  audit(ctx.root, { command, args, permission, outcome: "done", request: ctx.request, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name }, ...extra }, ctx.now);
}

/** Guard, run, audit `done` or `failed`. */
export function guarded<T>(ctx: PlanCtx, command: string, args: string[], needs: (string | string[])[], describe: string, fn: (token: Authorized) => T): T {
  return guardedWith({ id: args[0] }, ctx, command, args, needs, describe, fn);
}

/** `guarded` with the parameters accepting a request would run the command again with. */
export function guardedWith<T>(params: Record<string, unknown>, ctx: PlanCtx, command: string, args: string[], needs: (string | string[])[], describe: string, fn: (token: Authorized) => T): T {
  const token = authorize(ctx, needs, describe, command, args, params);
  const perm = token.permissions[0] ?? null;
  try {
    const out = fn(token);
    auditDone(ctx, command, args, perm);
    return out;
  } catch (e) {
    audit(ctx.root, { command, args, permission: perm, outcome: "failed", reason: (e as Error).message.split("\n")[0], request: ctx.request, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name } }, ctx.now);
    throw e;
  }
}

/* ------------------------------------------------------------------ local store (worktrees, runs, reviews) */

function storeFile(root: string, rel: string): string { return path.join(storeDir(root), rel); }

export function readStore<T>(root: string, rel: string): T | null {
  try { return JSON.parse(fs.readFileSync(storeFile(root, rel), "utf8")) as T; } catch { return null; }
}
export function writeStore(root: string, rel: string, value: unknown): void {
  const abs = storeFile(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value) + "\n");
  fs.renameSync(tmp, abs);
}
export function removeStore(root: string, rel: string): void { try { fs.rmSync(storeFile(root, rel), { force: true }); } catch { /* absent */ } }

export function listWorktreePaths(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const txt = gitTry(root, ["worktree", "list", "--porcelain"]) ?? "";
  let cur: string | null = null;
  for (const l of txt.split("\n")) {
    if (l.startsWith("worktree ")) cur = l.slice(9);
    else if (l.startsWith("branch ") && cur) out.set(l.slice(7).replace(/^refs\/heads\//, ""), cur);
  }
  return out;
}

/** The plan's checkout: the recorded path, checked against git's worktree list, which wins (`repository-layout` §3). */
export function worktreeOf(root: string, id: string): string | null {
  const map = readStore<Record<string, string>>(root, "worktrees.json") ?? {};
  const listed = listWorktreePaths(root).get(`plan/${id}`) ?? null;
  const rec = map[id];
  if (listed && fs.existsSync(listed)) {
    if (rec !== listed) writeStore(root, "worktrees.json", { ...map, [id]: listed });
    return listed;
  }
  if (rec) { const { [id]: _drop, ...rest } = map; writeStore(root, "worktrees.json", rest); }
  return null;
}
export function setWorktree(root: string, id: string, p: string | null): void {
  const map = readStore<Record<string, string>>(root, "worktrees.json") ?? {};
  if (p === null) { const { [id]: _drop, ...rest } = map; writeStore(root, "worktrees.json", rest); }
  else writeStore(root, "worktrees.json", { ...map, [id]: p });
}

export interface RunMarker { session: string | null; pid: number | null; heartbeat: string }
export function writeRun(ctx: PlanCtx, id: string, session: string | null, pid: number | null = null): void {
  writeStore(ctx.root, `runs/${id}.json`, { session, pid, heartbeat: nowIso(ctx) } satisfies RunMarker);
}
export function clearRun(root: string, id: string): void { removeStore(root, `runs/${id}.json`); }

/** A marker whose heartbeat is older than five minutes, or whose pid is dead on this machine, is no run (`reference-cli` §11.3). */
export function runIsLive(root: string, id: string, now: Date = new Date()): boolean {
  const m = readStore<RunMarker>(root, `runs/${id}.json`);
  if (!m) return false;
  if (now.getTime() - new Date(m.heartbeat).getTime() > 5 * 60_000) return false;
  if (typeof m.pid === "number") { try { process.kill(m.pid, 0); } catch { return false; } }
  return true;
}

/* ------------------------------------------------------------------ locating plans */

export function loadPlanAt(root: string, id: string): PlanRecord | null {
  return findPlan(worktreeSource(root), plansDir(root), id);
}

/** Root of the checkout where the plan's files are live: its worktree when one exists, else this checkout. */
export function liveRoot(ctx: PlanCtx, id: string): string {
  const wt = worktreeOf(ctx.root, id);
  if (wt && [id, `archive/${id}`].some((d) => fs.existsSync(path.join(wt, plansDir(ctx.root), d)))) return wt;
  return ctx.root;
}

export function requirePlan(ctx: PlanCtx, id: string): { root: string; rec: PlanRecord } {
  const root = liveRoot(ctx, id);
  const rec = loadPlanAt(root, id);
  if (!rec) throw new PlanOpError(`Plan \`${id}\` not found in ${plansDir(ctx.root)}.`);
  if (rec.legacy) throw new PlanOpError(`Plan \`${id}\` has no progress.yaml; it is in the retired plan format.`);
  return { root, rec };
}

export function committedProject(root: string, rev = "HEAD") {
  return loadProject(committedSource(root, rev), loadSpecPaths(root).paths);
}

/* ------------------------------------------------------------------ progress.yaml and commits */

const PROGRESS_ORDER = ["status", "target_branch", "start_commit", "branch", "current_step", "done", "budget", "session", "stop", "final_review"];

export function renderProgress(p: Progress): string {
  const ordered: Record<string, unknown> = {};
  for (const k of PROGRESS_ORDER) if (p[k] !== undefined && p[k] !== null) ordered[k] = p[k];
  for (const k of Object.keys(p)) if (!(k in ordered) && p[k] !== undefined) ordered[k] = p[k];
  return yaml.dump(ordered, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true, flowLevel: -1 });
}

export function writeProgress(root: string, rec: PlanRecord, p: Progress): void {
  const abs = path.join(root, rec.progressFile);
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, renderProgress(p));
  fs.renameSync(tmp, abs);
}

export const planSlug = (id: string): string => id.replace(/^\d{4}-\d{2}-\d{2}-/, "");

/** Stage exactly `paths` (new files included) and commit them with the Specplane format (`file-formats` §8). */
export function commitPaths(ctx: PlanCtx, root: string, paths: string[], m: { onlyStaged?: boolean; type: string; scope?: string; summary: string; body?: string; workflow: string; planId?: string; step?: number; trailers?: Record<string, string> }): string {
  if (!m.onlyStaged) git(root, ["add", "-A", "--", ...paths]);
  const trailers = { ...cliTrailers(m.workflow, m.planId ?? "", ctx.env ?? process.env) } as Record<string, string | string[]>;
  if (m.step !== undefined) {
    // Keep the documented order: Workflow, Plan, Step, Agent, Session.
    const { "Specplane-Workflow": w, "Specplane-Plan": pl, ...rest } = trailers;
    for (const k of Object.keys(trailers)) delete trailers[k];
    Object.assign(trailers, { "Specplane-Workflow": w, ...(pl ? { "Specplane-Plan": pl } : {}), "Specplane-Step": String(m.step).padStart(2, "0"), ...rest });
  }
  let message: string;
  try { message = formatMessage({ type: m.type, scope: m.scope, summary: m.summary, body: m.body, trailers }); }
  catch { message = formatMessage({ type: "chore", scope: "specplane", summary: m.summary.slice(0, 40), body: m.body, trailers }); }
  git(root, m.onlyStaged ? ["commit", "-m", message] : ["commit", "-m", message, "--", ...paths]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

export function currentBranch(root: string): string | null { return gitTry(root, ["branch", "--show-current"])?.trim() || null; }
export function branchExists(root: string, b: string): boolean { return gitTry(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]) !== null; }
export function revParse(root: string, rev: string): string | null { return gitTry(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])?.trim() || null; }
export function isDirty(root: string, untracked = true): boolean {
  return (gitTry(root, ["status", "--porcelain", ...(untracked ? [] : ["--untracked-files=no"])]) ?? "").trim() !== "";
}
export function humanName(root: string): string | null { return gitTry(root, ["config", "user.name"])?.trim() || null; }
export { mainRoot };
