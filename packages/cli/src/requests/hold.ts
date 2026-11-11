import { requestContext } from "./checkout.js";
import { audit } from "../audit/log.js";
import { loadSettings } from "../config.js";
import { run } from "../git/exec.js";
import type { Actor } from "../perm/permissions.js";
import { newRequestId, saveNew, type RequestRecord } from "./store.js";

/**
 * Turning a `request user` decision into a stored request (`feature/requests` R52, R52.3; `reference-cli` §8).
 * Imports only the store, so every guarded module can use it.
 */

export interface HoldInput {
  root: string;
  actor: Actor;
  /** Every permission the action needs (`guard` result `permissions`). */
  permissions: string[];
  /** The permission that decided the hold, for the audit entry. */
  decidedBy: string;
  command: string;
  params: Record<string, unknown>;
  reason: string;
  plan?: string | null;
  blocking?: boolean;
  diff?: string | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

/** Thrown by operations that return a value and so cannot return "held"; front ends print it and exit 0. */
export class RequestSent extends Error {
  constructor(readonly request: RequestRecord, message: string) { super(message); this.name = "RequestSent"; }
}

type Notifier = (summary: string, request: RequestRecord) => void;
let notifier: Notifier | null = null;
/** A harness adapter registers its push notification function (`requests R52.5`); none by default. */
export function setNotifier(fn: Notifier | null): void { notifier = fn; }

function git(root: string, args: string[]): string | null { try { return run("git", args, { cwd: root }).trim() || null; } catch { return null; } }

export function sentMessage(rec: RequestRecord): string {
  return `Sent request ${rec.id} to the user: ${rec.reason} Nothing was done. It is done only if the user accepts it (specplane requests accept ${rec.id}).`;
}

export function holdRequest(i: HoldInput): RequestRecord {
  const now = i.now ?? new Date();
  const env = i.env ?? process.env;
  const context = requestContext(i.root, i.plan);
  const rec: RequestRecord = {
    id: newRequestId(now),
    state: "pending",
    created: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    from: { role: i.actor.role, model: i.actor.model ?? null, session: env.SPECPLANE_SESSION || null },
    permissions: [...new Set(i.permissions)],
    action: { command: i.command, params: i.params },
    reason: i.reason,
    base: { branch: git(i.root, ["branch", "--show-current"]), commit: git(i.root, ["rev-parse", "HEAD"]) },
    diff: i.diff ?? null,
    ...context,
    blocking: !!i.blocking,
    answer: null,
  };
  saveNew(i.root, rec);
  audit(i.root, {
    command: i.command, args: Object.values(i.params).filter((v) => typeof v === "string") as string[], permission: i.decidedBy,
    outcome: "request-sent", reason: i.reason, actor: { role: i.actor.role, kind: i.actor.kind, name: i.actor.name }, model: i.actor.model ?? null, request: rec.id,
  }, now);
  try {
    const v = loadSettings(i.root).config.values;
    const push = v["notifications.push"] === true;
    const list = (v["notifications.push_permissions"] as string[] | undefined) ?? ["all"];
    if (notifier && push && (list.includes("all") || rec.permissions.some((p) => list.includes(p)))) notifier(`A request is pending: ${i.command}`, rec);
  } catch { /* a failed notification never stops the request */ }
  return rec;
}
