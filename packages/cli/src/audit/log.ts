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

function branchOf(root: string): string {
  try {
    const b = run("git", ["branch", "--show-current"], { cwd: root }).trim();
    if (b) return b;
    return run("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
  } catch { return "unknown"; }
}

/** Append an entry. A failed append never stops the action; it returns false so the caller can warn once. */
export function audit(root: string, e: AuditEntry, now: Date = new Date()): boolean {
  try {
    const line = {
      ts: now.toISOString().replace(/\.\d{3}Z$/, "Z"), branch: branchOf(root), actor: e.actor, model: e.model ?? null,
      command: e.command, args: e.args, permission: e.permission, outcome: e.outcome, reason: e.reason ?? null,
      old: e.old ?? null, new: e.new ?? null, request: e.request ?? null,
    };
    appendStoreLine(root, "audit.jsonl", JSON.stringify(line));
    return true;
  } catch { return false; }
}
