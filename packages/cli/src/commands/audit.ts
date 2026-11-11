import { readAudit, type AuditLine } from "../audit/read.js";
import { UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard, type Actor } from "../perm/permissions.js";
import type { CommandResult } from "./runner.js";

/** `specplane audit [--since <date>] [--branch <name>] [--actor <role>] [--json]` (`architecture/reference-cli` §9). */

export interface AuditOptions { since?: string; branch?: string; actor?: string }

export function formatEntry(e: AuditLine): string {
  const who = `${e.actor?.role ?? "?"}/${e.actor?.name ?? "?"}`;
  const cmd = [e.command, ...(e.args ?? [])].join(" ");
  return `${e.ts}  ${e.branch}  ${who}  ${cmd}  ${e.outcome}${e.reason ? `: ${e.reason}` : ""}`;
}

export function auditCommand(opts: AuditOptions): CommandResult {
  let since: Date | undefined;
  if (opts.since !== undefined) {
    since = new Date(/^\d{4}-\d{2}-\d{2}$/.test(opts.since) ? `${opts.since}T00:00:00Z` : opts.since);
    if (Number.isNaN(since.getTime())) throw new UsageError(`\`--since ${opts.since}\` is not a date; use YYYY-MM-DD or a full timestamp.`);
  }
  const root = checkoutRoot();
  const actor: Actor = cliActor(root);
  const g = guard(activePreset(root), actor, ["info.retrieve"], "Reading the audit log");
  if (g.kind !== "allow") return { ok: false, findings: [g.kind === "deny" ? g.message : "Reading the audit log needs approval from the user."], permission: "info.retrieve" };
  const { entries, skipped } = readAudit(root, { since, branch: opts.branch, actor: opts.actor });
  return {
    ok: true,
    data: entries,
    lines: entries.length ? entries.map(formatEntry) : ["No audit entries."],
    warnings: skipped ? [`${skipped} audit line${skipped === 1 ? "" : "s"} could not be parsed and ${skipped === 1 ? "was" : "were"} skipped`] : [],
    permission: "info.retrieve",
  };
}
