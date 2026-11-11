import { reportError } from "../errors.js";
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

const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);

async function guarded(fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); } catch (e) { if (!reportError(e)) throw e; }
}

export const requestsList = (opts: { json?: boolean }) => guarded(() => {
  const all = list(checkoutRoot());
  if (opts.json) { out(JSON.stringify({ ok: true, data: all, findings: [], warnings: [] })); return; }
  if (!all.length) { out("No requests."); return; }
  for (const r of all) out(`${r.id}  ${r.state.padEnd(8)}  ${r.from.role}  ${r.action.command}  ${r.reason}`);
});

export const requestsShow = (id: string, opts: { json?: boolean }) => guarded(() => {
  const rec = show(checkoutRoot(), id);
  if (!rec) { process.stderr.write(`Request \`${id}\` not found.\n`); process.exitCode = 1; return; }
  if (opts.json) out(JSON.stringify({ ok: true, data: rec, findings: [], warnings: [] }));
  else out(formatRequest(rec, !!process.stdout.isTTY));
});

function print(r: RequestResult, json?: boolean): void {
  if (json) out(JSON.stringify({ ok: r.ok, data: { request: r.request ?? null, resume: r.resume ?? null }, findings: r.reasons, warnings: [] }));
  else { for (const l of r.lines) out(l); for (const x of r.reasons) process.stderr.write(`${x}\n`); }
  if (!r.ok) process.exitCode = 1;
}

export const requestsAccept = (id: string, opts: { json?: boolean; note?: string }) => guarded(async () => {
  const c = ctx();
  print(await withCheckoutLeaseAsync(c.root, "requests-accept", false, () => acceptRequest(c, id, opts.note)), opts.json);
});

export const requestsDecline = (id: string, opts: { json?: boolean; note?: string }) => guarded(async () => {
  const c = ctx();
  print(await declineRequest(c, id, opts.note), opts.json);
});
