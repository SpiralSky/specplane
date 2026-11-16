import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { PreconditionError } from "../errors.js";
import { DEFAULT_PRESET, type Actor } from "../perm/permissions.js";
import { createPlan } from "../plan/create.js";
import { loadPlanAt, readStore, worktreeOf, writeStore, type PlanCtx, type RunMarker } from "../plan/ctx.js";
import { resumePlan, setBudget, startPlan, stepDone, stopPlan } from "../plan/run.js";
import { checkSelection, describePlan, parseSelection } from "../plan/status.js";
import { readRequest } from "../requests/store.js";
import { sendRequest } from "../requests/ops.js";
import { makeRepo } from "../test-repo.js";
import { buildArgv, claudeLauncher, CLAUDE_RESOURCES, deadSpecplaneServer, manualCommand, readUsage, reportsSpecplane, runPlanSession, sessionPrompt, type ClaudeDeps, type SessionProcess } from "./adapter-claude.js";
import { runHarnessCommand, type SessionLauncher } from "./run.js";
import "./adapters.js";

const ENV = { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" };
const sh = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const ID = "2026-11-10-export-things";
const F = "docs/specifications/features";
const SPEC = `---\nid: feature/export\ntitle: export\nauthors:\n  - human: someone\ncovers: []\n---\n\n# export\n\n## R9: Part\n\nText.\n`;
const person: Actor = { role: "standard-user", kind: "human", name: "Pat Person" };
const NOW = new Date("2026-11-10T12:00:00Z");

function started(budget?: { soft: number; hard: number }, start = true): { root: string; ctx: PlanCtx } {
  const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-claude-wt-"));
  const root = makeRepo({ [`${F}/export.md`]: SPEC, ".specplane/config.yaml": `paths:\n  features: ${F}\nplans:\n  dir: plans\n  worktree_dir: ${wtBase}\n  start_conditions: off\n` });
  sh(root, "init", "-q", "-b", "main"); sh(root, "config", "user.name", "Pat Person"); sh(root, "config", "user.email", "pat@example.com");
  sh(root, "add", "-A"); sh(root, "commit", "-q", "-m", "init");
  const ctx: PlanCtx = { root, actor: person, preset: DEFAULT_PRESET, now: NOW, env: {} };
  createPlan(ctx, { words: ["export", "things"] });
  if (!start) return { root, ctx };
  startPlan(ctx, ID);
  if (budget) setBudget(ctx, ID, { resource: "weekly", ...budget });
  return { root, ctx };
}

interface Fake { deps: ClaudeDeps; written: string[]; kills: string[]; argv: string[][]; cwds: string[]; envs: NodeJS.ProcessEnv[]; emit: (ev: unknown) => void; exit: (code: number | null) => void; beat: () => void; ended: () => boolean; stopped: () => boolean }
function fake(): Fake {
  const f = { written: [] as string[], kills: [] as string[], argv: [] as string[][], cwds: [] as string[], envs: [] as NodeJS.ProcessEnv[] };
  let cb: (l: string) => void = () => {};
  let exit!: (c: number | null) => void;
  let inputEnded = false;
  let beatFn: () => void = () => {};
  let stopped = false;
  const proc: SessionProcess = {
    pid: process.pid, // a live pid on this machine, so the marker reads as a running session
    onLine: (c) => { cb = c; },
    exited: new Promise((r) => { exit = r; }),
    write: (t) => { f.written.push(t); },
    endInput: () => { inputEnded = true; },
    kill: (s) => { f.kills.push(s); exit(null); },
  };
  const deps: ClaudeDeps = {
    spawn: (argv, o) => { f.argv.push(argv); f.cwds.push(o.cwd); f.envs.push(o.env); return proc; },
    newId: () => "11111111-1111-4111-8111-111111111111",
    every: (_ms, fn) => { beatFn = fn; return () => { stopped = true; }; },
  };
  return { deps, ...f, emit: (ev) => cb(JSON.stringify(ev)), exit: (c) => exit(c), beat: () => beatFn(), ended: () => inputEnded, stopped: () => stopped };
}
const INIT = { type: "system", subtype: "init", permissionMode: "auto", plugins: [{ name: "specplane" }] };
const RESULT = { type: "result", subtype: "success", is_error: false };
const usage = (u: number) => ({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { seven_day: { utilization: u } } } });
const tick = () => new Promise((r) => setTimeout(r, 0));
const marker = (root: string) => readStore<RunMarker>(root, `runs/${ID}.json`);
const progress = (root: string) => loadPlanAt(worktreeOf(root, ID)!, ID)!.progress!;
const entry = (n: number, outcome = "done") => `\n## Step ${String(n).padStart(2, "0")}: Step ${n}\n\n**Date**: 2026-11-10\n**Outcome**: ${outcome}\n\n### What changed\n- \`f${n}.txt\`: work\n\n### Deviations from the step\nNone.\n\n### Gaps found\nNone.\n\n### Open issues\nNone.\n\n### What the next step must know\nNone.\n`;
/** What a session does when it finishes step `n`: the handoff entry, then `plan step-done` under the session's own ID. */
function finishStep(root: string, ctx: PlanCtx, n: number, session: string, outcome: "done" | "partial" = "done"): void {
  fs.appendFileSync(path.join(worktreeOf(root, ID)!, "plans", ID, "HANDOFF.md"), entry(n, outcome));
  stepDone({ ...ctx, env: { SPECPLANE_SESSION: session } }, ID, { step: n, outcome });
}
/** Steps 2..n added to the plan on its branch, so a plan has `n` steps. */
function addSteps(root: string, n: number): void {
  const wt = worktreeOf(root, ID)!;
  for (let i = 2; i <= n; i++) fs.writeFileSync(path.join(wt, "plans", ID, "steps", `0${i}-step-${i}.md`), `---\nplan: ${ID}\nstep: ${i}\ntitle: Step ${i}\n---\n## Goal\n\nMore.\n`);
  sh(wt, "add", "-A"); sh(wt, "commit", "-q", "-m", "more steps");
}
const sentText = (w: string): string => (JSON.parse(w) as { message: { content: string } }).message.content;

test("usage is read per window in percent, an over-limit account reads as 100, other events as nothing", () => {
  assert.deepEqual(readUsage({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.29 }, seven_day: { utilization: 1.4 }, other: { utilization: 0.1 } } } }), { "5h": 29, weekly: 100 });
  assert.equal(readUsage({ type: "assistant" }), undefined);
  assert.equal(readUsage({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: "x" } } } }), undefined);
  assert.deepEqual([...CLAUDE_RESOURCES], ["5h", "weekly"]);
});

test("launch: argv, worktree, session environment, no bypass, prompt on stdin, heartbeat, clean end clears the marker", async () => {
  const { root, ctx } = started();
  const f = fake();
  const run = runPlanSession(ctx, ID, f.deps);
  await tick();
  assert.deepEqual(f.argv[0].slice(0, 4), ["claude", "-p", "--session-id", "11111111-1111-4111-8111-111111111111"]);
  assert.ok(f.argv[0].includes("--input-format") && f.argv[0].includes("stream-json"));
  assert.ok(!f.argv[0].some((a) => /bypass|--bare/.test(a)));
  assert.equal(f.cwds[0], worktreeOf(root, ID));
  assert.equal(f.envs[0].SPECPLANE_SESSION, "11111111-1111-4111-8111-111111111111");
  assert.equal(f.envs[0].SPECPLANE_CHECKOUT, worktreeOf(root, ID));
  assert.equal(f.envs[0].SPECPLANE_MEASURABLE_RESOURCES, "5h,weekly");
  assert.equal(sentText(f.written[0]), sessionPrompt(ID));
  const first = marker(root)!;
  assert.deepEqual({ session: first.session, pid: first.pid }, { session: "11111111-1111-4111-8111-111111111111", pid: process.pid });
  f.beat(); // the heartbeat rewrites the marker
  assert.ok(marker(root));
  f.emit(INIT); f.emit(RESULT);
  assert.ok(f.ended(), "stdin closes after the turn so the session ends");
  finishStep(root, ctx, 1, "11111111-1111-4111-8111-111111111111");
  f.exit(0);
  const r = await run;
  assert.equal(r.outcome, "completed");
  assert.equal(marker(root), null, "the only step is done, so nothing is idle");
  assert.ok(f.stopped());
  assert.equal(progress(root).status, "in-progress");
});

test("soft stop: the instruction is sent, the next turn records a soft stop naming the budget and the marker is cleared", async () => {
  const { root, ctx } = started({ soft: 80, hard: 95 });
  const f = fake();
  const run = runPlanSession(ctx, ID, f.deps);
  f.emit(INIT);
  f.emit(usage(0.5));
  assert.equal(f.written.length, 1, "below the soft stop nothing is sent");
  f.emit(usage(0.81));
  assert.equal(f.written.length, 2);
  assert.match(sentText(f.written[1]), /soft stop of the weekly budget \(80%\) is reached/);
  f.emit(usage(0.82));
  assert.equal(f.written.length, 2, "the instruction is sent once");
  f.emit(RESULT); // the turn that was running ends; the instruction turn is still to come
  assert.equal(f.ended(), false);
  assert.equal(progress(root).status, "in-progress");
  f.emit(RESULT); // the instruction's own turn, the safe-point handoff
  assert.ok(f.ended());
  assert.equal(progress(root).status, "stopped");
  assert.equal(progress(root).stop!.kind, "soft");
  assert.match(progress(root).stop!.reason!, /soft stop at 80% of the weekly limit/);
  f.exit(0);
  const r = await run;
  assert.equal(r.outcome, "soft-stop");
  assert.equal(marker(root), null);
});

test("soft stop: when the host folds the instruction into the running turn, the grace period ends the wait", async () => {
  const { root, ctx } = started({ soft: 80, hard: 95 });
  const f = fake();
  f.deps.softGraceMs = 10;
  const run = runPlanSession(ctx, ID, f.deps);
  f.emit(INIT); f.emit(usage(0.9)); f.emit(RESULT);
  assert.equal(progress(root).status, "in-progress");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(progress(root).stop!.kind, "soft");
  assert.ok(f.ended());
  f.exit(0);
  assert.equal((await run).outcome, "soft-stop");
});

test("hard stop: recorded as hard, the session is ended by force", async () => {
  const { root, ctx } = started({ soft: 80, hard: 95 });
  const f = fake();
  const run = runPlanSession(ctx, ID, f.deps);
  f.emit(INIT);
  f.emit(usage(0.96));
  const r = await run;
  assert.equal(r.outcome, "hard-stop");
  assert.deepEqual(f.kills, ["SIGTERM"]);
  assert.equal(progress(root).status, "stopped");
  assert.equal(progress(root).stop!.kind, "hard");
  assert.deepEqual(r.notes, ["hard stop at 95% of the weekly limit"]);
});

test("without a budget readings never stop the session", async () => {
  const { root, ctx } = started();
  const f = fake();
  const run = runPlanSession(ctx, ID, f.deps);
  f.emit(INIT); f.emit(usage(0.99));
  assert.equal(f.kills.length, 0);
  f.emit(RESULT);
  finishStep(root, ctx, 1, "11111111-1111-4111-8111-111111111111");
  f.exit(0);
  assert.equal((await run).outcome, "completed");
  assert.equal(progress(root).status, "in-progress");
});

test("a session without the plugin is stopped, fails, and records a failure stop", async () => {
  const { root, ctx } = started();
  const f = fake();
  const run = runPlanSession(ctx, ID, f.deps);
  f.emit({ type: "system", subtype: "init", permissionMode: "auto", plugins: [] });
  const r = await run;
  assert.equal(r.outcome, "failed");
  assert.ok(f.kills.includes("SIGTERM"));
  assert.equal(marker(root), null);
  assert.equal(progress(root).status, "stopped");
  assert.deepEqual({ kind: progress(root).stop!.kind, reason: progress(root).stop!.reason }, { kind: "failure", reason: "step 1 not finished" });
  assert.ok(r.notes.some((n) => /did not report the Specplane plugin/.test(n)));
});

test("the init check accepts the plugin or the specplane MCP server and refuses neither", async () => {
  const run = async (init: Record<string, unknown>): Promise<string> => {
    const { ctx } = started();
    const f = fake();
    const p = runPlanSession(ctx, ID, f.deps);
    f.emit({ type: "system", subtype: "init", permissionMode: "auto", ...init });
    if (f.kills.length === 0) { f.emit(RESULT); f.exit(0); } else await tick();
    return (await p).outcome;
  };
  assert.equal(await run({ mcp_servers: [{ name: "specplane", status: "connected" }], plugins: [] }), "completed");
  assert.equal(await run({ plugins: [{ name: "specplane" }] }), "completed");
  assert.equal(await run({ mcp_servers: [{ name: "other", status: "connected" }], plugins: [{ name: "other" }] }), "failed");
  assert.equal(await run({}), "failed");
  assert.equal(reportsSpecplane({ mcp_servers: [{ name: "specplane" }] }), true);
  assert.equal(reportsSpecplane({ mcp_servers: "specplane" }), false);
});

test("a listed specplane MCP server that failed or needs auth does not count; pending, no status and unknown do", async () => {
  for (const status of ["failed", "needs-auth"]) {
    assert.equal(reportsSpecplane({ mcp_servers: [{ name: "specplane", status }] }), false, status);
    assert.equal(reportsSpecplane({ mcp_servers: [{ name: "specplane", status }], plugins: [{ name: "specplane" }] }), true, `${status} with plugin`);
  }
  for (const status of ["pending", "connected", "weird", undefined]) assert.equal(reportsSpecplane({ mcp_servers: [{ name: "specplane", status }] }), true, String(status));
  // Several `specplane` entries: one usable entry passes; only all dead fails, naming each status once.
  assert.equal(reportsSpecplane({ mcp_servers: [{ name: "specplane", status: "failed" }, { name: "specplane", status: "connected" }] }), true);
  assert.equal(reportsSpecplane({ mcp_servers: [{ name: "specplane", status: "needs-auth" }, { name: "specplane", status: "failed" }] }), false);
  assert.equal(deadSpecplaneServer({ mcp_servers: [{ name: "specplane", status: "failed" }, { name: "specplane", status: "connected" }] }), null);
  assert.equal(deadSpecplaneServer({ mcp_servers: [{ name: "specplane", status: "needs-auth" }, { name: "specplane", status: "failed" }, { name: "specplane", status: "failed" }] }), "needs-auth, failed");
  const { ctx } = started();
  const f = fake();
  const p = runPlanSession(ctx, ID, f.deps);
  f.emit({ type: "system", subtype: "init", permissionMode: "auto", mcp_servers: [{ name: "specplane", status: "needs-auth" }] });
  await tick();
  const r = await p;
  assert.equal(r.outcome, "failed");
  assert.match(r.notes.join("\n"), /listed but did not connect \(status `needs-auth`\)/);
});

test("a plan that is not in progress, or has no worktree, is refused before anything starts", async () => {
  const { ctx } = started();
  const f = fake();
  await assert.rejects(runPlanSession(ctx, "2026-11-10-missing", f.deps), PreconditionError);
  assert.equal(f.argv.length, 0);
});

test("resume uses the saved session and the manual command names the worktree", () => {
  assert.deepEqual(buildArgv("abc", { resume: true }).slice(0, 4), ["claude", "-p", "--resume", "abc"]);
  assert.match(manualCommand("/w/plan", ID), /^cd "\/w\/plan" && claude "\/specplane-plan-step /);
  assert.equal(sessionPrompt(ID), `/specplane-plan-step ${ID}`);
});

test("plan-start through the runner opens the session once under the chosen id; a refusal prints the manual command as an error", async () => {
  const calls: string[] = [];
  const ok: SessionLauncher = { name: "fake", newSessionId: () => "sess-A", open: (_c, id, o) => { calls.push(`${id}:${o.sessionId}:${o.resume}`); return ["Opened."]; } };
  const root2 = started(undefined, false).root;
  const r = await runHarnessCommand("plan-start", [ID], root2, { launcher: ok });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(calls, [`${ID}:sess-A:false`]);
  assert.equal(progress(root2).session, "sess-A");
  assert.equal(marker(root2)!.session, "sess-A");
  assert.ok(r.lines!.includes("Opened."));

  const refusing: SessionLauncher = { name: "fake", newSessionId: () => "sess-B", open: () => { throw new PreconditionError(["Claude Code could not be run, so nothing opened. Open it yourself: cd x && claude"]); } };
  const fx = started(undefined, false);
  const failed = await runHarnessCommand("plan-start", [ID], fx.root, { launcher: refusing });
  assert.equal(failed.ok, false);
  assert.match(failed.findings!.join("\n"), /Open it yourself: cd x && claude/);
  assert.match(failed.lines!.join("\n"), /Started /);
});

test("without Claude Code on PATH the launcher refuses and names the exact command", () => {
  const { ctx } = started();
  const saved = process.env.PATH;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-nopath-"));
  const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(git, path.join(bin, "git"));
  process.env.PATH = bin;
  try {
    assert.throws(() => claudeLauncher.open(ctx, ID, { sessionId: "s", resume: false }), (e) => e instanceof PreconditionError && /Open it yourself: cd .* && claude/.test(e.reasons.join()));
  } finally { process.env.PATH = saved; }
});

test("answering a blocking request while a session is active resumes the plan and opens its session again", async () => {
  const { root, ctx } = started();
  const llm: PlanCtx = { ...ctx, actor: { role: "llm", kind: "llm", name: "claude", model: "claude-sonnet-5-5" } };
  const sent = sendRequest(llm, { command: "spec approve", params: { ids: ["feature/export"] }, permissions: ["spec.approve.feature"], reason: "approve export", plan: ID, blocking: true });
  assert.ok(sent.ok);
  assert.equal(progress(root).status, "stopped");
  const calls: string[] = [];
  const launcher: SessionLauncher = { name: "fake", newSessionId: () => "sess-R", open: (_c, id, o) => { calls.push(`${id}:${o.sessionId}:${o.resume}`); return ["Reopened."]; } };
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const r = await runHarnessCommand("requests", ["decline", sent.request!.id, "no thanks"], root, { launcher });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(r.lines!.includes("Reopened."));
  } finally { process.chdir(cwd); }
  assert.deepEqual(calls, [`${ID}:sess-R:true`]);
  assert.equal(progress(root).status, "in-progress");
});

// An accepted `plan.start` request opens the plan's session through the adapter, or prints how to (the live check's gap).
function startRequest(): { root: string; id: string } {
  const { root, ctx } = started(undefined, false);
  const llm: PlanCtx = { ...ctx, actor: { role: "llm", kind: "llm", name: "claude", model: "claude-sonnet-5-5" } };
  const sent = sendRequest(llm, { command: "plan start", params: { id: ID }, permissions: ["plan.start"], reason: "start it" });
  assert.ok(sent.ok && sent.request, JSON.stringify(sent));
  return { root, id: sent.request!.id };
}
async function inRoot<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  // The accepting person is a human whatever session runs the tests.
  const saved = { a: process.env.SPECPLANE_ACTOR, s: process.env.SPECPLANE_SESSION };
  delete process.env.SPECPLANE_ACTOR; delete process.env.SPECPLANE_SESSION;
  process.chdir(root);
  try { return await fn(); } finally {
    process.chdir(cwd);
    if (saved.a !== undefined) process.env.SPECPLANE_ACTOR = saved.a;
    if (saved.s !== undefined) process.env.SPECPLANE_SESSION = saved.s;
  }
}
const recorder = (calls: string[], open?: () => string[]): SessionLauncher =>
  ({ name: "fake", newSessionId: () => "sess-P", open: (_c, id, o) => { calls.push(`${id}:${o.sessionId}:${o.resume}`); return open ? open() : ["Opened."]; } });

test("typed accept of a plan.start request opens the plan's session once under one session id", async () => {
  const { root, id } = startRequest();
  const calls: string[] = [];
  const r = await inRoot(root, () => runHarnessCommand("requests", ["accept", id], root, { launcher: recorder(calls), adapter: "claude" }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(calls, [`${ID}:sess-P:false`]);
  assert.ok(r.lines!.includes("Opened."));
  assert.equal(progress(root).session, "sess-P");
  assert.equal(marker(root)!.session, "sess-P");
});

test("typed accept of a request that does not start a plan launches nothing", async () => {
  const { root, ctx } = started();
  const llm: PlanCtx = { ...ctx, actor: { role: "llm", kind: "llm", name: "claude", model: "claude-sonnet-5-5" } };
  const sent = sendRequest(llm, { command: "spec approve", params: { ids: ["feature/export"] }, permissions: ["spec.approve.feature"], reason: "approve export" });
  assert.ok(sent.ok && sent.request);
  const calls: string[] = [];
  const r = await inRoot(root, () => runHarnessCommand("requests", ["accept", sent.request!.id], root, { launcher: recorder(calls), adapter: "claude" }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(calls, []);
  assert.doesNotMatch(r.lines!.join("\n"), /session/i);
});

test("accept in the plain CLI starts the plan, launches nothing and prints the manual command", async () => {
  const { root, id } = startRequest();
  fs.mkdirSync(path.join(root, ".claude/rules"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/rules/specplane.md"), "x");
  const r = await inRoot(root, () => runHarnessCommand("requests", ["accept", id], root));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(progress(root).status, "in-progress");
  assert.equal(progress(root).session ?? null, null);
  assert.match(r.lines!.join("\n"), /Claude Code: cd ".*" && claude "\/specplane-plan-step 2026-11-10-export-things"/);
});

test("a launch that fails after the accept leaves the request accepted and prints the manual command", async () => {
  const { root, id } = startRequest();
  const failing = recorder([], () => { throw new PreconditionError(["no claude here"]); });
  const r = await inRoot(root, () => runHarnessCommand("requests", ["accept", id], root, { launcher: failing, adapter: "claude" }));
  assert.equal(r.ok, false);
  assert.match(r.findings!.join("\n"), /no claude here/);
  const text = r.lines!.join("\n");
  assert.match(text, /Accepted /);
  assert.match(text, /stays accepted/);
  assert.match(text, /claude "\/specplane-plan-step /);
  assert.equal(readRequest(root, id)!.state, "accepted");
});

test("an adapter without the session-opening capability refuses the launch, keeps the accept and does not call the launcher", async () => {
  const { root, id } = startRequest();
  const calls: string[] = [];
  const r = await inRoot(root, () => runHarnessCommand("requests", ["accept", id], root, { launcher: recorder(calls), adapter: "codex" }));
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
  assert.match(r.findings!.join("\n"), /opening a plan session, which codex does not support/);
  assert.match(r.lines!.join("\n"), /Codex: cd .* && codex/);
  assert.equal(readRequest(root, id)!.state, "accepted");
});

test("an LLM-marked caller accepting a plan.start request through the typed route is refused and launches nothing", async () => {
  const { root, id } = startRequest();
  const calls: string[] = [];
  const cwd = process.cwd();
  const saved = process.env.SPECPLANE_ACTOR;
  process.env.SPECPLANE_ACTOR = "llm";
  process.chdir(root);
  let r;
  try { r = await runHarnessCommand("requests", ["accept", id], root, { launcher: recorder(calls), adapter: "claude" }); }
  finally { process.chdir(cwd); if (saved === undefined) delete process.env.SPECPLANE_ACTOR; else process.env.SPECPLANE_ACTOR = saved; }
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
  assert.equal(readRequest(root, id)!.state, "pending");
});

test("accepting a plan.start request for a plan that is already started fails the request and launches nothing", async () => {
  const { root, id } = startRequest();
  startPlan({ root, actor: person, preset: DEFAULT_PRESET, now: NOW, env: {} }, ID);
  const calls: string[] = [];
  const r = await inRoot(root, () => runHarnessCommand("requests", ["accept", id], root, { launcher: recorder(calls), adapter: "claude" }));
  assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
  assert.equal(readRequest(root, id)!.state, "failed");
});

/* ------------------------------------------------------------------ continuation: the chain of sessions (`plan-execution R27`, `reference-cli` §11.3) */

type Act = "step" | "partial" | "none" | "error" | "soft" | "user" | "hard" | "failure";
interface Chain { deps: ClaudeDeps; ids: string[]; seen: { idle: boolean; status: string; marker: unknown }[] }
/** A fake session per spawn: it answers its prompt by doing what `acts[i]` says, then ends like a real one (clean exit after the turn, or an error exit). */
function chain(root: string, ctx: PlanCtx, acts: Act[]): Chain {
  const c: Chain = { ids: [], seen: [], deps: undefined as unknown as ClaudeDeps };
  c.deps = {
    newId: () => `sess-${c.ids.length}`,
    every: () => () => {},
    spawn: (_argv, o) => {
      const i = c.ids.length;
      const session = o.env.SPECPLANE_SESSION!;
      c.ids.push(session);
      const wt = worktreeOf(root, ID)!;
      const info = describePlan(ctx, wt, loadPlanAt(wt, ID)!);
      c.seen.push({ idle: info.idle, status: String(info.status), marker: marker(root) });
      let line: (l: string) => void = () => {};
      let exit!: (c: number | null) => void;
      const act = acts[i] ?? "none";
      return {
        pid: process.pid,
        onLine: (cb) => { line = cb; },
        exited: new Promise((r) => { exit = r; }),
        write: () => {
          queueMicrotask(() => {
            line(JSON.stringify(INIT));
            const next = describePlan(ctx, wt, loadPlanAt(wt, ID)!).next?.number ?? 1;
            if (act === "step") finishStep(root, ctx, next, session);
            else if (act === "partial") finishStep(root, ctx, next, session, "partial");
            else if (act === "soft" || act === "user" || act === "hard" || act === "failure") stopPlan(ctx, ID, { kind: act, reason: `${act} stop` });
            if (act === "error") exit(1); else line(JSON.stringify(RESULT));
          });
        },
        endInput: () => exit(0),
        kill: () => exit(null),
      };
    },
  };
  return c;
}
const stopOf = (root: string) => { const p = progress(root); return { status: p.status, kind: p.stop?.kind, reason: p.stop?.reason }; };
const info = (root: string, ctx: PlanCtx) => { const wt = worktreeOf(root, ID)!; return describePlan(ctx, wt, loadPlanAt(wt, ID)!); };

test("chain: 3 steps and one session per step; the plan is idle between sessions and nothing is left idle at the end", async () => {
  const { root, ctx } = started();
  addSteps(root, 3);
  const c = chain(root, ctx, ["step", "step", "step"]);
  await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0", selection: "all" });
  assert.deepEqual(c.ids, ["sess-0", "sess-1", "sess-2"]);
  assert.equal(c.seen[0].idle, false);
  for (const i of [1, 2]) {
    assert.deepEqual(c.seen[i], { idle: true, status: "in-progress", marker: { session: c.ids[i - 1], ended: "clean" } }, `idle after session ${i}`);
  }
  assert.equal(progress(root).done.length, 3);
  assert.equal(marker(root), null);
  assert.equal(info(root, ctx).idle, false);
  assert.equal(info(root, ctx).reviewPending, true);
});

test("chain: the default selection is the next step, a count stops after N sessions and leaves the plan idle", async () => {
  const { root, ctx } = started();
  addSteps(root, 3);
  const one = chain(root, ctx, ["step", "step"]);
  await runPlanSession(ctx, ID, one.deps, { sessionId: "sess-0" });
  assert.equal(one.ids.length, 1);
  assert.deepEqual(marker(root), { session: "sess-0", ended: "clean" });
  assert.equal(info(root, ctx).idle, true);
  assert.equal(info(root, ctx).status, "in-progress");
  const two = chain(root, ctx, ["step", "step", "step"]);
  await runPlanSession(ctx, ID, two.deps, { sessionId: "sess-0b", selection: "2" });
  assert.equal(two.ids.length, 2, "only step 02 and step 03 are left, so two sessions");
  assert.equal(marker(root), null);
});

test("chain: a range ends at its last step and leaves the plan idle", async () => {
  const { root, ctx } = started();
  addSteps(root, 3);
  const c = chain(root, ctx, ["step", "step", "step"]);
  await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0", selection: "1..2" });
  assert.equal(c.ids.length, 2);
  assert.equal(progress(root).done.length, 2);
  assert.equal(info(root, ctx).idle, true);
  assert.deepEqual(marker(root), { session: c.ids[1], ended: "clean" });
});

test("a selection that does not start at the next step is refused before any session starts", async () => {
  const { root, ctx } = started();
  addSteps(root, 3);
  const c = chain(root, ctx, ["step"]);
  await assert.rejects(runPlanSession(ctx, ID, c.deps, { selection: "2..3" }), (e: Error) => e instanceof PreconditionError && /step 02 cannot run before step 01/.test(e.reasons.join()));
  assert.equal(c.ids.length, 0);
  assert.equal(marker(root)?.session ?? null, null);
  assert.equal(checkSelection(info(root, ctx), 2, "all", 3).ok, false);
  assert.deepEqual(parseSelection("2..3"), { from: 2, count: "all", last: 3 });
  assert.deepEqual([parseSelection("next").count, parseSelection("4").count, parseSelection("all").count], [1, 4, "all"]);
  assert.throws(() => parseSelection("3..2"));
});

for (const kind of ["soft", "user", "hard", "failure"] as const) {
  test(`chain: a recorded ${kind} stop is kept, no clean-end record is written and the chain ends`, async () => {
    const { root, ctx } = started();
    addSteps(root, 3);
    const c = chain(root, ctx, ["step", kind, "step"]);
    await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0", selection: "all" });
    assert.equal(c.ids.length, 2);
    assert.deepEqual(stopOf(root), { status: "stopped", kind, reason: `${kind} stop` });
    assert.equal(marker(root), null);
    assert.equal(info(root, ctx).idle, false);
  });
}

for (const [name, act] of [["an error exit", "error"], ["a clean exit with the step not done", "none"], ["a partial outcome", "partial"]] as const) {
  test(`chain: ${name} records a failure stop "step 2 not finished" and does not start that step again`, async () => {
    const { root, ctx } = started();
    addSteps(root, 3);
    const c = chain(root, ctx, ["step", act, "step"]);
    await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0", selection: "all" });
    assert.equal(c.ids.length, 2);
    assert.deepEqual(stopOf(root), { status: "stopped", kind: "failure", reason: "step 2 not finished" });
    assert.equal(marker(root), null);
    assert.equal(progress(root).done.length, 1);
  });
}

test("status: idle needs a clean-end record of the plan's own session, steps left and no stop", async () => {
  const { root, ctx } = started();
  addSteps(root, 2);
  const c = chain(root, ctx, ["step"]);
  await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0" });
  assert.deepEqual({ s: info(root, ctx).status, idle: info(root, ctx).idle, stop: info(root, ctx).stop }, { s: "in-progress", idle: true, stop: null });
  // a record of another session is ignored: the plan reads as an unexpected end
  writeStore(root, `runs/${ID}.json`, { session: "someone-else", ended: "clean" });
  assert.deepEqual({ s: info(root, ctx).status, idle: info(root, ctx).idle, reason: info(root, ctx).stop?.reason }, { s: "stopped", idle: false, reason: "session ended unexpectedly" });
  // reading the status never rewrites progress.yaml
  assert.equal(progress(root).status, "in-progress");
  // a recorded stop is never idle, even with the right record
  writeStore(root, `runs/${ID}.json`, { session: "sess-0", ended: "clean" });
  stopPlan(ctx, ID, { kind: "soft", reason: "pause" });
  assert.deepEqual({ s: info(root, ctx).status, idle: info(root, ctx).idle, kind: info(root, ctx).stop?.kind }, { s: "stopped", idle: false, kind: "soft" });
});

test("status: with no step left a clean-end record is not idle", async () => {
  const { root, ctx } = started();
  const c = chain(root, ctx, ["step"]);
  await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0" });
  writeStore(root, `runs/${ID}.json`, { session: "sess-0", ended: "clean" });
  assert.equal(info(root, ctx).next, null);
  assert.equal(info(root, ctx).idle, false);
  assert.equal(info(root, ctx).status, "in-progress");
});

test("resume accepts an idle plan, reports no stop and replaces the clean-end record", async () => {
  const { root, ctx } = started();
  addSteps(root, 2);
  const c = chain(root, ctx, ["step"]);
  await runPlanSession(ctx, ID, c.deps, { sessionId: "sess-0" });
  assert.equal(info(root, ctx).idle, true);
  const r = resumePlan({ ...ctx, env: { SPECPLANE_SESSION: "sess-R" } }, ID);
  assert.equal(r.stopped, null);
  assert.equal(r.next!.number, 2);
  assert.equal(progress(root).status, "in-progress");
  assert.equal(marker(root)!.session, "sess-R");
  assert.ok(marker(root)!.heartbeat);
  assert.equal(info(root, ctx).idle, false);
});
