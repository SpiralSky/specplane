import { audit, auditAppendFailed, auditedCommands, resetAuditState, type AuditActor, type AuditOutcome } from "../audit/log.js";
import { pruneAudit } from "../audit/retention.js";
import { loadSettings } from "../config.js";
import { FormatError, NotARepoError, PreconditionError, SpecplaneError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { formatJson } from "../output/json.js";
import { formatText } from "../output/text.js";
import { cliActor } from "../perm/permissions.js";
import { RequestSent } from "../requests/hold.js";
import { collectWarnings } from "../verify/warnings.js";

/**
 * The command runner (`architecture/reference-cli` §13.3, §9): every command returns a `CommandResult`; the runner
 * prints it as text or JSON, maps errors to exit codes 0 to 4, runs audit retention first and writes the audit entry.
 */

export interface CommandResult {
  ok: boolean;
  data?: unknown;
  /** Reasons an action was refused or content failed; text output prints strings on stderr. */
  findings?: unknown[];
  warnings?: string[];
  /** The human text, one line per entry, printed on stdout. */
  lines?: string[];
  /** Number of project warnings (auto warn, `reference-cli` §6.3); set by the runner, never by a command. */
  warningCount?: number | null;
  /** The action was held as a request; exit 0. */
  held?: boolean;
  /** Permission that guarded the command, for the audit entry. */
  permission?: string | null;
}

export interface RunSpec {
  /** Audit command name, for example `spec approve`. */
  command: string;
  args?: string[];
  json?: boolean;
  /** Test hook: replaces the warnings collector the auto-warn line uses. */
  collect?: (root: string, opts: { auditUnwritable: boolean }) => unknown[];
}

export type ExitCode = 0 | 1 | 2 | 3 | 4;

/** Exit status 130 on an interrupt, the shell convention; the audit entry says `cancelled`. */
export const INTERRUPTED = 130;

function actorOf(root: string): AuditActor {
  try { return cliActor(root); } catch { return { role: "standard-user", kind: "human", name: "unknown" }; }
}

function errorResult(e: unknown): { result: CommandResult; exit: ExitCode } {
  if (e instanceof RequestSent) return { result: { ok: true, held: true, lines: [e.message], data: { request: e.request.id } }, exit: 0 };
  if (e instanceof NotARepoError) return { result: { ok: false, findings: [`${e.message}. Run specplane inside a git repository.`] }, exit: 3 };
  if (e instanceof SpecplaneError) {
    const findings = e instanceof FormatError && e.findings.length ? e.findings : e instanceof PreconditionError ? e.reasons : [e.message];
    return { result: { ok: false, findings }, exit: e.exitCode };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { result: { ok: false, findings: [`Internal error: ${msg}`] }, exit: 4 };
}

function reasonOf(r: CommandResult): string | null {
  const f = r.findings?.[0];
  return typeof f === "string" ? f.split("\n")[0] : null;
}

/** The auto-warn count of `reference-cli` §6.3: appended as the last text line, or `warningCount` in JSON. Never changes the status. */
function autoWarn(root: string, spec: RunSpec, result: CommandResult): CommandResult {
  let on: boolean;
  try { on = loadSettings(root).config.autoWarn; } catch { return result; }
  if (!on) return result;
  const line = (() => {
    try {
      const n = (spec.collect ?? collectWarnings)(root, { auditUnwritable: auditAppendFailed() }).length;
      return { n, text: `${n} warning${n === 1 ? "" : "s"}${n ? "; run `specplane warnings`" : ""}` };
    } catch { return { n: null, text: "warnings unavailable" }; }
  })();
  return { ...result, warningCount: line.n, lines: [...(result.lines ?? []), line.text] };
}

/**
 * Run one command: retention, the operation, printing, the audit entry, the exit status. The operation may throw any
 * `SpecplaneError`; the runner turns it into a result. Sets `process.exitCode`.
 */
export async function runCommand(spec: RunSpec, fn: () => Promise<CommandResult> | CommandResult): Promise<void> {
  let root: string | null = null;
  try { root = checkoutRoot(); } catch { /* outside a repository: no audit; commands that need one fail themselves */ }
  resetAuditState();
  const actor = root ? actorOf(root) : null;
  const args = spec.args ?? [];

  if (root && !spec.command.startsWith("audit")) {
    try { pruneAudit(root, loadSettings(root).config.auditRetention, { actor: actor! }); } catch { /* retention never stops a command */ }
  }

  let interrupted = false;
  const onInt = (): void => {
    if (interrupted) return;
    interrupted = true;
    if (root) audit(root, { command: spec.command, args, permission: null, outcome: "cancelled", actor: actor! });
    process.exit(INTERRUPTED);
  };
  process.once("SIGINT", onInt);

  let result: CommandResult;
  let exit: ExitCode;
  let thrown: unknown;
  try {
    result = await fn();
    exit = result.held || result.ok ? 0 : 1;
  } catch (e) {
    thrown = e;
    ({ result, exit } = errorResult(e));
  } finally {
    process.removeListener("SIGINT", onInt);
  }

  const outcome: AuditOutcome = result.held ? "request-sent" : exit === 0 ? "done" : "failed";
  // The guard, the operation or the request code already wrote the entry for this call: merge into it (assumption).
  if (root && !auditedCommands().includes(spec.command) && !(thrown instanceof NotARepoError)) {
    audit(root, { command: spec.command, args, permission: result.permission ?? null, outcome, reason: outcome === "done" ? null : reasonOf(result), actor: actor! });
  }
  if (root && auditAppendFailed()) result = { ...result, warnings: [...(result.warnings ?? []), "the audit log could not be written; the action went ahead"] };

  if (root && spec.command !== "warnings") result = autoWarn(root, spec, result);

  if (spec.json) process.stdout.write(formatJson(result));
  else { const t = formatText(result); process.stdout.write(t.stdout); process.stderr.write(t.stderr); }
  process.exitCode = exit;
}
