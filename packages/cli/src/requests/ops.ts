import { audit } from "../audit/log.js";
import { activePreset, guard, type Actor, type Preset } from "../perm/permissions.js";
import { requirePlan, type PlanCtx } from "../plan/ctx.js";
import { stopPlan } from "../plan/run.js";
import { specDiffText } from "../spec/edit.js";
import { requestContext, requestRoot } from "./checkout.js";
import { actionFor } from "./actions.js";
import { holdRequest, sentMessage } from "./hold.js";
import { actionNeeds, InvalidRequestAction } from "./requirements.js";
import { answerRequest, claimAnswer, listRequests, readRequest, RequestStateError, type RequestRecord } from "./store.js";

/** Send, list, show, accept and decline (`feature/requests` R52, R52.1, R52.2; `architecture/reference-cli` §8). */

export interface RequestCtx { root: string; actor: Actor; preset: Preset; now?: Date; env?: NodeJS.ProcessEnv }

export interface RequestResult {
  ok: boolean;
  lines: string[];
  reasons: string[];
  request?: RequestRecord;
  /** Plan to resume after a blocking request was answered (`plan-execution R27.5.1`). */
  resume?: string;
}

const auditActor = (a: Actor) => ({ role: a.role, kind: a.kind, name: a.name, ...(a.session ? { session: a.session } : {}) });
const stamp = (c: RequestCtx) => (c.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");

/* ------------------------------------------------------------------ send */

export interface SendInput {
  /** The action asked for, as a command name from `REQUESTABLE_COMMANDS` and its parameters. */
  command: string;
  params: Record<string, unknown>;
  /** Ignored: the required permissions are derived from the action and its parameters (`requests R52.2`, `R52.3`). */
  permissions?: string[];
  reason: string;
  plan?: string | null;
  blocking?: boolean;
}

/**
 * The harness action `request.send`: the LLM asks the user to approve an action. Always allowed to the LLM role, except
 * that a permission set to `deny` for the role cannot be requested (`requests R52.3`). A blocking request in a plan run
 * soft stops the plan with the reason `waiting for request <id>` (`plan-execution R27.5.1`).
 */
export function sendRequest(ctx: RequestCtx, i: SendInput): RequestResult {
  let needs;
  let destination: RequestCtx;
  let context: { plan: string | null; checkout: string | null };
  try {
    context = requestContext(ctx.root, i.plan);
    destination = destinationCtx(ctx, context.checkout ?? ctx.root);
    needs = actionNeeds(destination.root, i.command, i.params);
  }
  catch (e) {
    if (e instanceof InvalidRequestAction || e instanceof RequestStateError) return { ok: false, lines: [], reasons: [e.message] };
    throw e;
  }
  const g = guard(destination.preset, ctx.actor, needs, "The requested action");
  if (g.kind === "deny") {
    const msg = `Refused: \`${g.permission}\` is denied for the ${ctx.actor.role} role, so no request can be sent for it. Do not look for another way (steering R51).`;
    audit(ctx.root, { command: i.command, args: [], permission: g.permission, outcome: "refused", reason: msg, actor: auditActor(ctx.actor) }, ctx.now);
    return { ok: false, lines: [], reasons: [msg] };
  }
  const rec = holdRequest({ root: destination.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permissions[0] ?? "request.send", command: i.command, params: i.params, reason: i.reason, plan: context.plan, blocking: !!i.blocking && !!context.plan, now: ctx.now, env: ctx.env });
  const lines = [sentMessage(rec)];
  if (i.blocking && context.plan) {
    try {
      stopPlan(destination as PlanCtx, context.plan, { kind: "soft", reason: `waiting for request ${rec.id}`, needs: `the user answers request ${rec.id}` });
      lines.push(`The plan ${context.plan} is soft stopped until the request is answered.`);
    } catch (e) { lines.push(`The plan could not be stopped: ${(e as Error).message.split("\n")[0]}`); }
  }
  return { ok: true, lines, reasons: [], request: rec };
}

/* ------------------------------------------------------------------ list, show */

export function list(root: string): RequestRecord[] { return listRequests(root); }

/** The request with its diff recomputed against the current state (`requests R52.4`). */
export function show(root: string, id: string): (RequestRecord & { warning?: string }) | null {
  const rec = readRequest(root, id);
  if (!rec) return null;
  if (rec.state !== "pending" || rec.action.command !== "spec edit") return rec;
  let destination: string;
  try { destination = requestRoot(root, rec); }
  catch (e) { return { ...rec, diff: null, warning: `Current diff unavailable: ${(e as Error).message}` }; }
  const p = rec.action.params as { spec?: string; patch?: string };
  if (p.spec && p.patch) {
    const diff = specDiffText(destination, p.spec, p.patch);
    return { ...rec, diff, ...(diff === null ? { warning: "Current diff unavailable: the proposed patch no longer applies to the destination text." } : {}) };
  }
  return rec;
}

export function formatRequest(rec: RequestRecord & { warning?: string }, color = false): string {
  const c = (code: number, t: string) => (color ? `\u001b[${code}m${t}\u001b[0m` : t);
  const lines = [
    `${rec.id}  ${rec.state}${rec.blocking ? " (blocking)" : ""}`,
    `From: ${rec.from.role}${rec.from.model ? ` (${rec.from.model})` : ""}`,
    `Action: ${rec.action.command} ${JSON.stringify(rec.action.params).slice(0, 400)}`,
    `Reason: ${rec.reason}`,
    `Needs: ${rec.permissions.join(", ")}`,
  ];
  if (rec.plan) lines.push(`Plan: ${rec.plan}`);
  if (rec.checkout) lines.push(`Checkout: ${rec.checkout}`);
  if (rec.warning) lines.push(rec.warning);
  if (rec.answer) lines.push(`Answered by ${rec.answer.by} on ${rec.answer.date}${rec.answer.note ? `: ${rec.answer.note}` : ""}${rec.answer.error ? ` (failed: ${rec.answer.error})` : ""}`);
  if (rec.diff) {
    lines.push("");
    for (const l of rec.diff.split("\n")) lines.push(l.startsWith("+") && !l.startsWith("+++") ? c(32, l) : l.startsWith("-") && !l.startsWith("---") ? c(31, l) : l);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ accept, decline */

/** Direct callers may inject a preset locally; another destination loads its own committed configuration. */
function destinationCtx(ctx: RequestCtx, root: string): RequestCtx {
  return { ...ctx, root, preset: root === ctx.root ? ctx.preset : activePreset(root) };
}

async function resumeHint(ctx: RequestCtx, rec: RequestRecord): Promise<string | undefined> {
  if (!rec.plan || !rec.blocking) return undefined;
  try {
    const { rec: plan } = requirePlan(ctx as PlanCtx, rec.plan);
    return plan.progress?.status === "stopped" && plan.progress.stop?.reason === `waiting for request ${rec.id}` ? rec.plan : undefined;
  } catch { return undefined; }
}

function refuse(ctx: RequestCtx, rec: RequestRecord | null, id: string, command: string, permission: string | null, msg: string): RequestResult {
  audit(ctx.root, { command, args: [id], permission, outcome: "refused", reason: msg, request: id, actor: auditActor(ctx.actor) }, ctx.now);
  return { ok: false, lines: [], reasons: [msg], request: rec ?? undefined };
}

/**
 * Accept: one answer claim covers the whole lifecycle, so decline and a second accept fail fast. The accepting role must
 * hold every permission the action needs with `allow`, derived from the action and checked now against the permissions
 * in force. A refusal leaves the request pending. The action then runs once as the accepter, with the request id in the
 * audit log.
 */
export async function acceptRequest(ctx: RequestCtx, id: string, note?: string): Promise<RequestResult> {
  const rec = readRequest(ctx.root, id);
  if (!rec) return { ok: false, lines: [], reasons: [`Request \`${id}\` not found.`] };
  if (ctx.actor.kind === "llm") return refuse(ctx, rec, id, "requests accept", null, "Refused: an LLM role cannot accept a request; only the user can (roles-and-permissions R57).");
  let claim;
  try { claim = claimAnswer(ctx.root, id); }
  catch (e) { if (e instanceof RequestStateError) return { ok: false, lines: [], reasons: [e.message], request: rec }; throw e; }
  try {
    // The stored permission list is informational; what accepting needs is derived from the action, now.
    let needs;
    let destination: RequestCtx;
    try {
      destination = destinationCtx(ctx, requestRoot(ctx.root, claim.record));
      needs = actionNeeds(destination.root, claim.record.action.command, claim.record.action.params);
    }
    catch (e) {
      if (e instanceof InvalidRequestAction || e instanceof RequestStateError) return refuse(ctx, rec, id, "requests accept", null, `Cannot accept: ${e.message} The request stays pending.`);
      throw e;
    }
    const g = guard(destination.preset, ctx.actor, needs, "Accepting the request");
    if (g.kind !== "allow") {
      const permission = g.permission;
      return refuse(ctx, rec, id, "requests accept", permission, `Cannot accept: the ${ctx.actor.role} role needs the \`${permission}\` permission with mode allow to do this, and does not have it. The request stays pending.`);
    }
    const run = actionFor(claim.record.action.command);
    if (!run) return refuse(ctx, rec, id, "requests accept", null, `Cannot accept: \`${claim.record.action.command}\` is not an action this version can run.`);
    let outcome: { ok: boolean; lines: string[]; reasons: string[] };
    try { outcome = await run({ ...destination, request: id }, claim.record.action.params); }
    catch (e) { outcome = { ok: false, lines: [], reasons: [(e as Error).message.split("\n")[0]] }; }
    const by = ctx.actor.name;
    const permission = g.permissions[0] ?? null;
    if (!outcome.ok) {
      const error = outcome.reasons.join(" ") || "the action could not be done";
      const failed = claim.answer("failed", { by, date: stamp(ctx), note: note ?? null, error });
      audit(ctx.root, { command: "requests accept", args: [id], permission, outcome: "failed", reason: error, request: id, actor: auditActor(ctx.actor) }, ctx.now);
      return { ok: false, lines: [], reasons: [`The request was accepted but the action could not be done, so it is marked failed and will not be retried: ${error}`], request: failed };
    }
    const done = claim.answer("accepted", { by, date: stamp(ctx), note: note ?? null });
    audit(ctx.root, { command: "requests accept", args: [id], permission, outcome: "done", request: id, actor: auditActor(ctx.actor) }, ctx.now);
    const resume = await resumeHint(ctx, done);
    return { ok: true, lines: [`Accepted ${id}.`, ...outcome.lines, ...(resume ? [`Plan ${resume} was waiting for this answer; resume it with: specplane plan resume ${resume}`] : [])], reasons: [], request: done, resume };
  } finally { claim.release(); }
}

/** Decline: nothing else changes. A person only. */
export async function declineRequest(ctx: RequestCtx, id: string, note?: string): Promise<RequestResult> {
  const rec = readRequest(ctx.root, id);
  if (!rec) return { ok: false, lines: [], reasons: [`Request \`${id}\` not found.`] };
  if (ctx.actor.kind === "llm") return refuse(ctx, rec, id, "requests decline", null, "Refused: an LLM role cannot answer a request.");
  let done: RequestRecord;
  try { done = answerRequest(ctx.root, id, "declined", { by: ctx.actor.name, date: stamp(ctx), note: note ?? null }); }
  catch (e) { if (e instanceof RequestStateError) return { ok: false, lines: [], reasons: [e.message], request: rec }; throw e; }
  audit(ctx.root, { command: "requests decline", args: [id], permission: null, outcome: "done", request: id, actor: auditActor(ctx.actor) }, ctx.now);
  const resume = await resumeHint(ctx, done);
  return { ok: true, lines: [`Declined ${id}. Nothing was changed.`, ...(resume ? [`Plan ${resume} was waiting for this answer; resume it with: specplane plan resume ${resume}`] : [])], reasons: [], request: done, resume };
}
