import * as readline from "node:readline";
import { withCheckoutLease, withCheckoutLeaseAsync } from "../core/checkout-coordination.js";
import { audit } from "../audit/log.js";
import { UsageError } from "../errors.js";
import type { CommandResult } from "./runner.js";
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

function result(r: Result, data?: unknown): CommandResult {
  return { ok: r.ok, data: data ?? { written: r.written, commit: r.commit }, findings: r.reasons, warnings: r.warnings, lines: r.lines };
}

function askYesNo(members: string[]): Promise<boolean> {
  process.stdout.write(`These specifications reference each other and are approved together as one group:\n${members.map((m) => `  ${m}`).join("\n")}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question("Approve all of them? [y/N] ", (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}

interface Common { commit?: boolean }

export const specApproveHuman = async (ids: string[], opts: Common & { yes?: boolean; ref?: string }): Promise<CommandResult> => {
  const c = context();
  return result(await withCheckoutLeaseAsync(c.root, "spec-approve", false, () => approveSpecs(c, ids, { yes: opts.yes, ref: opts.ref, interactive: !!process.stdin.isTTY && !!process.stdout.isTTY, ask: askYesNo })));
};

export const specReopenHuman = (id: string): CommandResult => {
  const c = context();
  return result(withCheckoutLease(c.root, "spec-reopen", false, () => reopenSpec(c, id)));
};

export const specMetaGetHuman = (id: string): CommandResult => {
  const r = metaGet(context(), id);
  return result(r, r.data);
};

export const specMetaSetHuman = (id: string, field: string, value: string, opts: Common): CommandResult => {
  const c = context();
  return result(withCheckoutLease(c.root, "spec-meta", false, () => metaSet(c, id, field, value, { noCommit: opts.commit === false })));
};

export const specOverrideHuman = (kind: OverrideKind, id: string, args: string[], opts: { summary?: string }): CommandResult => {
  const c = context();
  return result(withCheckoutLease(c.root, "spec-override", false, () => overrideSpec(c, kind, id, args, { summary: opts.summary })));
};

export const roleShowHuman = (): CommandResult => ({ ok: true, data: { role: cliRole(checkoutRoot()) }, lines: [cliRole(checkoutRoot())] });
export const roleSwitchHuman = (role: string): CommandResult => {
  if (role !== "administrator" && role !== "standard-user") throw new UsageError("role must be `administrator` or `standard-user`");
  const root = checkoutRoot();
  const actor: Actor = { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown" };
  switchRole(root, role, actor);
  audit(root, { command: "role switch", args: [role], permission: null, outcome: "done", actor: { role: actor.role, kind: actor.kind, name: actor.name }, new: { role } });
  return { ok: true, data: { role }, lines: [`CLI calls on this machine now run as ${role}.`] };
};

const none = { reasons: [], commit: null, warnings: [], written: [] };

/** `specplane sync [<remote>]`: fetch, merge, push the notes ref, guarded by `info.retrieve` (`reference-cli` §5.6). */
export const syncHuman = (remote: string | undefined): CommandResult => {
  const c = context();
  const g = guard(c.preset, c.actor, ["info.retrieve"], "Syncing the notes store");
  if (g.kind !== "allow") return result({ ok: false, lines: [], ...none, reasons: [g.kind === "deny" ? g.message : "Syncing needs approval from the user."] });
  const lines = syncNotes(c.root, remote);
  audit(c.root, { command: "sync", args: remote ? [remote] : [], permission: "info.retrieve", outcome: "done", actor: { role: c.actor.role, kind: c.actor.kind, name: c.actor.name } });
  return result({ ok: true, lines, ...none }, { lines });
};

/** `specplane migrate status [--dry-run]`: move frontmatter records to the notes store (`reference-cli` §5.7). */
export const migrateStatusHuman = (opts: { dryRun?: boolean }): CommandResult => {
  const c = context();
  const g = guard(c.preset, c.actor, ["config.change"], "Migrating status records");
  if (g.kind !== "allow") return result({ ok: false, lines: [], ...none, reasons: [g.kind === "deny" ? g.message : "Migrating needs approval from the user."] });
  const r = withCheckoutLease(c.root, "migrate-status", false, () => migrateStatus(c.root, { dryRun: opts.dryRun }));
  if (!opts.dryRun) audit(c.root, { command: "migrate status", args: [], permission: "config.change", outcome: "done", actor: { role: c.actor.role, kind: c.actor.kind, name: c.actor.name }, new: { records: r.items.length, files: r.files } });
  return result({ ok: true, lines: formatMigration(r), reasons: [], commit: r.commit, warnings: r.warnings, written: r.files });
};
