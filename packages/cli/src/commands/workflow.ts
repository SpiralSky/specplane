import { createInterface } from "node:readline/promises";
import { listRetainedHostLeases, recoverRetainedHostLease, checkoutIdentity, LeaseRefused, type LeaseRecoveryIo } from "../core/writer-leases.js";
import { SpecplaneError } from "../errors.js";

/** D20 item 6 (spec: A3, R1), PROVISIONAL on one point only (A3 says `recover` restores recording files and `list` prints the workflow; R1 and this build do not; unresolved, see HANDOFF): operator commands for leases left by an ended host session. */
class RecoveryRefusal extends SpecplaneError {
  readonly exitCode = 1;
}
const commonDir = (cwd: string) => checkoutIdentity(cwd).commonDir;

export function workflowListCommand(opts: { json?: boolean }, cwd = process.cwd(), out: (s: string) => void = (s) => process.stdout.write(s)): void {
  const leases = listRetainedHostLeases(commonDir(cwd)).map(({ binding: _b, ...rest }) => rest);
  if (opts.json) { out(`${JSON.stringify(leases)}\n`); return; }
  if (leases.length === 0) { out("No leases are retained with host-worker evidence.\n"); return; }
  for (const l of leases)
    out(`${l.requestId ?? "(unidentified)"}\towner ${l.ownerPid ?? "?"} ${l.ownerAlive === null ? "unknown" : l.ownerAlive ? "alive" : "dead"}\tage ${l.ageSeconds}s\t${l.state}${l.reason ? ` (${l.reason})` : ""}\t${l.checkouts.join(",")}\n`);
}

export function terminalIo(): LeaseRecoveryIo {
  return {
    isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    ask: async (q) => { const rl = createInterface({ input: process.stdin, output: process.stderr }); try { return await rl.question(q); } finally { rl.close(); } },
    print: (line) => process.stdout.write(`${line}\n`),
  };
}

export async function workflowRecoverCommand(requestId: string, opts: { dryRun?: boolean; json?: boolean }, cwd = process.cwd(), io: LeaseRecoveryIo = terminalIo()): Promise<void> {
  try {
    const result = await recoverRetainedHostLease(commonDir(cwd), requestId, opts.json ? { ...io, print: () => {} } : io, { dryRun: opts.dryRun });
    if (opts.json) process.stdout.write(`${JSON.stringify({ requestId, ...result })}\n`);
  } catch (e) {
    if (e instanceof LeaseRefused) throw new RecoveryRefusal(e.message);
    throw e;
  }
}
