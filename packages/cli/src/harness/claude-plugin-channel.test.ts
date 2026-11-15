/**
 * Offline coverage for the Claude Code mod's action channel (`claude-integration` §10, `reference-cli` §12.8): the pure
 * request, reply and retry logic of harnesses/claude/plugin/hooks/core-channel.ts, with the host calls faked. The plugin
 * source is TypeScript, so Bun loads it; the Node fallback skips this file.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const opts = { skip: hasBun ? false : "loads TypeScript source; run with Bun" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import(pathToFileURL(path.join(repo, "harnesses/claude/plugin/hooks/core-channel.ts")).href);

const ready = (n = 1) => ({ socket: `/s${n}`, secret: `k${n}`, pid: n, actions: [] });
const done = (text: string, isError = false) => ({ status: 200, text: JSON.stringify({ status: "done", text, isError }) });

test("the readiness line is parsed and a bad one is named", opts, async () => {
  const m = await load();
  const r = m.parseReadiness(JSON.stringify({ socket: "/x.sock", secret: "s", pid: 7, actions: [{ name: "spec_retrieve", description: "d", inputSchema: { type: "object" } }] }) + "\n");
  assert.equal(r.socket, "/x.sock");
  assert.deepEqual(r.actions[0], { name: "spec_retrieve", description: "d", inputSchema: { type: "object" } });
  assert.throws(() => m.parseReadiness("not json"), /not JSON/);
  assert.throws(() => m.parseReadiness(JSON.stringify({ socket: "/x", actions: [] })), /no secret/);
  assert.throws(() => m.parseReadiness(JSON.stringify({ socket: "/x", secret: "s" })), /no action list/);
});

test("the server starts through sh with the host pid, both versions, and an empty version stays an argument", opts, async () => {
  const m = await load();
  const argv = m.serverArgv("/p/core/dist/harness/session-server-main.js", "sess", "/proj", "", "2.1.322");
  assert.deepEqual(argv.slice(0, 2), ["sh", "-c"]);
  assert.match(argv[2], /"\$PPID" --host-version "\$3" --checked-version "\$4"/);
  assert.deepEqual(argv.slice(3), ["/p/core/dist/harness/session-server-main.js", "sess", "/proj", "", "2.1.322"]);
  assert.equal(m.versionMatches("2.1.322", "2.1.322"), true);
  assert.equal(m.versionMatches("2.1.323", "2.1.322"), false);
  assert.equal(m.versionMatches("", ""), false);
});

test("only a registered action's tool name is served", opts, async () => {
  const m = await load();
  const names = new Set(["spec_retrieve"]);
  assert.equal(m.actionOfTool("mcp__specplane__spec_retrieve", names), "spec_retrieve");
  assert.equal(m.actionOfTool("mcp__specplane__other", names), undefined);
  assert.equal(m.actionOfTool("mcp__plugin_specplane_specplane__spec_retrieve", names), undefined);
  assert.equal(m.actionOfTool("Bash", names), undefined);
});

test("the call body takes the caller from the engine fields only and leaves them out of the input", opts, async () => {
  const m = await load();
  const e = { tool: "mcp__specplane__spec_retrieve", tool_use_id: "toolu_1", agentId: "a1", requestMeta: { x: "y" }, id: "root:x", caller: { agentId: "forged" } };
  const body = JSON.parse(m.callBody("spec_retrieve", e, "general-purpose", "claude-x"));
  assert.deepEqual(body, { action: "spec_retrieve", input: { id: "root:x", caller: { agentId: "forged" } }, caller: { agentId: "a1", agentType: "general-purpose", toolUseId: "toolu_1" }, model: "claude-x" });
  const main = JSON.parse(m.callBody("spec_retrieve", { tool: "t", tool_use_id: "toolu_2", id: "i" }, "ignored", undefined));
  assert.deepEqual(main, { action: "spec_retrieve", input: { id: "i" }, caller: { toolUseId: "toolu_2" } });
});

test("replies: done, pending, unknown job, wrong secret, shutting down, odd shape", opts, async () => {
  const m = await load();
  assert.deepEqual(m.readAnswer(200, done("hi").text), { kind: "done", reply: { text: "hi", isError: false } });
  assert.deepEqual(m.readAnswer(200, done("bad", true).text).reply, { text: "bad", isError: true });
  assert.deepEqual(m.readAnswer(200, JSON.stringify({ status: "pending", job: "j1" })), { kind: "pending", job: "j1" });
  assert.match(m.readAnswer(404, JSON.stringify({ status: "unknown" })).message, /lost it/);
  assert.match(m.readAnswer(401, "{}").message, /secret/);
  assert.match(m.readAnswer(503, "{}").message, /shutting down/);
  assert.equal(m.readAnswer(200, "[]").kind, "failed");
});

test("failure kinds are told apart", opts, async () => {
  const m = await load();
  assert.equal(m.isConnectionFailure(new Error("$.http.fetch(http://localhost/call) over /s failed: ENOENT")), true);
  assert.equal(m.isConnectionFailure(new Error("connect ECONNREFUSED /s")), true);
  assert.equal(m.isConnectionFailure(new Error("$.http.fetch(...) aborted: no complete answer within 30000ms")), false);
  assert.equal(m.isTimeout(new Error("$.http.fetch(...) aborted: no complete answer within 30000ms")), true);
});

function deps(m: unknown, script: Array<(route: string, body: string) => unknown>, extra: { restart?: () => Promise<unknown>; remaining?: () => number } = {}) {
  let current = ready(1);
  const seen: string[] = [];
  let restarts = 0;
  const d = {
    current: () => current,
    remainingMs: extra.remaining ?? (() => 10_000),
    restart: async () => { restarts++; if (extra.restart) return extra.restart(); current = ready(2); return current; },
    http: async (socket: string, secret: string, route: string, body: string) => {
      seen.push(`${socket}|${secret}|${route}`);
      const step = script.shift();
      if (!step) throw new Error("unexpected request");
      const r = step(route, body);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  void m;
  return { d, seen, restarts: () => restarts };
}

test("a done answer is returned with its error flag", opts, async () => {
  const m = await load();
  const t = deps(m, [() => done("ok")]);
  assert.deepEqual(await m.forward(t.d, "{}"), { reply: { text: "ok", isError: false } });
  assert.deepEqual(t.seen, ["/s1|k1|/call"]);
});

test("a pending answer is polled by job until done, with the same secret", opts, async () => {
  const m = await load();
  const pending = { status: 200, text: JSON.stringify({ status: "pending", job: "j9" }) };
  const t = deps(m, [() => pending, (route: string, body: string) => { assert.equal(route, "/poll"); assert.deepEqual(JSON.parse(body), { job: "j9" }); return pending; }, () => done("late", true)]);
  assert.deepEqual(await m.forward(t.d, "{}"), { reply: { text: "late", isError: true } });
  assert.deepEqual(t.seen, ["/s1|k1|/call", "/s1|k1|/poll", "/s1|k1|/poll"]);
});

test("polling stops with a denial when the hook's time is nearly gone", opts, async () => {
  const m = await load();
  const t = deps(m, [() => ({ status: 200, text: JSON.stringify({ status: "pending", job: "j" }) })], { remaining: () => 100 });
  const out = await m.forward(t.d, "{}");
  assert.match(out.deny, /ran out of time/);
});

test("a failed connection starts a new core once and sends the call again with the new secret", opts, async () => {
  const m = await load();
  const t = deps(m, [() => new Error("failed: ENOENT"), () => done("again")]);
  assert.deepEqual(await m.forward(t.d, "{}"), { reply: { text: "again", isError: false } });
  assert.deepEqual(t.seen, ["/s1|k1|/call", "/s2|k2|/call"]);
  assert.equal(t.restarts(), 1);
});

test("a failed connection twice is denied with the cause, and a core that does not start is named", opts, async () => {
  const m = await load();
  const t = deps(m, [() => new Error("failed: ENOENT"), () => new Error("connect ECONNREFUSED")]);
  const out = await m.forward(t.d, "{}");
  assert.match(out.deny, /ECONNREFUSED/);
  assert.equal(t.restarts(), 1);
  const u = deps(m, [() => new Error("failed: ENOENT")], { restart: async () => { throw new Error("core exited"); } });
  assert.match((await m.forward(u.d, "{}")).deny, /did not start: core exited/);
});

test("a request with no answer in the host's limit is denied: no retry, no new core", opts, async () => {
  const m = await load();
  const t = deps(m, [() => new Error("$.http.fetch(...) aborted: no complete answer within 30000ms")]);
  const out = await m.forward(t.d, "{}");
  assert.match(out.deny, /30000 ms limit/);
  assert.equal(t.restarts(), 0);
  assert.equal(t.seen.length, 1);
});

// ---- the arrival dialogue (claude-integration §3) ----
const cmdsLoad = async (): Promise<any> => import(pathToFileURL(path.join(repo, "harnesses/claude/plugin/hooks/commands.ts")).href); // eslint-disable-line @typescript-eslint/no-explicit-any
function arrivalFakes(answer: string | Error) {
  const calls: string[][] = [];
  const logs: string[] = [];
  const asked: string[] = [];
  const record = { id: "r1", state: "pending", from: { role: "spec-writer" }, action: { command: "spec edit" }, reason: "because", diff: "-a\n+b" };
  const core = { run: async (argv: string[]) => { calls.push(argv); return { exitCode: 0, stdout: argv.includes("show") ? JSON.stringify({ ok: true, data: record }) : "Accepted r1.\n", stderr: "" }; } };
  const ask = { ask: async (q: string) => { asked.push(q); if (answer instanceof Error) throw answer; return answer; } };
  return { calls, logs, asked, core, ask, log: (m: string) => logs.push(m) };
}
const created = JSON.stringify({ ok: true, request: "r1", findings: [] });

test("a reply that created a request opens one dialogue and runs the answer", opts, async () => {
  const m = await cmdsLoad();
  const f = arrivalFakes("Accept");
  await m.arrivalDialogue(created, f.ask, f.core, f.log);
  assert.equal(f.asked.length, 1); assert.match(f.asked[0]!, /spec-writer/); assert.match(f.asked[0]!, /\+b/);
  assert.deepEqual(f.calls[0], ["harness", "run", "--adapter", "claude", "requests", "show", "r1", "--json"]);
  assert.deepEqual(f.calls[1], ["harness", "run", "--adapter", "claude", "requests", "accept", "r1"]);
});

test("other replies and other tools open no dialogue", opts, async () => {
  const m = await cmdsLoad();
  const f = arrivalFakes("Accept");
  await m.arrivalDialogue(JSON.stringify({ ok: true, findings: [] }), f.ask, f.core, f.log);
  await m.arrivalDialogue(JSON.stringify({ ok: false, findings: ["no"] }), f.ask, f.core, f.log);
  await m.arrivalDialogue("not json", f.ask, f.core, f.log);
  assert.equal(f.asked.length, 0); assert.deepEqual(f.calls, []);
});

test("a rejecting ask changes nothing and never throws", opts, async () => {
  const m = await cmdsLoad();
  const f = arrivalFakes(new Error("no UI"));
  await m.arrivalDialogue(created, f.ask, f.core, f.log);
  assert.equal(f.asked.length, 1); assert.equal(f.calls.length, 1);
  const broken = { run: async () => { throw new Error("boom"); } };
  await m.arrivalDialogue(created, f.ask, broken, f.log);
  assert.match(f.logs.at(-1)!, /boom/);
});

test("a held write action reply (ok or not) opens one dialogue; a non-pending record opens none", opts, async () => {
  const m = await cmdsLoad();
  const f = arrivalFakes("Skip");
  await m.arrivalDialogue(JSON.stringify({ ok: true, request: "r1", data: { command: "plan start" } }), f.ask, f.core, f.log);
  await m.arrivalDialogue(JSON.stringify({ ok: false, request: "r1", findings: ["held"] }), f.ask, f.core, f.log);
  assert.equal(f.asked.length, 2);
  const done = { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: { id: "r1", state: "accepted" } }), stderr: "" }) };
  const g = arrivalFakes("Accept");
  await m.arrivalDialogue(created, g.ask, done, g.log);
  assert.equal(g.asked.length, 0);
});
