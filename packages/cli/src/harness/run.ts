import { requestsAccept, requestsDecline, requestsList, requestsShow } from "../commands/requests.js";
import type { CommandResult } from "../commands/runner.js";
import { specApproveHuman } from "../commands/spec-human.js";
import { specViewCommand, specViewIndex } from "../commands/spec-view.js";
import { validateCommand } from "../commands/validate.js";
import { PreconditionError, UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor } from "../perm/permissions.js";
import { guarded, liveRoot, type PlanCtx } from "../plan/ctx.js";
import { resumePlan, startPlan } from "../plan/run.js";
import { listInfos, type PlanInfo } from "../plan/status.js";
import { COMMANDS } from "./instructions.js";

/**
 * The user-command runner (`architecture/reference-cli` §12.2, `harness R18`): what the harness hook invokes as
 * `specplane harness run <command> [args]` when the person types a harness command. It runs the matching core
 * function under the person's own role with no model call. It is not a route to the CLI: it refuses a command outside
 * the harness command list. A command that needs the model returns the arguments and the key of its instructions so
 * the adapter can pass both to the LLM (`passToLlm`); with no arguments it never does.
 */

export interface PassToLlm { command: string; args: string[]; instructionKey: string }

/**
 * What a host adapter does to open a plan's session (`architecture/reference-cli` §11.3). It throws a `PreconditionError`
 * naming why and the exact command to run by hand when the host cannot do it; the runner reports that as an error and
 * never substitutes another route (`harness R35.1`).
 */
export interface SessionLauncher {
  readonly name: string;
  newSessionId(): string;
  open(ctx: PlanCtx, planId: string, o: { sessionId: string; resume: boolean }): string[];
}
export interface RunOptions { launcher?: SessionLauncher }


const pad = (n: number): string => String(n).padStart(2, "0");

function planCtx(root: string, sessionId?: string): PlanCtx {
  // The opened session is the plan's session, not the one the person typed the command in.
  const actor = cliActor(root);
  return { root, actor: sessionId ? { ...actor, session: sessionId } : actor, preset: activePreset(root), ...(sessionId ? { env: { ...process.env, SPECPLANE_SESSION: sessionId } } : {}) };
}

/** Open the session through the adapter; a refusal is an error result that still reports what already happened. */
function openSession(ctx: PlanCtx, launcher: SessionLauncher, planId: string, sessionId: string, resume: boolean, done: string[]): CommandResult {
  try { return { ok: true, lines: [...done, ...launcher.open(ctx, planId, { sessionId, resume })] }; }
  catch (e) { return { ok: false, lines: done, findings: e instanceof PreconditionError ? e.reasons : [(e as Error).message] }; }
}

function describe(i: PlanInfo): string {
  const next = i.next ? `next ${pad(i.next.number)} ${i.next.title}${i.next.waiting ? ` (${i.next.waiting})` : ""}` : i.reviewPending ? "final review pending" : "no step left";
  const stop = i.stop?.reason ? ` [${i.stop.reason}]` : "";
  return `${i.id}  ${i.status}${stop}  ${i.stepsDone}/${i.stepsTotal} steps  ${next}`;
}

function plans(root: string, only?: string): PlanInfo[] {
  const ctx = planCtx(root);
  const all = guarded(ctx, "harness run plan-status", [], ["info.retrieve"], "Reading plans", () => listInfos(ctx, true, (id) => liveRoot(ctx, id)));
  return only ? all.filter((i) => i.id === only) : all.filter((i) => !i.archived && !i.legacy);
}

const needsArgs = (command: string, what: string): CommandResult => ({
  ok: true,
  lines: [`${command} works with the assistant, so it needs arguments: ${what}. Nothing ran and no model turn started.`],
});

function noArgs(root: string, command: string): CommandResult | Promise<CommandResult> {
  switch (command) {
    case "validate": return validateCommand([]);
    case "requests": return requestsList();
    case "spec-view": return specViewIndex(root);
    case "plan-status": {
      const infos = plans(root);
      return { ok: true, data: infos, lines: infos.length ? infos.map(describe) : ["No plans."] };
    }
    case "plan-step": {
      const open = plans(root).filter((i) => i.next);
      return {
        ok: true, data: open.map((i) => ({ id: i.id, next: i.next })),
        lines: open.length
          ? [...open.map(describe), "A step runs in the plan's own session (started by plan-start) or with `plan-step <plan-id>`."]
          : ["No plan has a next step."],
      };
    }
    case "approve": return needsArgs(command, "the IDs of the specs or plans to approve");
    case "plan-start": {
      const startable = plans(root).filter((i) => i.status === "not-started");
      return { ok: true, lines: startable.length ? [...startable.map(describe), "Start one with `plan-start <plan-id>`."] : ["No plan is waiting to start."] };
    }
    case "plan-finish": case "plan-abandon": {
      const infos = plans(root);
      return { ok: true, lines: [...(infos.length ? infos.map(describe) : ["No plans."]), `Name a plan to use ${command}.`] };
    }
    case "migrate": return needsArgs(command, "what to migrate from: the folders, documents or code the assistant should read");
    case "decision-new": return needsArgs(command, "what was decided; the assistant writes the record from your description");
    case "spec-assist": return needsArgs(command, "the spec to write or change");
    case "spec-draft-architecture": return needsArgs(command, "the feature specs to draft from");
    case "plan-create": return needsArgs(command, "what the plan is for");
    default: return needsArgs(command, "what to verify, for example an architecture spec ID");
  }
}

async function withArgs(root: string, command: string, args: string[], o: RunOptions): Promise<CommandResult> {
  switch (command) {
    case "approve": return specApproveHuman(args, {});
    case "plan-start": {
      // The session ID is chosen first so the plan record, the run marker and the host session all name the same one.
      const sessionId = o.launcher?.newSessionId();
      const ctx = planCtx(root, sessionId);
      const r = startPlan(ctx, args[0]);
      const started = [`Started ${args[0]} on ${r.branch} (target ${r.target}).`, `Worktree: ${r.path}`];
      return o.launcher ? openSession(ctx, o.launcher, args[0], sessionId!, false, started)
        : { ok: true, lines: [...started, "No harness adapter opens the plan's session here; open one in the worktree and use plan-step."] };
    }
    case "spec-view": return specViewCommand(root, args[0], !!process.stdout.isTTY);
    case "plan-status": {
      const infos = plans(root, args[0]);
      return infos.length ? { ok: true, data: infos, lines: infos.map(describe) } : { ok: false, findings: [`Plan \`${args[0]}\` not found.`] };
    }
    case "requests": {
      const [sub, id, ...note] = args;
      if (sub === "list") return requestsList();
      if (!id) throw new UsageError("requests takes list, show <id>, accept <id> or decline <id>.");
      if (sub === "show") return requestsShow(id);
      if (sub === "accept" || sub === "decline") {
        const answered = await (sub === "accept" ? requestsAccept : requestsDecline)(id, note.join(" ") || undefined);
        // A blocking request answered while a session is active resumes the plan it stopped (`plan-execution R27.5`).
        const planId = (answered.data as { resume?: string | null } | null | undefined)?.resume;
        if (!o.launcher || !planId) return answered;
        const sessionId = o.launcher.newSessionId();
        const ctx = planCtx(root, sessionId);
        try { resumePlan(ctx, planId); } catch (e) { return { ...answered, ok: false, findings: [...(answered.findings ?? []), `Could not resume ${planId}: ${(e as Error).message}`] }; }
        const reopened = openSession(ctx, o.launcher, planId, sessionId, true, [...(answered.lines ?? []), `Resumed ${planId}.`]);
        return { ...answered, ok: answered.ok && reopened.ok, lines: reopened.lines, findings: [...(answered.findings ?? []), ...(reopened.findings ?? [])] };
      }
      throw new UsageError("requests takes list, show <id>, accept <id> or decline <id>.");
    }
    default: {
      const pass: PassToLlm = { command, args, instructionKey: command };
      return { ok: true, data: { passToLlm: pass }, lines: [`${command}: passing the arguments and the command's instructions to the assistant.`] };
    }
  }
}

/** Run one harness command as the person who typed it. Refuses anything outside the harness command list. */
export async function runHarnessCommand(command: string, args: string[], root: string = checkoutRoot(), o: RunOptions = {}): Promise<CommandResult> {
  if (!COMMANDS.includes(command)) throw new UsageError(`Not a harness command: ${command}. The harness commands are: ${COMMANDS.join(", ")}.`);
  const result = args.length === 0 ? await noArgs(root, command) : await withArgs(root, command, args, o);
  return { ...result, permission: result.permission ?? null };
}

