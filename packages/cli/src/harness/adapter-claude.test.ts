import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { PreconditionError } from "../errors.js";
import { DEFAULT_PRESET, type Actor } from "../perm/permissions.js";
import { createPlan } from "../plan/create.js";
import { loadPlanAt, readStore, worktreeOf, type PlanCtx, type RunMarker } from "../plan/ctx.js";
import { setBudget, startPlan } from "../plan/run.js";
import { sendRequest } from "../requests/ops.js";
import { makeRepo } from "../test-repo.js";
import { buildArgv, claudeLauncher, CLAUDE_RESOURCES, manualCommand, readUsage, runPlanSession, sessionPrompt, type ClaudeDeps, type SessionProcess } from "./adapter-claude.js";
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
  f.exit(0);
  const r = await run;
  assert.equal(r.outcome, "completed");
  assert.equal(marker(root), null);
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
  f.emit(RESULT); f.exit(0);
  assert.equal((await run).outcome, "completed");
  assert.equal(progress(root).status, "in-progress");
});

test("a session without the plugin is stopped, fails, and leaves its marker to go stale", async () => {
  const { root, ctx } = started();
  const f = fake();
  const run = runPlanSession(ctx, ID, f.deps);
  f.emit({ type: "system", subtype: "init", permissionMode: "auto", plugins: [] });
  const r = await run;
  assert.equal(r.outcome, "failed");
  assert.ok(f.kills.includes("SIGTERM"));
  assert.ok(marker(root));
  assert.ok(r.notes.some((n) => /did not report the Specplane plugin/.test(n)));
});

test("a plan that is not in progress, or has no worktree, is refused before anything starts", async () => {
  const { ctx } = started();
  const f = fake();
  await assert.rejects(runPlanSession(ctx, "2026-11-10-missing", f.deps), PreconditionError);
  assert.equal(f.argv.length, 0);
});

test("resume uses the saved session and the manual command names the worktree", () => {
  assert.deepEqual(buildArgv("abc", { resume: true }).slice(0, 4), ["claude", "-p", "--resume", "abc"]);
  assert.match(manualCommand("/w/plan", ID), /^cd "\/w\/plan" && claude "Use the specplane-plan-step skill for plan /);
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
  const sent = sendRequest(llm, { command: "spec approve", params: { ids: ["feature/export"] }, permissions: ["spec.approve"], reason: "approve export", plan: ID, blocking: true });
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
