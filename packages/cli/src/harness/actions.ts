import { createAjv } from "../ajv.js";
import { activePreset, guard, type Actor } from "../perm/permissions.js";
import { listPermissions, describePermission } from "../perm/docs.js";
import { approveSpecs, metaGet, type Ctx } from "../spec/human.js";
import { prepareDecision, retrieveDecisions, writeDecision } from "../decisions/decisions.js";
import { prepareSpecChange, specLayer, writeSpecification } from "../spec/write.js";
import { headContext } from "../verify/implementation.js";
import { computeCoverage } from "../verify/coverage.js";
import { validateProject } from "../verify/validate.js";
import { collectWarnings, narrowWarnings, type Warning } from "../verify/warnings.js";
import { listSpecViews } from "../commands/spec-read.js";
import { loadSettings } from "../config.js";
import { configGet } from "../config-ops.js";
import { readAudit } from "../audit/read.js";
import { audit } from "../audit/log.js";
import { pruneAudit } from "../audit/retention.js";
import { RequestSent, holdRequest } from "../requests/hold.js";
import { retrieveSpecs, reviewContext } from "./retrieve.js";
import type { ActionContext, HarnessAction } from "./action-types.js";
import { bool, str, strings, type Input, type Schema, type Adder } from "./action-types.js";
import { registerOperationActions } from "./actions-ops.js";
import { registerPlanActions } from "./actions-plan.js";
import { deliver, type InstructionDelivery, type InstructionSession } from "./instructions.js";

const object = (properties: Schema, required: string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
const registry = new Map<string, HarnessAction>();
const ajv = createAjv();
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
const add: Adder = (id, properties, required, permissions, readOnly, handler) => {
  const inputSchema = object(properties, required);
  registry.set(id, { id, inputSchema, permissions: typeof permissions === "function" ? permissions : () => permissions, readOnly, handler });
  validators.set(id, ajv.compile(inputSchema));
};
const info = ["info.retrieve"];
const retrieval = { ids: strings, include_references: bool };
add("spec.retrieve", retrieval, ["ids"], info, true, (c, p) => retrieveSpecs(c.root, p.ids, p.include_references));
add("spec.review-context", retrieval, ["ids"], info, true, (c, p) => reviewContext(c.root, p.ids, p.include_references));
add("spec.list", { status: { enum: ["approved", "awaiting-review"] }, type: { enum: ["requirement", "feature", "architecture"] } }, [], info, true, (c, p) => listSpecViews(c.root, p));
add("spec.meta.read", { spec: str }, ["spec"], ["meta.read"], true, (c, p) => metaGet(c, p.spec));
for (const operation of ["create", "edit", "delete"] as const) {
  const props = operation === "delete" ? { spec: str } : { spec: str, text: { type: "string" }, contribution: str, ...(operation === "edit" ? { section: str } : {}) };
  add(`spec.${operation}`, props, operation === "delete" ? ["spec"] : ["spec", "text"], (p) => [`spec.${operation}.${specLayer(p.spec)}`], false,
    (c, p) => writeSpecification(c, operation, prepareSpecChange(c, operation, p as { spec: string })));
}
const decisionFields = { title: str, decision: str, context: str, reasons: { type: "string" }, concerns: { type: "array", items: str, uniqueItems: true }, date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, contribution: str };
// Decision records (`later-releases R37`): the LLM stores one only after the user decided in the conversation; steering says so.
add("decision.add", decisionFields, ["title", "decision", "context"], ["decision.add"], false, (c, p) => writeDecision(c, "add", prepareDecision(c, "add", p)));
add("decision.retrieve", { id: str, query: str, concerns: str }, [], ["decision.retrieve"], true, (c, p) => retrieveDecisions(c, p));
add("decision.edit", { id: str, ...decisionFields }, ["id"], ["decision.edit"], false, (c, p) => writeDecision(c, "edit", prepareDecision(c, "edit", p)));
add("decision.delete", { id: str }, ["id"], ["decision.delete"], false, (c, p) => writeDecision(c, "delete", prepareDecision(c, "delete", p)));
add("spec.approve", { ids: strings }, ["ids"], ["spec.approve"], false, (c, p) => approveSpecs(c, p.ids, { yes: true }));
add("validate", { ids: strings }, [], info, true, (c, p) => { const r = validateProject(c.root, p); return { ...r, ok: r.counts.errors === 0 }; });
add("warnings", { id: str }, [], info, true, (c, p) => { const all = [...collectWarnings(c.root), ...c.sessionWarnings]; return p.id ? narrowWarnings(all, p.id) : all; });
add("coverage", {}, [], info, true, (c) => computeCoverage(headContext(c.root).project, loadSettings(c.root).config.values["coverage.requirement_only"] as string[]));
add("config.get", { key: str }, [], info, true, (c, p) => configGet(c.root, p.key));
// Permission documentation remains readable even when info.retrieve is denied (U0 / §7.3).
add("permissions.docs", { permission: str }, [], [], true, (c, p) => p.permission ? describePermission(c.root, p.permission, c.actor.role) : listPermissions(c.root, c.actor.role));
add("audit.read", { since: str, branch: str, actor: str }, [], info, true, (c, p) => {
  const since = p.since ? new Date(p.since) : undefined;
  if (since && !Number.isFinite(since.getTime())) throw new Error("Invalid audit date.");
  return readAudit(c.root, { ...p, since });
});
add("warnings.report", { text: str, subject: { enum: ["spec", "plan", "permission", "installation"] }, why: str, ref: str }, ["text", "subject", "why"], [], false, (c, p) => {
  c.sessionWarnings.push({ text: p.text, subject: p.subject, why: p.why, ...(p.ref ? { ref: p.ref } : {}) });
  return { reported: true };
});

registerOperationActions(add);
registerPlanActions(add);

export type { HarnessAction };
export function listActions(): readonly HarnessAction[] { return [...registry.values()]; }
export function validateActionInput(id: string, input: unknown): HarnessAction {
  const action = registry.get(id);
  if (!action) throw new Error(`Unknown harness action: ${id}`);
  const check = validators.get(id)!;
  if (!check(input)) throw new Error(`Invalid input for ${id}: ${ajv.errorsText(check.errors)}`);
  return action;
}

/** Only the request runner calls this; re-derive permissions and validate the schema on acceptance. */
export async function acceptedRead(ctx: Ctx, id: string, input: unknown): Promise<unknown> {
  const action = validateActionInput(id, input);
  if (!action.readOnly) throw new Error("Only read actions use harness read requests.");
  const g = guard(ctx.preset, ctx.actor, action.permissions(input as Input), id);
  if (g.kind !== "allow") throw new Error(`Reading ${id} requires allow.`);
  return action.handler({ ...ctx, sessionWarnings: [] }, input as Input);
}

export interface ActionReply {
  ok: boolean; data?: unknown; findings: string[]; instructions: InstructionDelivery[];
  request?: string; warningCount?: number | null;
}
export interface ActionSession extends InstructionSession { measurable?: string[]; launcher?: ActionContext["launcher"]; model?: string; delegatedBy?: string; command?: string; now?: Date }

/** A runtime belongs to exactly one adapter session. Actor identity never comes from tool input. */
export function createActionRuntime(session: ActionSession) {
  const sessionWarnings: Warning[] = [];
  const actor: Actor = { role: "llm", kind: "llm", name: session.model || "unknown", model: session.model || "unknown", session: session.id, delegatedBy: session.delegatedBy };
  return {
    async call(id: string, input: unknown): Promise<ActionReply> {
      const reply: ActionReply = { ok: false, findings: [], instructions: [] };
      let permissions: string[] = [];
      try {
        const action = validateActionInput(id, input);
        const p = input as Input;
        const ctx: ActionContext = { root: session.root, actor, preset: activePreset(session.root), now: session.now, sessionWarnings, ...(session.measurable ? { measurable: session.measurable } : {}), ...(session.launcher ? { launcher: session.launcher } : {}) };
        permissions = action.permissions(p);
        try { pruneAudit(ctx.root, loadSettings(ctx.root).config.auditRetention, { actor }); } catch { /* audit is best effort */ }
        reply.instructions = [...(session.command ? [session.command] : []), ...permissions].map((key) => deliver(session, key));
        if (reply.instructions.some((i) => i.status === "unavailable")) throw new Error("Required instructions could not be delivered.");
        const g = guard(ctx.preset, actor, permissions, id);
        if (g.kind === "deny") throw new Error(g.message);
        if (g.kind === "request" && action.readOnly) {
          const rec = holdRequest({ root: ctx.root, actor, permissions: g.permissions, decidedBy: g.permission,
            command: "harness read", params: { id, input }, reason: `Read through ${id}`, now: session.now });
          reply.request = rec.id;
          reply.ok = true;
        } else {
          // Write cores prepare exact changes and create their own requests under request-user.
          const data = await action.handler(ctx, p);
          reply.data = data;
          const r = data as { ok?: boolean; request?: string; reasons?: string[] } | null;
          reply.ok = r?.ok !== false;
          reply.request = r?.request;
          reply.findings = r?.reasons ?? [];
        }
      } catch (e) {
        if (e instanceof RequestSent) { reply.ok = true; reply.request = e.request.id; }
        else reply.findings.push(e instanceof Error ? e.message : String(e));
      }
      audit(session.root, { command: id, args: [], permission: permissions[0] ?? null, actor,
        outcome: reply.request ? "request-sent" : reply.ok ? "done" : "refused", reason: reply.findings[0], request: reply.request }, session.now);
      if (loadSettings(session.root).config.autoWarn) {
        try { reply.warningCount = collectWarnings(session.root).length + sessionWarnings.length; } catch { reply.warningCount = null; }
      }
      return reply;
    },
  };
}
