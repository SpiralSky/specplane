import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PreconditionError } from "../errors.js";
import { checkBudget, type Usage } from "../plan/budget.js";
import { clearRun, requirePlan, worktreeOf, writeRun, type PlanCtx } from "../plan/ctx.js";
import { storeDir } from "../repo/store.js";
import type { SessionLauncher } from "./run.js";
import { ACTOR_ENV, LLM_MARK, bypassGuardOn } from "../perm/bypass.js";

/**
 * The Claude Code session adapter (`harnesses/claude/specifications/architecture/claude-integration` §7,
 * `architecture/reference-cli` §8, §11.3, §11.4). `plan-start` opens the plan's session by running `claude -p` in the
 * plan's worktree through a monitor process (`specplane harness session`). The monitor keeps the run marker's heartbeat,
 * reads usage from the host's rate-limit events and calls the budget check, ending the session at a hard stop and
 * telling the assistant at a soft stop. Everything host-specific arrives through a spawn port, so the behaviour is
 * covered offline with a fake process; a live check needs the user's approval and has not been run.
 */

/** Resources this adapter measures, by the name a plan budget uses; read from the host's usage windows. */
export const CLAUDE_RESOURCES: readonly string[] = ["5h", "weekly"];
const WINDOWS: Readonly<Record<string, string>> = { five_hour: "5h", seven_day: "weekly" };

/**
 * Usage from one `rate_limit_event` of the stream (shape recorded on Claude Code 2.1.317, `host-evidence/2.1.317`).
 * `utilization` is a 0..1 fraction; a value above 1 is an account past its limit and reads as 100 so the session stops.
 */
export function readUsage(event: unknown): Usage | undefined {
  const e = event as { type?: unknown; rate_limit_info?: { unifiedWindows?: unknown } } | null;
  if (e?.type !== "rate_limit_event") return undefined;
  const windows = e.rate_limit_info?.unifiedWindows;
  if (typeof windows !== "object" || windows === null) return undefined;
  const usage: Usage = {};
  for (const [window, value] of Object.entries(windows)) {
    const used = (value as { utilization?: unknown } | null)?.utilization;
    const name = WINDOWS[window];
    if (name && typeof used === "number" && Number.isFinite(used) && used >= 0) usage[name] = Math.round(Math.min(used, 1) * 10000) / 100;
  }
  return Object.keys(usage).length ? usage : undefined;
}

/** What the headless session must report in `system/init`; without the plugin or the mode it lacks its tools and policy. */
export const PLUGIN_NAME = "specplane";
export const PERMISSION_MODE = "auto";
/** Narrow on purpose: a matching allow rule skips the auto-mode classifier. The Specplane tools check permissions in code. */
const ALLOWED_TOOLS = ["Skill", "mcp__specplane"];
/** Hard limits the classifier cannot override. The Specplane CLI is for people (`harness R47`). */
const DISALLOWED_TOOLS = ["git push", "git reset --hard", "git clean", "sudo", "npm publish", "specplane", "npx specplane", "bunx specplane"].map((c) => `Bash(${c} *)`);

const DEAD_MCP_STATUS = ["failed", "needs-auth"];
const specplaneServers = (ev: Record<string, unknown>): { status?: unknown }[] =>
  Array.isArray(ev.mcp_servers) ? (ev.mcp_servers as ({ name?: unknown; status?: unknown } | null)[]).filter((p): p is { status?: unknown } => p?.name === "specplane") : [];
/** The status of a listed `specplane` MCP server that did not connect (`failed`, `needs-auth`), else null. */
export function deadSpecplaneServer(ev: Record<string, unknown>): string | null {
  const s = specplaneServers(ev);
  if (s.length === 0 || s.some((e) => !DEAD_MCP_STATUS.includes(e.status as string))) return null;
  return String(s[0].status);
}
/** Whether `system/init` lists the Specplane plugin or a `specplane` MCP server that is not `failed` or `needs-auth` (`claude-integration` §10). */
export function reportsSpecplane(ev: Record<string, unknown>): boolean {
  const plugin = Array.isArray(ev.plugins) && ev.plugins.some((p) => (p as { name?: unknown } | null)?.name === PLUGIN_NAME);
  return plugin || (specplaneServers(ev).length > 0 && deadSpecplaneServer(ev) === null);
}

/** The message that starts the step: the slash command and the plan, no free text from the plan. The skill has `disable-model-invocation: true`, so only a slash command at the very start of the message loads it. */
export function sessionPrompt(planId: string): string {
  return `/specplane-plan-step ${planId}`;
}

/** `claude -p` in streaming mode, so a soft stop can be sent to the running session on stdin. No `--bare` and no permission bypass. */
export function buildArgv(sessionId: string, o: { resume?: boolean; executable?: string } = {}): string[] {
  return [o.executable ?? "claude", "-p", o.resume ? "--resume" : "--session-id", sessionId,
    "--permission-mode", PERMISSION_MODE, "--permission-prompts", "none",
    "--allowedTools", ALLOWED_TOOLS.join(","), "--disallowedTools", DISALLOWED_TOOLS.join(","),
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
}

const userMessage = (text: string): string => `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;

/** The exact command that opens the plan's session by hand, for the error shown when the adapter cannot do it. */
export function manualCommand(worktree: string, planId: string): string {
  return `cd ${JSON.stringify(worktree)} && claude ${JSON.stringify(sessionPrompt(planId))}`;
}

export function claudeAvailable(executable = "claude"): boolean {
  try { return spawnSync(executable, ["--version"], { stdio: "ignore", timeout: 10_000, env: process.env }).status === 0; } catch { return false; }
}

/** One spawned `claude` process, as the monitor needs it. */
export interface SessionProcess {
  pid?: number;
  /** Called for each complete stdout line. */
  onLine(cb: (line: string) => void): void;
  /** Resolves with the exit code once the process has exited (null when killed by a signal). */
  exited: Promise<number | null>;
  write(text: string): void;
  endInput(): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}
export interface ClaudeDeps {
  spawn(argv: string[], o: { cwd: string; env: NodeJS.ProcessEnv }): SessionProcess;
  newId?: () => string;
  /** Calls `fn` every `ms` until the returned function is called; defaults to `setInterval`. */
  every?: (ms: number, fn: () => void) => () => void;
  heartbeatMs?: number;
  killWaitMs?: number;
  /** How long after the turn that was running when the soft instruction was sent ends the monitor waits for the instruction's own turn. */
  softGraceMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type SessionOutcome = "completed" | "soft-stop" | "hard-stop" | "failed";
export interface SessionResult { session: string; outcome: SessionOutcome; exitCode: number | null; notes: string[] }

/**
 * Run the plan's session to its end and keep the plan record honest meanwhile. The monitor writes the run marker with the
 * process id at the start and at every heartbeat (`reference-cli` §11.3). At a soft stop it sends the budget instruction to
 * the session, waits for the turn that follows it, then records the soft stop; at a hard stop it records the stop first
 * (the budget check does), then ends the process. A clean end removes the marker; any other end leaves it to go stale.
 */
export async function runPlanSession(ctx: PlanCtx, planId: string, deps: ClaudeDeps, o: { resume?: boolean; sessionId?: string } = {}): Promise<SessionResult> {
  const worktree = worktreeOf(ctx.root, planId);
  if (!worktree) throw new PreconditionError([`Plan \`${planId}\` has no worktree; start or resume it first.`]);
  const { rec } = requirePlan(ctx, planId);
  if (rec.progress?.status !== "in-progress") throw new PreconditionError([`Plan \`${planId}\` is ${rec.progress?.status ?? "not started"}, so no session was opened.`]);

  const session = o.sessionId ?? (deps.newId ?? randomUUID)();
  const notes: string[] = [];
  const env = {
    ...(deps.env ?? process.env), SPECPLANE_SESSION: session, SPECPLANE_CHECKOUT: worktree,
    SPECPLANE_MEASURABLE_RESOURCES: CLAUDE_RESOURCES.join(","),
    // The headless session is an LLM's: mark it so the CLI and any session it starts run with an LLM role (`R58`, `marker_export`).
    ...(bypassGuardOn(ctx.root, "marker_export") ? { [ACTOR_ENV]: LLM_MARK, SPECPLANE_PROVIDER: "anthropic" } : {}),
  };
  const child = deps.spawn(buildArgv(session, { resume: o.resume }), { cwd: worktree, env });
  const budgetCtx: PlanCtx = { ...ctx, measurable: [...CLAUDE_RESOURCES] };
  const beat = (): void => { try { writeRun(ctx, planId, session, child.pid ?? null); } catch { /* A failed heartbeat shows as a stale marker, which is the safe reading. */ } };
  beat();
  const stopBeat = (deps.every ?? ((ms, fn) => { const t = setInterval(fn, ms); t.unref?.(); return () => clearInterval(t); }))(deps.heartbeatMs ?? 60_000, beat);

  let initOk: boolean | undefined;
  let results = 0;
  let resultOk = false;
  let softSentAt: number | null = null;
  let softDone = false;
  let hardStopped = false;
  const usage: Usage = {};
  let ended = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  const end = (): void => { if (!ended) { ended = true; try { child.endInput(); } catch { /* already closed */ } } };
  const killNow = async (): Promise<void> => {
    try { child.kill("SIGTERM"); } catch { return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([child.exited.then(() => true, () => true), new Promise<boolean>((r) => { timer = setTimeout(() => r(false), deps.killWaitMs ?? 10_000); })]);
    if (timer) clearTimeout(timer);
    if (!exited) { try { child.kill("SIGKILL"); } catch { /* gone */ } }
  };

  const onUsage = (readings: Usage): void => {
    if (hardStopped || softDone) return;
    Object.assign(usage, readings);
    let check;
    try { check = checkBudget(budgetCtx, planId, usage); } catch (e) { notes.push(`Budget check failed: ${(e as Error).message}`); return; }
    if (check.decision.action === "hard" && check.stopped) { hardStopped = true; notes.push(check.decision.reason); void killNow(); return; }
    if (check.decision.action === "soft" && check.instruction && softSentAt === null) {
      softSentAt = results;
      notes.push(check.decision.reason);
      try { child.write(userMessage(check.instruction)); } catch { notes.push("The soft-stop instruction could not be sent to the session."); }
    }
  };

  const onEvent = (ev: Record<string, unknown>): void => {
    if (ev.type === "system" && ev.subtype === "init") {
      initOk = ev.permissionMode === PERMISSION_MODE && reportsSpecplane(ev);
      // Without the plugin or the MCP server, or without the mode, the session lacks its tools and policy: stop it rather than let it work unguarded.
      if (!initOk) {
        const dead = reportsSpecplane(ev) ? null : deadSpecplaneServer(ev);
        notes.push(dead
          ? `The \`specplane\` MCP server is listed but did not connect (status \`${dead}\`), so the session would run without the Specplane tools and was stopped. Check the server, or install the plugin.`
          : "The session did not report the Specplane plugin or the `specplane` MCP server, and auto mode, so it was stopped. Run `specplane init --harness claude` to register the MCP server, or install the plugin.");
        void killNow();
      }
      return;
    }
    const readings = readUsage(ev);
    if (readings) onUsage(readings);
    if (ev.type !== "result") return;
    results++;
    resultOk = ev.subtype === "success" && ev.is_error !== true;
    if (softSentAt === null) { end(); return; }
    if (softDone || hardStopped) return;
    // The instruction is queued behind the turn that was running; its own turn is the safe-point handoff. If the host
    // folded it into the running turn there is no second result, so a grace period ends the wait.
    if (results >= softSentAt + 2) finishSoft();
    else if (!graceTimer) { graceTimer = setTimeout(finishSoft, deps.softGraceMs ?? 120_000); graceTimer.unref?.(); }
  };
  const finishSoft = (): void => {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = undefined; }
    if (softDone || hardStopped || ended) return;
    try { checkBudget(budgetCtx, planId, usage, { finished: true }); softDone = true; } catch (e) { notes.push(`The soft stop could not be recorded: ${(e as Error).message}`); }
    end();
  };

  child.onLine((line) => {
    if (!line.trim()) return;
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { return; }
    if (typeof ev === "object" && ev !== null && !Array.isArray(ev)) onEvent(ev as Record<string, unknown>);
  });
  child.write(userMessage(sessionPrompt(planId)));

  const exitCode = await child.exited.catch(() => null);
  stopBeat();
  if (graceTimer) clearTimeout(graceTimer);
  let outcome: SessionOutcome;
  if (hardStopped) outcome = "hard-stop";
  else if (softDone) { outcome = "soft-stop"; clearRun(ctx.root, planId); }
  else if (exitCode === 0 && resultOk && initOk) { outcome = "completed"; clearRun(ctx.root, planId); }
  else outcome = "failed";
  if (outcome === "failed") notes.push("The session ended without a clean result; the plan's run marker goes stale and the next status read reports a failure stop.");
  return { session, outcome, exitCode, notes };
}

/** The real process port: `child_process.spawn` with an argument array (no shell) and line-split stdout. */
export function nodeSpawnPort(argv: string[], o: { cwd: string; env: NodeJS.ProcessEnv }): SessionProcess {
  const child = nodeSpawn(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "ignore"] });
  const listeners: ((l: string) => void)[] = [];
  let buffer = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\n")) !== -1) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); for (const l of listeners) l(line); }
  });
  child.stdin!.on("error", () => { /* the session ended first */ });
  const exited = new Promise<number | null>((resolve) => { child.on("error", () => resolve(null)); child.on("close", (code) => resolve(code)); });
  return {
    pid: child.pid,
    onLine: (cb) => { listeners.push(cb); },
    exited,
    write: (text) => { child.stdin!.write(text); },
    endInput: () => { child.stdin!.end(); },
    kill: (signal) => { child.kill(signal); },
  };
}

/** Where the monitor is started from; `specplane harness session` is its only entry. */
function cliEntry(): string { return fileURLToPath(new URL("../cli.js", import.meta.url)); }

/**
 * The launcher `plan-start` and an answered blocking request use. It starts the monitor as a detached process so the
 * session outlives the command that opened it, and refuses (naming the exact command to run by hand) when `claude`
 * cannot be run.
 */
export const claudeLauncher: SessionLauncher = {
  name: "claude",
  newSessionId: () => randomUUID(),
  open(ctx, planId, o) {
    const worktree = worktreeOf(ctx.root, planId) ?? "<the plan's worktree>";
    if (!claudeAvailable()) {
      throw new PreconditionError([`Claude Code could not be run (\`claude --version\` failed), so the plan's session was not opened. Open it yourself: ${manualCommand(worktree, planId)}`]);
    }
    const logDir = path.join(storeDir(ctx.root), "session-logs");
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, `${o.sessionId}.log`), "a");
    try {
      const child = nodeSpawn(process.execPath, [cliEntry(), "harness", "session", planId, "--session", o.sessionId, ...(o.resume ? ["--resume"] : [])],
        { cwd: ctx.root, detached: true, stdio: ["ignore", log, log], env: { ...process.env, SPECPLANE_MEASURABLE_RESOURCES: CLAUDE_RESOURCES.join(",") } });
      child.unref();
    } finally { fs.closeSync(log); }
    return [`Opened session ${o.sessionId} in ${worktree}; its log is session-logs/${o.sessionId}.log in the local store.`];
  },
};
