import { type Caller } from "./caller.js";
import { type LlmFactors } from "../perm/llm-rules.js";
import { createAjv } from "../ajv.js";
import { activePreset, guard, type Actor } from "../perm/permissions.js";
import { resolveLlmRole, resolveSubagentRole } from "../perm/llm-rules.js";
import { roleList, roleShow, ruleList } from "../perm/role-ops.js";
import { listPermissions, describePermission } from "../perm/docs.js";
import { approvalNeeds, approveSpecs, metaGet, type Ctx } from "../spec/human.js";
import { prepareDecision, retrieveDecisions, writeDecision } from "../decisions/decisions.js";
import { prepareSpecChange, specLayer, writeSpecification } from "../spec/write.js";
import { headContext } from "../verify/implementation.js";
import { computeCoverage } from "../verify/coverage.js";
import { refreshNote } from "./refresh.js";
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
import { COMMANDS, deliver, type InstructionDelivery, type InstructionSession } from "./instructions.js";
import { activeCommand, beginCommand } from "./active-command.js";

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
// Session control, like instruction delivery: no project content or permission is changed.
add("command.begin", { command: { enum: COMMANDS } }, ["command"], [], true, (c, p) => {
  beginCommand(c.root, c.actor.session!, p.command);
  return { command: p.command };
});
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
// Roles and LLM role rules are readable by the LLM (`R44.1`, `R54`); changing them is for people, through the CLI.
add("role.list", {}, [], info, true, (c) => ({ roles: roleList(c.root), rules: ruleList(c.root) }));
add("role.show", { id: str }, ["id"], info, true, (c, p) => roleShow(c.root, p.id));
add("spec.approve", { ids: strings }, ["ids"], (p, root) => root ? approvalNeeds(root, p.ids).needs : ["spec.approve.feature"], false, (c, p) => approveSpecs(c, p.ids, { yes: true }));
add("validate", { ids: strings }, [], info, true, (c, p) => { const note = refreshNote(c.root); const r = validateProject(c.root, p); return { ...r, ok: r.counts.errors === 0, ...note }; });
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
  const g = guard(ctx.preset, ctx.actor, action.permissions(input as Input, ctx.root), id);
  if (g.kind !== "allow") throw new Error(`Reading ${id} requires allow.`);
  return action.handler({ ...ctx, sessionWarnings: [] }, input as Input);
}

export interface ActionReply {
  ok: boolean; data?: unknown; findings: string[]; instructions: InstructionDelivery[];
  request?: string; warningCount?: number | null;
}
export interface ActionSession extends InstructionSession { measurable?: string[]; launcher?: ActionContext["launcher"]; adapter?: string; model?: string; delegatedBy?: string; provider?: string; agentType?: string; subagent?: string; command?: string; now?: Date }

/** A runtime belongs to exactly one adapter session. Actor identity never comes from tool input. */
export function createActionRuntime(session: ActionSession) {
  if (session.command) beginCommand(session.root, session.id, session.command);
  const sessionWarnings: Warning[] = [];
  return {
    /** `model` is the model of this one call when the host reports it per call (the session server); otherwise the session's. */
    async call(id: string, input: unknown, caller?: Caller, callModel?: string): Promise<ActionReply> {
      const model = callModel || session.model;
      const base: Actor = { role: "llm", kind: "llm", name: model || "unknown", model: model || "unknown", session: session.id, delegatedBy: session.delegatedBy };
      // What the harness knows about this LLM, matched by the LLM role rules (`R44.1`); never taken from tool input.
      const factors = { ...(session.subagent ? { subagent: session.subagent } : {}), ...(session.agentType ? { agent_type: session.agentType } : {}), ...(session.provider ? { provider: session.provider } : {}), ...(model ? { model } : {}), delegated: !!session.delegatedBy };
      const reply: ActionReply = { ok: false, findings: [], instructions: [] };
      // The host's record of who made this call overrides the session's factors (`R58`): a subagent is the agent type
      // when it has an ID; an agent type alone (a session started with `--agent`) sets only `agent_type`.
      const callFactors: LlmFactors = { ...factors, ...(caller?.agentType ? { agent_type: caller.agentType } : {}),
        ...(caller?.agentId ? { delegated: true, ...(caller.agentType ? { subagent: caller.agentType } : {}) } : {}) };
      const actor: Actor = { ...base, ...(caller?.agentId ? { delegatedBy: base.delegatedBy ?? session.id } : {}), ...(caller?.agentType ? { agentType: caller.agentType } : {}),
        ...(caller?.agentId ? { agentId: caller.agentId } : {}), // A subagent inherits the session's role unless a rule about the subagent itself overrides it (`R42.1`).
        role: caller?.agentId ? resolveSubagentRole(session.root, callFactors, factors) : resolveLlmRole(session.root, callFactors) };
      let permissions: string[] = [];
      let answerOutcome: "done" | "refused" | "failed" | undefined;
      try {
        const action = validateActionInput(id, input);
        const p = input as Input;
        const command = activeCommand(session.root, session.id);
        // test.run also records results and executes arbitrary project commands despite its read permission.
        const isRead = (a: HarnessAction) => a.readOnly && a.id !== "test.run";
        const decisionRequest = id === "request.send" && p.command === "decision add";
        const readRequest = id === "request.send" && p.command === "harness read" &&
          registry.has(p.params?.id) && p.params.id !== "command.begin" && isRead(registry.get(p.params.id)!);
        if (command === "spec-review" && !isRead(action) && id !== "decision.add" && !decisionRequest && !readRequest) {
          throw new Error(`Spec review is read-only; ${id} is refused. Only storing user decision records is permitted.`);
        }
        const ctx: ActionContext = { root: session.root, actor, preset: activePreset(session.root), now: session.now, sessionWarnings, ...(session.measurable ? { measurable: session.measurable } : {}), ...(session.launcher ? { launcher: session.launcher } : {}), ...(session.adapter ? { adapter: session.adapter } : {}) };
        permissions = action.permissions(p, session.root);
        try { pruneAudit(ctx.root, loadSettings(ctx.root).config.auditRetention, { actor }); } catch { /* audit is best effort */ }
        const instructionCommand = id === "command.begin" ? p.command : command;
        reply.instructions = [...(instructionCommand ? [instructionCommand] : []), ...permissions].map((key) => deliver(session, key, { role: actor.role }));
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
          const r = data as { ok?: boolean; request?: string; reasons?: string[]; state?: string } | null;
          if (id === "request.accept" || id === "request.decline" || id === "request.cancel") answerOutcome = r?.ok === false ? (r.state === "failed" ? "failed" : "refused") : "done";
          reply.ok = r?.ok !== false;
          reply.request = r?.request;
          reply.findings = r?.reasons ?? [];
        }
      } catch (e) {
        if (e instanceof RequestSent) { reply.ok = true; reply.request = e.request.id; }
        else reply.findings.push(e instanceof Error ? e.message : String(e));
      }
      audit(session.root, { command: id, args: [], permission: permissions[0] ?? null, actor,
        outcome: answerOutcome ?? (reply.request ? "request-sent" : reply.ok ? "done" : "refused"), reason: reply.findings[0], request: reply.request }, session.now);
      if (loadSettings(session.root).config.autoWarn) {
        try { reply.warningCount = collectWarnings(session.root).length + sessionWarnings.length; } catch { reply.warningCount = null; }
      }
      return reply;
    },
  };
}
