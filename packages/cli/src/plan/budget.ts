import { logBudgetHardStop, requirePlan, type PlanCtx } from "./ctx.js";
import { stopPlan } from "./run.js";

/**
 * Budget enforcement (`feature/plan-execution` R27.1; `architecture/reference-cli` §11.4). The adapter measures usage
 * and calls in; usage readings are never stored. Reaching the soft stop tells the LLM to finish cleanly and the plan is
 * then soft stopped; reaching the hard stop ends the session and records a hard stop. Both name the budget.
 */

export interface Limit { resource: string; soft: number; hard: number }
/** Percent of each resource used so far (0 to 100); a resource the adapter did not read is not checked. */
export type Usage = Record<string, number>;

export type Decision =
  | { action: "none"; unmeasured: string[] }
  | { action: "soft" | "hard"; resource: string; percent: number; limit: number; reason: string; unmeasured: string[] };

export function softReason(l: Limit): string { return `soft stop at ${l.soft}% of the ${l.resource} limit`; }
export function hardReason(l: Limit): string { return `hard stop at ${l.hard}% of the ${l.resource} limit`; }

/** The instruction the LLM is given at the soft stop (`R27.1`). */
export function softInstruction(d: { resource: string; limit: number }): string {
  return `The soft stop of the ${d.resource} budget (${d.limit}%) is reached. Bring the current work to a safe point, commit what is done, write a handoff entry that records the partial state and where a re-run must start, then end the session.`;
}

/** Pure decision: a hard stop wins over a soft one; no budget means no check. */
export function evaluateBudget(limits: Limit[] | undefined, usage: Usage): Decision {
  const unmeasured = (limits ?? []).filter((l) => usage[l.resource] === undefined).map((l) => l.resource);
  let soft: Decision | null = null;
  for (const l of limits ?? []) {
    const used = usage[l.resource];
    if (used === undefined) continue;
    if (used >= l.hard) return { action: "hard", resource: l.resource, percent: used, limit: l.hard, reason: hardReason(l), unmeasured };
    if (used >= l.soft && !soft) soft = { action: "soft", resource: l.resource, percent: used, limit: l.soft, reason: softReason(l), unmeasured };
  }
  return soft ?? { action: "none", unmeasured };
}

export interface BudgetCheck { decision: Decision; instruction: string | null; stopped: boolean }

/**
 * Check a plan against the adapter's readings. At the hard stop the plan is stopped at once with `stop.kind: hard`
 * (the session is ending by force). At the soft stop the LLM is told to finish; the plan is stopped with `stop.kind: soft`
 * only when `finished` says it has written its handoff and is ending the session.
 */
export function checkBudget(ctx: PlanCtx, id: string, usage: Usage, o: { finished?: boolean } = {}): BudgetCheck {
  const { rec } = requirePlan(ctx, id);
  const pr = rec.progress!;
  const decision = evaluateBudget(pr.budget, usage);
  if (decision.action === "none" || pr.status !== "in-progress") return { decision: pr.status === "in-progress" ? decision : { action: "none", unmeasured: decision.unmeasured }, instruction: null, stopped: false };
  if (decision.action === "hard") {
    logBudgetHardStop(ctx, id, decision.reason, decision.resource);
    stopPlan(ctx, id, { kind: "hard", reason: decision.reason, needs: "resume the plan; the session was ended by force, so check the last commit and the handoff for partial work" });
    return { decision, instruction: null, stopped: true };
  }
  if (o.finished) {
    stopPlan(ctx, id, { kind: "soft", reason: decision.reason, needs: "resume the plan once the budget allows" });
    return { decision, instruction: null, stopped: true };
  }
  return { decision, instruction: softInstruction(decision), stopped: false };
}
