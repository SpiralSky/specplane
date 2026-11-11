import * as readline from "node:readline";
import { withCheckoutLease, withCheckoutLeaseAsync } from "../core/checkout-coordination.js";
import { audit } from "../audit/log.js";
import { reportError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliRole, gitUserName, guard, switchRole, type Actor } from "../perm/permissions.js";
import { formatMigration, migrateStatus } from "../spec/migrate.js";
import { syncNotes } from "../spec/sync.js";
import { approveSpecs, metaGet, metaSet, overrideSpec, reopenSpec, type Ctx, type OverrideKind, type Result } from "../spec/human.js";

/** Human CLI commands: approval, reopen, metadata and overrides (`architecture/reference-cli` §13). */

function context(): Ctx {
  const root = checkoutRoot();
  const actor: Actor = { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown" };
  return { root, actor, preset: activePreset(root) };
}

/** Exit status: 0 success, 1 a refused action (`reference-cli` §13.3). */
function print(r: Result, json?: boolean, extra?: unknown): void {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: r.ok, data: extra ?? { written: r.written, commit: r.commit }, findings: r.reasons, warnings: r.warnings }) + "\n");
  } else {
    for (const l of r.lines) process.stdout.write(`${l}\n`);
    for (const reason of r.reasons) process.stderr.write(`${reason}\n`);
  }
  if (!r.ok) process.exitCode = 1;
}

async function guarded(fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); } catch (e) { if (!reportError(e)) throw e; }
}

function askYesNo(members: string[]): Promise<boolean> {
  process.stdout.write(`These specifications reference each other and are approved together as one group:\n${members.map((m) => `  ${m}`).join("\n")}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question("Approve all of them? [y/N] ", (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}

interface Common { json?: boolean; commit?: boolean }

export const specApproveHuman = (ids: string[], opts: Common & { yes?: boolean; ref?: string }) => guarded(async () => {
  const c = context();
  print(await withCheckoutLeaseAsync(c.root, "spec-approve", false, () => approveSpecs(c, ids, { yes: opts.yes, ref: opts.ref, interactive: !!process.stdin.isTTY && !!process.stdout.isTTY, ask: askYesNo })), opts.json);
});

export const specReopenHuman = (id: string, opts: Common) => guarded(() => {
  const c = context();
  print(withCheckoutLease(c.root, "spec-reopen", false, () => reopenSpec(c, id)), opts.json);
});

export const specMetaGetHuman = (id: string, opts: Common) => guarded(() => {
  const r = metaGet(context(), id);
  print(r, opts.json, r.data);
});

export const specMetaSetHuman = (id: string, field: string, value: string, opts: Common) => guarded(() => {
  const c = context();
  print(withCheckoutLease(c.root, "spec-meta", false, () => metaSet(c, id, field, value, { noCommit: opts.commit === false })), opts.json);
});

export const specOverrideHuman = (kind: OverrideKind, id: string, args: string[], opts: Common & { summary?: string }) => guarded(() => {
  const c = context();
  print(withCheckoutLease(c.root, "spec-override", false, () => overrideSpec(c, kind, id, args, { noCommit: opts.commit === false, summary: opts.summary })), opts.json);
});

export const roleShowHuman = () => guarded(() => { process.stdout.write(`${cliRole(checkoutRoot())}\n`); });
export const roleSwitchHuman = (role: string) => guarded(() => {
  if (role !== "administrator" && role !== "standard-user") { process.stderr.write("role must be `administrator` or `standard-user`\n"); process.exitCode = 2; return; }
  const root = checkoutRoot();
  const actor: Actor = { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown" };
  switchRole(root, role, actor);
  audit(root, { command: "role switch", args: [role], permission: null, outcome: "done", actor: { role: actor.role, kind: actor.kind, name: actor.name }, new: { role } });
  process.stdout.write(`CLI calls on this machine now run as ${role}.\n`);
});

/** `specplane sync [<remote>]`: fetch, merge, push the notes ref, guarded by `info.retrieve` (`reference-cli` §5.6). */
export const syncHuman = (remote: string | undefined, opts: { json?: boolean }) => guarded(() => {
  const c = context();
  const g = guard(c.preset, c.actor, ["info.retrieve"], "Syncing the notes store");
  if (g.kind !== "allow") { print({ ok: false, lines: [], reasons: [g.kind === "deny" ? g.message : "Syncing needs approval from the user."], commit: null, warnings: [], written: [] }, opts.json); return; }
  const lines = syncNotes(c.root, remote);
  audit(c.root, { command: "sync", args: remote ? [remote] : [], permission: "info.retrieve", outcome: "done", actor: { role: c.actor.role, kind: c.actor.kind, name: c.actor.name } });
  print({ ok: true, lines, reasons: [], commit: null, warnings: [], written: [] }, opts.json, { lines });
});

/** `specplane migrate status [--dry-run]`: move frontmatter records to the notes store (`reference-cli` §5.7). */
export const migrateStatusHuman = (opts: { dryRun?: boolean; json?: boolean }) => guarded(() => {
  const c = context();
  const g = guard(c.preset, c.actor, ["config.change"], "Migrating status records");
  if (g.kind !== "allow") { print({ ok: false, lines: [], reasons: [g.kind === "deny" ? g.message : "Migrating needs approval from the user."], commit: null, warnings: [], written: [] }, opts.json); return; }
  const r = withCheckoutLease(c.root, "migrate-status", false, () => migrateStatus(c.root, { dryRun: opts.dryRun }));
  if (!opts.dryRun) audit(c.root, { command: "migrate status", args: [], permission: "config.change", outcome: "done", actor: { role: c.actor.role, kind: c.actor.kind, name: c.actor.name }, new: { records: r.items.length, files: r.files } });
  print({ ok: true, lines: formatMigration(r), reasons: [], commit: r.commit, warnings: r.warnings, written: r.files }, opts.json);
});
