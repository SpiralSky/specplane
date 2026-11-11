import { requestsAccept, requestsDecline, requestsList, requestsShow } from "../commands/requests.js";
import type { CommandResult } from "../commands/runner.js";
import { specApproveHuman } from "../commands/spec-human.js";
import { validateCommand } from "../commands/validate.js";
import { UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor } from "../perm/permissions.js";
import { guarded, liveRoot, type PlanCtx } from "../plan/ctx.js";
import { startPlan } from "../plan/run.js";
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


const pad = (n: number): string => String(n).padStart(2, "0");

function planCtx(root: string): PlanCtx {
  return { root, actor: cliActor(root), preset: activePreset(root) };
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
    case "spec-assist": return needsArgs(command, "the spec to write or change");
    case "spec-draft-architecture": return needsArgs(command, "the feature specs to draft from");
    case "plan-create": return needsArgs(command, "what the plan is for");
    default: return needsArgs(command, "what to verify, for example an architecture spec ID");
  }
}

async function withArgs(root: string, command: string, args: string[]): Promise<CommandResult> {
  switch (command) {
    case "approve": return specApproveHuman(args, {});
    case "plan-start": {
      const r = startPlan(planCtx(root), args[0]);
      return { ok: true, lines: [`Started ${args[0]} on ${r.branch} (target ${r.target}).`, `Worktree: ${r.path}`] };
    }
    case "plan-status": {
      const infos = plans(root, args[0]);
      return infos.length ? { ok: true, data: infos, lines: infos.map(describe) } : { ok: false, findings: [`Plan \`${args[0]}\` not found.`] };
    }
    case "requests": {
      const [sub, id, ...note] = args;
      if (sub === "list") return requestsList();
      if (!id) throw new UsageError("requests takes list, show <id>, accept <id> or decline <id>.");
      if (sub === "show") return requestsShow(id);
      if (sub === "accept") return requestsAccept(id, note.join(" ") || undefined);
      if (sub === "decline") return requestsDecline(id, note.join(" ") || undefined);
      throw new UsageError("requests takes list, show <id>, accept <id> or decline <id>.");
    }
    default: {
      const pass: PassToLlm = { command, args, instructionKey: command };
      return { ok: true, data: { passToLlm: pass }, lines: [`${command}: passing the arguments and the command's instructions to the assistant.`] };
    }
  }
}

/** Run one harness command as the person who typed it. Refuses anything outside the harness command list. */
export async function runHarnessCommand(command: string, args: string[], root: string = checkoutRoot()): Promise<CommandResult> {
  if (!COMMANDS.includes(command)) throw new UsageError(`Not a harness command: ${command}. The harness commands are: ${COMMANDS.join(", ")}.`);
  const result = args.length === 0 ? await noArgs(root, command) : await withArgs(root, command, args);
  return { ...result, permission: result.permission ?? null };
}

