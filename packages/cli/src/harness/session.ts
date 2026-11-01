import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type SessionStatus = "running" | "done" | "failed" | "missing";
export interface SessionRequest {
  checkout: string;
  name: string;
  sessionId: string;
  prompt: string;
  budgetUsd?: number | null;
  resume?: boolean;
  env?: Record<string, string>;
}
export interface SessionHandle { sessionId: string; pid: number }
export interface SessionCommands { attach: string; logs: string; stop: string }
/** Runtime-neutral conductor adapter. Implementations must refuse unsupported capabilities. */
export interface SessionAdapter {
  readonly name: string;
  readonly supportsBudget: boolean;
  checkCapabilities(budgetUsd?: number | null): void;
  notify?(message: string): void;
  spawn(request: SessionRequest): SessionHandle;
  observe(sessionId: string): SessionStatus;
  commands(sessionId: string): SessionCommands;
}
export class SessionCapabilityError extends Error {
  constructor(message: string) { super(message); this.name = "SessionCapabilityError"; }
}
export interface SessionCommandOptions { cwd: string; env?: NodeJS.ProcessEnv }
export type SessionCommandRunner = (args: string[], options: SessionCommandOptions) => string;

/** UUIDv5 using the DNS namespace and a stable, namespaced plan/step name. */
export function sessionIdFor(plan: string, step: number): string {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plan) || !Number.isSafeInteger(step) || step < 1) {
    throw new SessionCapabilityError("A valid plan ID and positive integer step are required for session identity.");
  }
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const hash = createHash("sha1").update(namespace).update(`specplane/${plan}/${step}`).digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The prompt delegates to the installed workflow rather than duplicating its contract. */
export function stepPrompt(plan: string): string {
  sessionIdFor(plan, 1); // Validate before embedding an identifier in the workflow invocation.
  return `run /plan-step ${plan} --unattended`;
}

/** Human-readable POSIX command only; actual invocations always use an argument array. */
function quote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
function validateSessionId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new SessionCapabilityError("Expected a deterministic UUIDv5 session ID.");
  }
}
interface ObservedSession { sessionId: string; status: Exclude<SessionStatus, "missing">; pid: number; cwd: string; name: string }

/**
 * Parse only the explicit adapter protocol. Unknown/partial data is an error, never "missing",
 * because mistaking an unknown observation for absence could launch a duplicate session.
 */
export function parseClaudeSessions(text: string): ObservedSession[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SessionCapabilityError("Claude agents returned invalid JSON; refusing to infer session absence."); }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && "agents" in raw ? (raw as { agents: unknown }).agents : null;
  if (!Array.isArray(list)) throw new SessionCapabilityError("Unsupported Claude agents JSON shape; expected an array or {agents: [...]}.");
  const out: ObservedSession[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object" || typeof row.sessionId !== "string" ||
        !["running", "done", "failed"].includes(row.status) || !Number.isSafeInteger(row.pid) || row.pid <= 0 ||
        typeof row.cwd !== "string" || !path.isAbsolute(row.cwd) || typeof row.name !== "string") {
      throw new SessionCapabilityError("Unsupported Claude session record; refusing to infer session absence.");
    }
    if (out.some((s) => s.sessionId === row.sessionId)) throw new SessionCapabilityError("Duplicate Claude session identity in observation.");
    out.push(row as ObservedSession);
  }
  return out;
}

const requiredFlags = ["--bg", "--cwd", "--name", "--session-id", "--permission-mode", "--permission-prompts", "--resume"];
function hasFlag(help: string, flag: string): boolean {
  return new RegExp(`(^|[\\s,])${flag}(?=[\\s,=<\\[]|$)`, "m").test(help);
}

/**
 * Claude background adapter. No Claude executable was available on Dot's computer on 2026-11-01;
 * no live version/flag/schema compatibility is claimed. Every use probes the installed CLI and
 * fails closed on absent capabilities or an unrecognized agents protocol. Fake-runner tests verify
 * this adapter's contract, not an external CLI release. It never runs claude rm or creates worktrees.
 */
export function createClaudeSessionAdapter(options: {
  root: string;
  backend: "worktree" | "branch" | "external";
  run?: SessionCommandRunner;
  /** Local harness alert sink; never executes a command or changes permissions. */
  emit?: (message: string) => void;
}): SessionAdapter {
  const run: SessionCommandRunner = options.run ?? ((args, opts) => {
    try {
      return execFileSync("claude", args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      throw new SessionCapabilityError("Claude command failed or timed out; no session state is inferred. Check the installed Claude CLI and its session list before retrying a launch.");
    }
  });
  const invoke = (args: string[]) => run(args, { cwd: options.root });
  const probe = (budget?: number | null) => {
    if (options.backend === "external") throw new SessionCapabilityError("the external environment runs its own sessions");
    if (options.backend !== "worktree") throw new SessionCapabilityError("The conductor requires the worktree backend.");
    const version = invoke(["--version"]).trim();
    if (!version) throw new SessionCapabilityError("Claude returned no version; background execution is unverified.");
    const help = invoke(["--help"]);
    const missing = requiredFlags.filter((flag) => !hasFlag(help, flag));
    if (budget != null && !hasFlag(help, "--max-budget-usd")) missing.push("--max-budget-usd");
    if (missing.length) throw new SessionCapabilityError(`Claude ${version} lacks required background capabilities: ${missing.join(", ")}.`);
    if (!hasFlag(invoke(["agents", "--help"]), "--json")) throw new SessionCapabilityError("Claude agents --json is unavailable; refusing an unobservable session.");
  };
  const sessions = () => parseClaudeSessions(invoke(["agents", "--json"]));
  return {
    name: "claude",
    supportsBudget: true,
    checkCapabilities: probe,
    notify: message => (options.emit ?? (text => process.stderr.write(`${text}\n`)))(message),
    spawn(request) {
      validateSessionId(request.sessionId);
      if (request.budgetUsd != null && (!Number.isFinite(request.budgetUsd) || request.budgetUsd <= 0)) throw new SessionCapabilityError("Session budget must be a positive finite number.");
      if (!path.isAbsolute(request.checkout) || !fs.existsSync(request.checkout) || !fs.statSync(request.checkout).isDirectory()) throw new SessionCapabilityError("An existing absolute plan checkout is required.");
      probe(request.budgetUsd);
      const before = sessions();
      const checkout = fs.realpathSync(request.checkout);
      const same = before.find((s) => s.sessionId === request.sessionId);
      const collision = before.find((s) => s.sessionId !== request.sessionId && (path.resolve(s.cwd) === checkout || s.name === request.name) && s.status === "running");
      if (collision) throw new SessionCapabilityError("Another live session owns this plan checkout or name.");
      if (same && (path.resolve(same.cwd) !== checkout || same.name !== request.name)) throw new SessionCapabilityError("Existing session identity belongs to a different checkout or name.");
      if (same?.status === "running") return { sessionId: same.sessionId, pid: same.pid };
      if (request.resume && !same) throw new SessionCapabilityError("Requested resume session is missing; refusing to create a replacement.");
      const args = ["--bg", "--cwd", checkout, "--name", request.name];
      if (same) args.push("--resume", request.sessionId);
      else args.push("--session-id", request.sessionId);
      args.push("--permission-mode", "acceptEdits", "--permission-prompts", "none");
      if (request.budgetUsd != null) args.push("--max-budget-usd", String(request.budgetUsd));
      args.push(request.prompt);
      run(args, { cwd: checkout, env: { ...process.env, ...request.env, SPECPLANE_SESSION: request.sessionId } });
      const after = sessions().find((s) => s.sessionId === request.sessionId);
      if (!after || path.resolve(after.cwd) !== checkout || after.name !== request.name) throw new SessionCapabilityError("Launch outcome is uncertain: the matching session was not observed. Inspect Claude sessions before retrying; do not assume launch failed.");
      if (after.status === "failed") throw new SessionCapabilityError("Claude reported the launched session failed.");
      return { sessionId: after.sessionId, pid: after.pid };
    },
    observe(sessionId) {
      validateSessionId(sessionId);
      probe();
      return sessions().find((s) => s.sessionId === sessionId)?.status ?? "missing";
    },
    commands(sessionId) {
      validateSessionId(sessionId);
      return { attach: `claude attach ${quote(sessionId)}`, logs: `claude logs ${quote(sessionId)}`, stop: `claude stop ${quote(sessionId)}` };
    },
  };
}
