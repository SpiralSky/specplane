import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createClaudeSessionAdapter, parseClaudeSessions, sessionIdFor, stepPrompt, type SessionCommandOptions, type SessionCommandRunner } from "./session.js";
const plan = "2026-10-30-plan-conductor";
const id = sessionIdFor(plan, 1);
const flags = "--bg --cwd <path> --name <name> --session-id <id> --permission-mode <mode> --permission-prompts <mode> --resume <id> --max-budget-usd <number>";
const request = (checkout: string) => ({ checkout, name: "specplane/test/1", sessionId: id, prompt: stepPrompt(plan) });
function fake() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-adapter-"));
  const calls: { args: string[]; options: SessionCommandOptions }[] = [];
  const sessions: { sessionId: string; status: string; pid: number; cwd: string; name: string }[] = [];
  const run: SessionCommandRunner = (args, options) => {
    calls.push({ args, options });
    if (args[0] === "--version") return "test-double-only 1.0";
    if (args[0] === "--help") return flags;
    if (args.join(" ") === "agents --help") return "--json";
    if (args.join(" ") === "agents --json") return JSON.stringify({ agents: sessions });
    assert.equal(args[0], "--bg");
    const sessionId = args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1];
    const existing = sessions.find((s) => s.sessionId === sessionId);
    const row = { sessionId, status: "running", pid: 12345, cwd: root, name: "specplane/test/1" };
    if (existing) Object.assign(existing, row); else sessions.push(row);
    return "background launch requested";
  };
  return { root, calls, sessions, run };
}
test("session identity: UUIDv5 is stable and distinct by plan/step", () => {
  assert.equal(sessionIdFor(plan, 1), id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(sessionIdFor(plan, 2), id);
  assert.notEqual(sessionIdFor("2026-10-30-other-plan", 1), id);
  assert.throws(() => sessionIdFor("../../bad", 1));
  assert.throws(() => sessionIdFor(plan, 0));
  assert.equal(stepPrompt(plan), `run /plan-step ${plan} --unattended`);
});
test("Claude adapter: unsupported capabilities refuse before launch", () => {
  const f = fake();
  const run: SessionCommandRunner = (args, opts) => args[0] === "--help" ? "--bg-only --cwd" : f.run(args, opts);
  assert.throws(() => createClaudeSessionAdapter({ root: f.root, backend: "worktree", run }).spawn(request(f.root)), /lacks required background capabilities/);
  assert.equal(f.calls.some((c) => c.args[0] === "--bg"), false);
  const missing = createClaudeSessionAdapter({ root: f.root, backend: "worktree", run: () => { throw new Error("not installed"); } });
  assert.throws(() => missing.checkCapabilities(), /not installed/);
});
test("Claude adapter: external and branch backends refuse without executing", () => {
  for (const backend of ["external", "branch"] as const) {
    const adapter = createClaudeSessionAdapter({ root: "/tmp", backend, run: () => { assert.fail("must not execute"); } });
    assert.throws(() => adapter.checkCapabilities(), backend === "external" ? /external environment runs its own sessions/ : /requires the worktree/);
  }
});
test("Claude adapter: argument array, env, no extra worktree, and adoption", () => {
  const f = fake();
  execFileSync("git", ["init", "-q", f.root]);
  const before = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: f.root, encoding: "utf8" });
  const adapter = createClaudeSessionAdapter({ root: f.root, backend: "worktree", run: f.run });
  const handle = adapter.spawn({ ...request(f.root), budgetUsd: 0.25, env: { SPECPLANE_FORCE_REASON: "a test", SPECPLANE_SESSION: "cannot-override" } });
  assert.deepEqual(handle, { sessionId: id, pid: 12345 });
  const launch = f.calls.find((c) => c.args[0] === "--bg")!;
  assert.deepEqual(launch.args, ["--bg", "--cwd", f.root, "--name", "specplane/test/1", "--session-id", id, "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--max-budget-usd", "0.25", stepPrompt(plan)]);
  assert.equal(launch.options.env?.SPECPLANE_SESSION, id);
  assert.equal(launch.options.env?.SPECPLANE_FORCE_REASON, "a test");
  assert.ok(!launch.args.some((s) => ["--worktree", "--tmux", "--dangerously-skip-permissions"].includes(s)));
  assert.equal(adapter.observe(id), "running");
  assert.deepEqual(adapter.spawn(request(f.root)), handle);
  assert.equal(f.calls.filter((c) => c.args[0] === "--bg").length, 1);
  assert.equal(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: f.root, encoding: "utf8" }), before);
  assert.match(adapter.commands(id).attach, /^claude attach /);
  assert.doesNotMatch(Object.values(adapter.commands(id)).join(" "), /claude rm/);
});
test("Claude adapter: restart resumes failed session without new identity", () => {
  const f = fake();
  f.sessions.push({ sessionId: id, status: "failed", pid: 789, cwd: f.root, name: "specplane/test/1" });
  const adapter = createClaudeSessionAdapter({ root: f.root, backend: "worktree", run: f.run });
  adapter.spawn({ ...request(f.root), resume: true });
  const launch = f.calls.find((c) => c.args[0] === "--bg")!;
  assert.ok(launch.args.includes("--resume"));
  assert.ok(!launch.args.includes("--session-id"));
  assert.equal(f.sessions.length, 1);
});
test("Claude adapter: missing resume and conflicting live identities refuse", () => {
  const f = fake();
  const adapter = createClaudeSessionAdapter({ root: f.root, backend: "worktree", run: f.run });
  assert.throws(() => adapter.spawn({ ...request(f.root), resume: true }), /resume session is missing/);
  f.sessions.push({ sessionId: sessionIdFor(plan, 2), status: "running", pid: 789, cwd: f.root, name: "another" });
  assert.throws(() => adapter.spawn(request(f.root)), /Another live session/);
  f.sessions.splice(0, 1, { sessionId: id, status: "running", pid: 789, cwd: "/different", name: "another" });
  assert.throws(() => adapter.spawn(request(f.root)), /different checkout or name/);
  assert.ok(!f.calls.some((c) => c.args[0] === "--bg"));
});
test("Claude observation: invalid records are never treated as missing", () => {
  for (const value of ["", "{}", '{"agents":[{}]}', '{"agents":[{"sessionId":"x","status":"mystery","pid":1,"cwd":"/tmp","name":"n"}]}']) assert.throws(() => parseClaudeSessions(value));
  const row = { sessionId: id, status: "running", pid: 1, cwd: "/tmp", name: "n" };
  assert.throws(() => parseClaudeSessions(JSON.stringify([row, row])), /Duplicate/);
  assert.deepEqual(parseClaudeSessions("[]"), []);
});
test("Claude adapter: unobservable launch reports uncertainty, no retry", () => {
  const f = fake(); let launches = 0;
  const run: SessionCommandRunner = (args, opts) => { if (args[0] === "--bg") { launches++; return "queued"; } return f.run(args, opts); };
  assert.throws(() => createClaudeSessionAdapter({ root: f.root, backend: "worktree", run }).spawn(request(f.root)), /outcome is uncertain/);
  assert.equal(launches, 1);
});
test("Claude adapter: invalid budgets and missing budget support refuse", () => {
  const f = fake(); const adapter = createClaudeSessionAdapter({ root: f.root, backend: "worktree", run: f.run });
  for (const budgetUsd of [0, -1, Infinity, NaN]) assert.throws(() => adapter.spawn({ ...request(f.root), budgetUsd }), /positive finite/);
  const run: SessionCommandRunner = (args, opts) => args[0] === "--help" ? flags.replace("--max-budget-usd", "--other-budget") : f.run(args, opts);
  assert.throws(() => createClaudeSessionAdapter({ root: f.root, backend: "worktree", run }).spawn({ ...request(f.root), budgetUsd: 1 }), /max-budget-usd/);
});

test("Claude adapter: harness notification is local and never invokes CLI", () => {
  const messages: string[] = [];
  const adapter = createClaudeSessionAdapter({ root: process.cwd(), backend: "worktree", emit: message => { messages.push(message); }, run: () => { throw new Error("must not run"); } });
  adapter.notify!("Plan needs attention");
  assert.deepEqual(messages, ["Plan needs attention"]);
});
