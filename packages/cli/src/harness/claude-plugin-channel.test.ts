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

// ---- the arrival dialogue through the hook routes, and the answer line ----
const chLoad = async (): Promise<any> => import(pathToFileURL(path.join(repo, "harnesses/claude/plugin/hooks/channel.ts")).href); // eslint-disable-line @typescript-eslint/no-explicit-any
function hookFakes(answer: string | Error, id: string) {
  const asked: string[] = [];
  const logs: string[] = [];
  const prompts: string[] = [];
  const record = { id, state: "pending", from: { role: "llm" }, action: { command: "plan start" }, reason: "r" };
  const $ = {
    plugin: { root: "/p" },
    ui: { ask: async (q: string) => { asked.push(q); if (answer instanceof Error) throw answer; return answer; }, log: (m: string) => logs.push(m) },
    clock: { after: (_ms: number, fn: () => void) => fn() },
    prompt: { submit: async (p: { text: string; asUser?: unknown }) => { if ("asUser" in p) throw new Error("human authority"); prompts.push(p.text); } },
    process: { run: async (argv: string[]) => ({ exitCode: 0, stdout: argv.includes("show") ? JSON.stringify({ ok: true, data: record }) : "Accepted.\n", stderr: "" }) },
  };
  return { $, asked, logs, prompts };
}
async function handler(): Promise<(...a: unknown[]) => Promise<any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = await chLoad();
  const hs: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
  m.registerChannel((name: string, h: (...a: unknown[]) => Promise<unknown>) => { hs[name] = h; return { catch: () => undefined }; });
  return hs["tool.call"] as never;
}
const mcpReply = (id: string) => ({ text: JSON.stringify({ ok: true, request: id, findings: [] }) });
const nextOf = (r: unknown) => Object.assign(async () => r, { budget: { remainingMs: 1000 } });

test("a call served by the MCP server opens one dialogue and a prompt without authority tells the model", opts, async () => {
  const h = await handler();
  const f = hookFakes("Accept", "m1");
  const reply = mcpReply("m1");
  const out = await h(f.$, { tool: "mcp__specplane__plan_start" }, nextOf(reply));
  assert.equal(f.asked.length, 1);
  assert.equal(out, reply); // the MCP server's reply is not rewritten; the model is told by a prompt instead
  assert.deepEqual(f.prompts, ["Specplane: request m1 was accepted by the user (Accepted.). Do not send it again."]);
  // the same request seen again (the other route) opens nothing and leaves the reply as it is
  const again = await h(f.$, { tool: "mcp__specplane__plan_start" }, nextOf(reply));
  assert.equal(f.asked.length, 1);
  assert.equal(again, reply);
});

test("Decline is reported to the model; Skip and a rejecting ask leave the reply unchanged", opts, async () => {
  const h = await handler();
  const d = hookFakes("Decline", "m2");
  await h(d.$, { tool: "mcp__specplane__x" }, nextOf(mcpReply("m2")));
  assert.match(d.prompts[0]!, /request m2 was declined by the user/);
  const s = hookFakes("Skip", "m3");
  const rs = mcpReply("m3");
  assert.equal(await h(s.$, { tool: "mcp__specplane__x" }, nextOf(rs)), rs);
  assert.deepEqual(s.prompts, []);
  const e = hookFakes(new Error("no UI"), "m4");
  const re = mcpReply("m4");
  assert.equal(await h(e.$, { tool: "mcp__specplane__x" }, nextOf(re)), re);
  assert.deepEqual(e.prompts, []);
});

test("non-request replies, error replies and other tools open nothing", opts, async () => {
  const h = await handler();
  const f = hookFakes("Accept", "m5");
  const plain = { text: JSON.stringify({ ok: true, findings: [] }) };
  assert.equal(await h(f.$, { tool: "mcp__specplane__x" }, nextOf(plain)), plain);
  const err = { isError: true, text: JSON.stringify({ request: "m5" }) };
  assert.equal(await h(f.$, { tool: "mcp__specplane__x" }, nextOf(err)), err);
  const other = mcpReply("m5");
  assert.equal(await h(f.$, { tool: "mcp__other__x" }, nextOf(other)), other);
  assert.equal(await h(f.$, { tool: "Read" }, nextOf(other)), other);
  assert.equal(f.asked.length, 0);
});

test("the arrival dialogue returns the reply line for Accept, nothing for Skip, and one dialogue per id with a seen set", opts, async () => {
  const m = await cmdsLoad();
  const f = arrivalFakes("Accept");
  const seen = new Set<string>();
  const note = await m.arrivalDialogue(created, f.ask, f.core, f.log, seen);
  assert.equal(note.line, "The user answered this request in the dialogue: accepted. Accepted r1.");
  assert.equal(await m.arrivalDialogue(created, f.ask, f.core, f.log, seen), undefined);
  assert.equal(f.asked.length, 1);
  assert.equal(await m.arrivalDialogue(created, arrivalFakes("Skip").ask, f.core, f.log), undefined);
});

test("a failing prompt submit is logged and never thrown", opts, async () => {
  const m = await chLoad();
  const logs: string[] = [];
  const $ = { clock: { after: (_: number, fn: () => void) => fn() }, prompt: { submit: async () => { throw new Error("x"); } }, ui: { log: (s: string) => logs.push(s) } };
  m.submitNote($, "hello");
  await new Promise(r => setTimeout(r, 10));
  assert.equal(logs.length, 1);
});

test("an accepted request whose action failed is reported as failed, and a transient failure lets the id retry", opts, async () => {
  const m = await cmdsLoad();
  const f = arrivalFakes("Accept");
  const failing = { run: async (argv: string[]) => argv.includes("show") ? f.core.run(argv) : { exitCode: 1, stdout: "", stderr: "The request was accepted but the action could not be done, so it is marked failed: branch exists\n" } };
  const note = await m.arrivalDialogue(created, f.ask, failing, f.log);
  assert.match(note.line, /accepted but the action failed: The request was accepted but the action could not be done/);
  assert.match(note.prompt, /was accepted by the user but the action failed: /);
  const seen = new Set<string>();
  const down = { run: async () => ({ exitCode: 1, stdout: "", stderr: "" }) };
  await m.arrivalDialogue(created, f.ask, down, f.log, seen);
  assert.equal(seen.has("r1"), false);
  const n2 = await m.arrivalDialogue(created, f.ask, f.core, f.log, seen);
  assert.ok(n2); assert.equal(seen.has("r1"), true);
  const sk = new Set<string>();
  await m.arrivalDialogue(created, arrivalFakes("Skip").ask, f.core, f.log, sk);
  assert.equal(sk.has("r1"), true);
});

test("a throwing clock is logged and never thrown", opts, async () => {
  const m = await chLoad();
  const logs: string[] = [];
  m.submitNote({ clock: { after: () => { throw new Error("x"); } }, ui: { log: (s: string) => logs.push(s) } }, "hello");
  assert.equal(logs.length, 1);
  const logs2: string[] = [];
  m.submitNote({ clock: { after: (_: number, fn: () => void) => fn() }, prompt: { submit: () => { throw new Error("sync"); } }, ui: { log: (s: string) => logs2.push(s) } }, "hello");
  assert.equal(logs2.length, 1);
});

// ---- the push notification (requests R52.5) ----
function pushFakes(cfg: { push?: unknown; perms?: unknown; state?: string; perm?: string[] }, ask: string | Error = "Accept", notifyFails = false) {
  const f = arrivalFakes(ask);
  const record = { id: "r1", state: cfg.state ?? "pending", from: { role: "llm" }, action: { command: "spec edit" }, permissions: cfg.perm ?? ["spec.edit"], reason: "secret reason", diff: "-a\n+b" };
  const order: string[] = [];
  const core = { run: async (argv: string[]) => {
    f.calls.push(argv);
    if (argv[0] === "config") return { exitCode: 0, stdout: JSON.stringify({ data: { value: argv[2] === "notifications.push" ? (cfg.push ?? false) : (cfg.perms ?? ["all"]) } }), stderr: "" };
    return { exitCode: 0, stdout: argv.includes("show") ? JSON.stringify({ ok: true, data: record }) : "Accepted r1.\n", stderr: "" };
  } };
  const sent: { text: string; opts: { title: string; key: string } }[] = [];
  const cancelled: string[] = [];
  const push = {
    notify: async (text: string, opts: { title: string; key: string }) => { order.push("notify"); if (notifyFails) throw new Error("no channel"); sent.push({ text, opts }); return { isSent: true }; },
    cancel: async (k: string) => { order.push("cancel"); cancelled.push(k); },
  };
  const ask2 = { ask: async (q: string) => { order.push("ask"); return f.ask.ask(q); } };
  return { ...f, core, push, sent, cancelled, order, ask: ask2 };
}

test("push: one notification before the dialogue, short text only, cancelled after the answer", opts, async () => {
  const m = await cmdsLoad();
  const f = pushFakes({ push: true });
  await m.arrivalDialogue(created, f.ask, f.core, f.log, undefined, f.push);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0]!.opts, { title: "Specplane", key: "specplane-request-r1" });
  assert.equal(f.sent[0]!.text, "Specplane: a request is waiting: spec edit (from llm). Open /requests to answer.");
  assert.doesNotMatch(f.sent[0]!.text, /secret|\+b/);
  assert.deepEqual(f.order, ["notify", "ask", "cancel"]);
  assert.deepEqual(f.cancelled, ["specplane-request-r1"]);
});

test("push: nothing when off, when the permission is not listed, or when the record is not pending", opts, async () => {
  const m = await cmdsLoad();
  for (const cfg of [{ push: false }, { push: true, perms: ["spec.approve.feature"] }, { push: true, state: "accepted" }]) {
    const f = pushFakes(cfg);
    await m.arrivalDialogue(created, f.ask, f.core, f.log, undefined, f.push);
    assert.equal(f.sent.length, 0);
  }
  const g = pushFakes({ push: true, perms: ["spec.edit"] });
  await m.arrivalDialogue(created, g.ask, g.core, g.log, undefined, g.push);
  assert.equal(g.sent.length, 1);
});

test("push: sent even when the dialogue cannot open, and then not cancelled", opts, async () => {
  const m = await cmdsLoad();
  const f = pushFakes({ push: true }, new Error("no ask in -p"));
  await m.arrivalDialogue(created, f.ask, f.core, f.log, undefined, f.push);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.cancelled, []);
});

test("push: a failing notification is logged and the dialogue still runs", opts, async () => {
  const m = await cmdsLoad();
  const f = pushFakes({ push: true }, "Accept", true);
  const note = await m.arrivalDialogue(created, f.ask, f.core, f.log, undefined, f.push);
  assert.equal(f.asked.length, 1);
  assert.ok(note);
  assert.ok(f.logs.some((l: string) => /notification failed/.test(l)));
});
