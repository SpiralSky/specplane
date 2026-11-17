import type { CommandResult } from "./runner.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, type Actor } from "../perm/permissions.js";
import { acceptRequest, cancelRequest, declineRequest, formatRequest, list, pendingFull, show, withSummary, type RequestCtx, type RequestResult } from "../requests/ops.js";
import { manualSessionLines } from "../harness/manual-session.js";
import { withStoreLockAsync } from "../repo/store.js";

/** `specplane requests [list|show|accept|decline|cancel]` (`architecture/reference-cli` §8, §13.1). */

function ctx(): RequestCtx {
  const root = checkoutRoot();
  const actor: Actor = cliActor(root);
  return { root, actor, preset: activePreset(root) };
}

/** `full` lists only the pending requests, each with the details `show` gives (current diff included), in one call. */
export const requestsList = (root: string = checkoutRoot(), full = false): CommandResult => {
  const all = full ? pendingFull(root) : list(root).map(withSummary);
  return { ok: true, data: all, lines: all.length ? all.map((r) => `${r.id}  ${r.state.padEnd(8)}  ${r.from.role}  ${r.summary}  ${r.reason}`) : [full ? "No pending requests." : "No requests."] };
};

export const requestsShow = (id: string, root: string = checkoutRoot()): CommandResult => {
  const rec = show(root, id);
  if (!rec) return { ok: false, findings: [`Request \`${id}\` not found.`] };
  return { ok: true, data: withSummary(rec), lines: [formatRequest(rec, !!process.stdout.isTTY).replace(/\n$/, "")] };
};

function result(r: RequestResult): CommandResult {
  return { ok: r.ok, data: { request: r.request ?? null, resume: r.resume ?? null, ...(r.committed !== undefined ? { committed: r.committed, uncommitted: r.uncommitted ?? [] } : {}) }, findings: r.reasons, lines: r.lines };
}

/**
 * `session` names the plan session a harness opens for an accepted `plan start` (the plan record names it). `manual: false`
 * means the caller opens the session itself; otherwise an accepted `plan start` prints how to open it by hand.
 */
export const requestsAccept = async (id: string, note?: string, o: { session?: string; manual?: boolean; commit?: boolean } = {}): Promise<CommandResult> => {
  const c = ctx();
  if (o.session) c.actor = { ...c.actor, session: o.session };
  const r = result(await withStoreLockAsync(c.root, "commands", () => acceptRequest(c, id, note, { commit: o.commit })));
  const planId = planStartedBy(r);
  return r.ok && planId && o.manual !== false ? { ...r, lines: [...(r.lines ?? []), ...manualSessionLines(c.root, planId)] } : r;
};

/** The plan an accepted `plan start` request started, when the result is one. */
export function planStartedBy(r: CommandResult): string | null {
  const rec = (r.data as { request?: { action?: { command?: string; params?: { id?: unknown } } } | null } | undefined)?.request;
  return r.ok && rec?.action?.command === "plan start" && typeof rec.action.params?.id === "string" ? rec.action.params.id : null;
}

export const requestsDecline = async (id: string, note?: string): Promise<CommandResult> => {
  const c = ctx();
  return result(await declineRequest(c, id, note));
};

export const requestsCancel = async (id: string, note?: string): Promise<CommandResult> => {
  const c = ctx();
  return result(await cancelRequest(c, id, note));
};
