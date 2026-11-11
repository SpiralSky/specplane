import type { CommandResult } from "./runner.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliRole, gitUserName, type Actor } from "../perm/permissions.js";
import { acceptRequest, declineRequest, formatRequest, list, show, type RequestCtx, type RequestResult } from "../requests/ops.js";
import { withCheckoutLeaseAsync } from "../core/checkout-coordination.js";

/** `specplane requests [list|show|accept|decline]` (`architecture/reference-cli` §8, §13.1). */

function ctx(): RequestCtx {
  const root = checkoutRoot();
  const actor: Actor = { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown" };
  return { root, actor, preset: activePreset(root) };
}

export const requestsList = (): CommandResult => {
  const all = list(checkoutRoot());
  return { ok: true, data: all, lines: all.length ? all.map((r) => `${r.id}  ${r.state.padEnd(8)}  ${r.from.role}  ${r.action.command}  ${r.reason}`) : ["No requests."] };
};

export const requestsShow = (id: string): CommandResult => {
  const rec = show(checkoutRoot(), id);
  if (!rec) return { ok: false, findings: [`Request \`${id}\` not found.`] };
  return { ok: true, data: rec, lines: [formatRequest(rec, !!process.stdout.isTTY).replace(/\n$/, "")] };
};

function result(r: RequestResult): CommandResult {
  return { ok: r.ok, data: { request: r.request ?? null, resume: r.resume ?? null }, findings: r.reasons, lines: r.lines };
}

export const requestsAccept = async (id: string, note?: string): Promise<CommandResult> => {
  const c = ctx();
  return result(await withCheckoutLeaseAsync(c.root, "requests-accept", false, () => acceptRequest(c, id, note)));
};

export const requestsDecline = async (id: string, note?: string): Promise<CommandResult> => {
  const c = ctx();
  return result(await declineRequest(c, id, note));
};
