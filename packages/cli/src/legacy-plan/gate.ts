import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { PlanNext } from "./next.js";

export interface GateResult { allowed: boolean; action: string; reason: string; code: number }
export interface GateInput {
  next: PlanNext; backend: string; live?: boolean; halfFinished?: boolean;
  force?: boolean; reason?: string; steps?: number; maxSteps?: number;
}
const deny = (code: number, reason: string, action = "ask_human"): GateResult => ({ allowed: false, action, reason, code });

/** Resolve execution eligibility without writes; force never overrides safety/approval conditions. */
export function runGate(i: GateInput): GateResult {
  const n = i.next;
  if (i.backend !== "worktree") return deny(5, i.backend === "external" ? "The external environment runs its own sessions." : "The conductor requires the worktree backend.");
  if (!n.checkout) return deny(5, "No plan checkout; start the plan first.");
  if (n.attention.some(a => a.kind === "dirty" || a.kind === "diverged")) return deny(5, n.reason);
  if (i.live) return deny(3, "A session for this step is already running; attach instead of starting another.");
  if (i.halfFinished) return deny(3, `Step commit exists without a completed status; inspect plan show ${n.plan} and recover with plan step-done. Force cannot bypass this recovery.`);
  if (n.effectiveStatus === "draft" || n.effectiveStatus === "blocked") return deny(2, n.reason);
  if (n.effectiveStatus === "done") return deny(0, "Plan already done.", "none");
  if (n.effectiveStatus === "shelved") return deny(3, "Plan is shelved; resume it first.", "none");
  if (n.effectiveStatus === "abandoned") return deny(3, "Plan is abandoned.", "none");
  if (n.attention.some(a => a.kind !== "finish_ready")) return deny(2, n.reason);
  if (n.action === "finish" && !n.step) return deny(0, "All steps completed; human finish review is required.", "finish_ready");
  if (i.force && !i.reason?.trim()) return deny(3, "--force requires a non-empty --reason.");
  if (n.step?.status === "done" || n.step?.status === "skipped") {
    if (!i.force || !i.reason?.trim()) return deny(3, "Step already completed; rerunning requires --force --reason.");
  } else if (n.action !== "spawn_step") return deny(2, n.reason);
  if (!n.step) return deny(3, "No step to run.");
  if (i.maxSteps !== undefined && (i.steps ?? 0) >= i.maxSteps) return deny(4, "Step limit reached.", "limit");
  return { allowed: true, action: "spawn_step", reason: `Would run step ${n.step.number}.`, code: 0 };
}

/** Validate bounded CLI limits before any execution or filesystem mutation. */
export function positiveLimit(value: unknown, name: string, integer = true): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isSafeInteger(n))) throw new Error(`${name} must be a finite positive ${integer ? "integer" : "number"}.`);
  return n;
}

export class LockRefused extends Error {}
interface Lock { pid: number; sessionId: string; token: string; startedAt: string }
/** Only ESRCH proves a PID dead; inaccessible/live PIDs are never reclaimed. */
function dead(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; }
}
function parseLock(file: string): Lock {
  const v = JSON.parse(fs.readFileSync(file, "utf8")) as Lock;
  if (!Number.isSafeInteger(v.pid) || v.pid < 1 || typeof v.token !== "string" || typeof v.sessionId !== "string") throw new LockRefused("Malformed lock; inspect it manually rather than risking a duplicate session.");
  return v;
}
/**
 * Acquire a per-plan lock. An exclusive short-lived guard serializes reclamation with acquisition
 * and release. A crashed guard fails closed and needs manual inspection; it is never guessed stale.
 */
export function acquireRunLock(file: string, sessionId: string): { release(): void; reclaimed: boolean } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const guard = `${file}.guard`;
  const guarded = <T>(f: () => T): T => {
    let fd: number;
    try { fd = fs.openSync(guard, "wx", 0o600); } catch { throw new LockRefused("Lock acquisition/recovery is already in progress; inspect stale guard if no conductor remains."); }
    try { return f(); } finally { fs.closeSync(fd); fs.unlinkSync(guard); }
  };
  const token = randomUUID();
  const reclaimed = guarded(() => {
    let reclaimed = false;
    if (fs.existsSync(file)) {
      let prior: Lock;
      try { prior = parseLock(file); } catch (e) { throw new LockRefused(`Cannot safely read lock: ${(e as Error).message}`); }
      if (!dead(prior.pid)) throw new LockRefused(`Plan lock is held by live or inaccessible PID ${prior.pid}.`);
      fs.unlinkSync(file); reclaimed = true;
    }
    const fd = fs.openSync(file, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, sessionId, token, startedAt: new Date().toISOString() })); }
    finally { fs.closeSync(fd); }
    return reclaimed;
  });
  return { reclaimed, release: () => guarded(() => {
    if (fs.existsSync(file) && parseLock(file).token === token) fs.unlinkSync(file);
  }) };
}
