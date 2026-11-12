import { PreconditionError } from "../errors.js";
import { createPlan } from "../plan/create.js";
import { editPlan, validateEditParams } from "../plan/edit.js";
import { liveRoot, requirePlan, type PlanCtx } from "../plan/ctx.js";
import { abandonPlan, deletePlan, finishPlan, mergePlan, reviewPlan } from "../plan/finish.js";
import { resumePlan, setBudget, startPlan, stepDone, stopPlan } from "../plan/run.js";
import "./adapters.js";
import { getAdapter } from "./adapter.js";
import { checkSelection, describePlan, listInfos, stepTasks } from "../plan/status.js";
import { bool, str, strings, type ActionContext, type Adder } from "./action-types.js";

/**
 * The 14 plan actions (`architecture/reference-cli` §11, §12.1). Each plan operation guards itself with the actor of the
 * runtime, so a held request and a refusal behave exactly as for the CLI; the registry permissions drive the in-process
 * pre-check and instruction delivery. `plan.step-done` has no permission of its own (`§11.3`).
 */
const pc = (c: ActionContext): PlanCtx => ({ root: c.root, actor: c.actor, preset: c.preset, now: c.now, ...(c.measurable ? { measurable: c.measurable } : {}) });
const id = { id: str };

export function registerPlanActions(add: Adder): void {
  add("plan.create", { words: strings, title: str, implements: strings, writes: strings, references: strings }, ["words"], ["plan.create"], false,
    (c, p) => ({ ok: true, ...createPlan(pc(c), { words: p.words, title: p.title, implements: p.implements, writes: p.writes, references: p.references }) }));
  const change = { type: "object", additionalProperties: false, required: ["path", "before", "after"], properties: { path: str, before: { type: ["string", "null"] }, after: { type: ["string", "null"] } } };
  add("plan.edit", { ...id, changes: { type: "array", items: change, minItems: 1 } }, ["id", "changes"], ["plan.edit"], false, (c, p) => {
    validateEditParams(p.id, p.changes);
    return { ok: true, ...editPlan(pc(c), p.id, { changes: p.changes }) };
  });
  add("plan.list", { live: bool }, [], ["info.retrieve"], true, (c, p) => ({ ok: true, plans: listInfos(pc(c), !!p.live, (planId) => liveRoot(pc(c), planId)) }));
  add("plan.next", { ...id, from: { type: "integer", minimum: 1 }, count: { oneOf: [{ type: "integer", minimum: 1 }, { const: "all" }] } }, ["id"], ["info.retrieve"], true, (c, p) => {
    const { root, rec } = requirePlan(pc(c), p.id);
    const info = describePlan(pc(c), root, rec);
    const selection = checkSelection(info, p.from ?? null, p.count ?? 1);
    // The next step's tasks and how they run: parallel groups need subagents on this harness (`plan-execution R31.2`).
    const host = c.adapter ? getAdapter(c.adapter) : undefined;
    const tasks = info.next ? stepTasks(pc(c), rec, info.next.number, { name: host?.name ?? "this harness", subagents: !!host?.capabilities(root).subagents }) : null;
    return { ok: selection.ok, reasons: selection.ok ? [] : [selection.message], next: info.next, selection, tasks };
  });
  add("plan.step-done", { ...id, step: { type: "integer", minimum: 1 }, outcome: { enum: ["done", "partial"] }, summary: str, type: str }, ["id", "step", "outcome"], [], false,
    (c, p) => ({ ok: true, ...stepDone(pc(c), p.id, { step: p.step, outcome: p.outcome, summary: p.summary, type: p.type }) }));
  // The LLM can only soft stop; user, hard and failure stops belong to the person and the adapter (`§11.3`).
  add("plan.softstop", { ...id, reason: str, needs: str }, ["id"], ["plan.softstop"], false,
    (c, p) => ({ ok: true, ...stopPlan(pc(c), p.id, { kind: "soft", reason: p.reason, needs: p.needs }) }));
  // Like the typed `plan-start`, the action opens the plan's session through the adapter when the server was started
  // with one (`agent-skills` §7.4); without an adapter it only starts the plan and says so.
  add("plan.start", { ...id, target: str, force_deps: strings }, ["id"], ["plan.start"], false, (c, p) => {
    if (!c.launcher) return { ok: true, ...startPlan(pc(c), p.id, { target: p.target, forceDeps: p.force_deps }), session: null, note: "No harness adapter opens the plan's session here; open one in the worktree and use plan-step." };
    // The session ID is chosen first so the plan record, the run marker and the host session all name the same one.
    const sessionId = c.launcher.newSessionId();
    const ctx: PlanCtx = { ...pc(c), actor: { ...c.actor, session: sessionId }, env: { ...process.env, SPECPLANE_SESSION: sessionId } };
    const started = startPlan(ctx, p.id, { target: p.target, forceDeps: p.force_deps });
    try { return { ok: true, ...started, session: sessionId, opened: c.launcher.open(ctx, p.id, { sessionId, resume: false }) }; }
    catch (e) { return { ok: false, reasons: e instanceof PreconditionError ? e.reasons : [(e as Error).message], ...started, session: null }; }
  });
  add("plan.resume", id, ["id"], ["plan.resume"], false, (c, p) => ({ ok: true, ...resumePlan(pc(c), p.id) }));
  add("plan.abandon", { ...id, force: bool }, ["id"], ["plan.abandon"], false, (c, p) => ({ ok: true, ...abandonPlan(pc(c), p.id, { force: p.force }) }));
  add("plan.delete", { ...id, force: bool }, ["id"], ["plan.delete"], false, (c, p) => ({ ok: true, ...deletePlan(pc(c), p.id, { force: p.force }) }));
  add("plan.budget", { ...id, resource: str, soft: { type: "number", exclusiveMinimum: 0 }, hard: { type: "number", exclusiveMinimum: 0 }, remove: bool }, ["id", "resource"], ["plan.budget"], false,
    (c, p) => ({ ok: true, ...setBudget(pc(c), p.id, { resource: p.resource, soft: p.soft, hard: p.hard, remove: p.remove }) }));
  add("plan.review", id, ["id"], ["info.retrieve"], true, (c, p) => ({ ok: true, ...reviewPlan(pc(c), p.id) }));
  add("plan.finish", { ...id, complete: bool, back: str }, ["id"], ["plan.complete"], false, (c, p) => {
    if (!!p.complete === !!p.back) throw new PreconditionError(["Give exactly one of complete or back."]);
    return { ok: true, ...finishPlan(pc(c), p.id, { complete: !!p.complete, back: p.back }) };
  });
  // `plan.merge` is guarded by `plan.complete` (assumption, `§12.1`).
  add("plan.merge", { ...id, mode: { enum: ["pr", "local"] }, force: bool }, ["id", "mode"], ["plan.complete"], false,
    (c, p) => { const r = mergePlan(pc(c), p.id, { mode: p.mode, force: p.force }); return { ok: true, ...r }; });
}
