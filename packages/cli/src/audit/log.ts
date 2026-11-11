import { clock } from "../clock.js";
import { run } from "../git/exec.js";
import { appendStoreLine } from "../repo/store.js";

/** Audit log entries (`architecture/file-formats` §10, `architecture/reference-cli` §9). */

export interface AuditActor { role: string; kind: "human" | "llm"; name: string }
export type AuditOutcome = "done" | "refused" | "request-sent" | "cancelled" | "failed";

export interface AuditEntry {
  command: string;
  args: string[];
  permission: string | null;
  outcome: AuditOutcome;
  reason?: string | null;
  old?: unknown;
  new?: unknown;
  actor: AuditActor;
  model?: string | null;
  request?: string | null;
}

let appendFailed = false;
const written: string[] = [];

/** True when an append failed in this process; the runner warns once at the end of the command. */
export function auditAppendFailed(): boolean { return appendFailed; }
/** Commands that already have an entry from this process (guard, operation or request code); the runner merges into them. */
export function auditedCommands(): readonly string[] { return written; }
/** Reset the per-process state (the runner at the start of a command; tests). */
export function resetAuditState(): void { appendFailed = false; written.length = 0; }

export function branchOf(root: string): string {
  try {
    const b = run("git", ["branch", "--show-current"], { cwd: root }).trim();
    if (b) return b;
    return run("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
  } catch { return "unknown"; }
}

/** Append an entry. A failed append never stops the action; it returns false so the caller can warn once. */
export function audit(root: string, e: AuditEntry, now: Date = clock.now()): boolean {
  try {
    const line = {
      ts: now.toISOString().replace(/\.\d{3}Z$/, "Z"), branch: branchOf(root), actor: e.actor, model: e.model ?? null,
      command: e.command, args: e.args, permission: e.permission, outcome: e.outcome, reason: e.reason ?? null,
      old: e.old ?? null, new: e.new ?? null, request: e.request ?? null,
    };
    appendStoreLine(root, "audit.jsonl", JSON.stringify(line));
    written.push(e.command);
    return true;
  } catch { appendFailed = true; return false; }
}
