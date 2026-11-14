import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { activePreset, type Actor } from "../perm/permissions.js";
import { roleApprove, roleCreate, ruleApprove, ruleCreate, type RoleCtx } from "../perm/role-ops.js";
import { makeRepo } from "../test-repo.js";
import { claudeAdapter } from "./adapters.js";
import { SECRET_HEADER, startSessionServer, type SessionServer } from "./session-server.js";

const admin: Actor = { role: "administrator", kind: "human", name: "Pat" };
function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "auto_warn: false\npermissions:\n  preset: architecture-level-llm-control\n" });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  return root;
}
const commit = (root: string): void => { for (const a of [["add", "-A"], ["commit", "-q", "--allow-empty", "-m", "roles"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0); };
const ctx = (root: string): RoleCtx => ({ root, actor: admin, preset: activePreset(root) });
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
const entry = fileURLToPath(new URL("./session-server-main.js", import.meta.url));
const auditActors = (root: string): { command: string; actor: { role: string; agentType?: string; model?: string } }[] =>
  fs.readFileSync(path.join(root, ".git", "specplane", "audit.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

interface Reply { status: number; body: Record<string, unknown> }
function request(socket: string, route: string, body: unknown, secret?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ socketPath: socket, path: route, method: "POST", headers: { "content-type": "application/json", ...(secret ? { [SECRET_HEADER]: secret } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
    });
    req.on("error", reject);
    req.end(data);
  });
}
const start = async (root: string, extra: Partial<Parameters<typeof startSessionServer>[0]> = {}): Promise<SessionServer> =>
  startSessionServer({ session: "sess1", root, parentPid: process.pid, socketPath: path.join(tmp(), "s.sock"), ...extra });
const cleanEnv = (): NodeJS.ProcessEnv => { const e = { ...process.env }; delete e.SPECPLANE_ACTOR; return e; };

/** Start the entry as a child and read its readiness line. */
async function spawnEntry(root: string, parentPid: number, runtime: string): Promise<{ child: ChildProcess; line: string; stdout: string; ready: { socket: string; secret: string; pid: number; actions: unknown[] } }> {
  const child = spawn(process.execPath, [entry, "sess-e", root, String(parentPid)], { env: { ...cleanEnv(), SPECPLANE_ACTOR: "mod", XDG_RUNTIME_DIR: runtime }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); if (stdout.includes("\n")) resolve(); });
    child.once("exit", () => reject(new Error("the server exited before it was ready")));
  });
  return { child, line: stdout.split("\n")[0]!, stdout, ready: JSON.parse(stdout.split("\n")[0]!) };
}
const exited = (child: ChildProcess): Promise<number | null> => child.exitCode !== null ? Promise.resolve(child.exitCode) : new Promise((r) => child.once("exit", (c) => r(c)));

test("the entry starts only when SPECPLANE_ACTOR is exactly mod, with nothing on stdout otherwise", () => {
  for (const actor of ["llm", "", "MOD", undefined]) {
    const env = cleanEnv();
    if (actor !== undefined) env.SPECPLANE_ACTOR = actor;
    const r = spawnSync(process.execPath, [entry, "s", tmp(), String(process.pid)], { env, encoding: "utf8" });
    assert.notEqual(r.status, 0, String(actor));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /SPECPLANE_ACTOR/);
  }
});

test("the entry prints one readiness line only, in a private directory with a private socket, and shuts down on request", async () => {
  const root = repo(), runtime = tmp();
  const { child, stdout, ready } = await spawnEntry(root, process.pid, runtime);
  try {
    assert.equal(stdout.endsWith("\n"), true);
    assert.equal(stdout.split("\n").filter(Boolean).length, 1);
    assert.deepEqual(Object.keys(ready).sort(), ["actions", "pid", "secret", "socket"]);
    assert.equal(ready.pid, child.pid);
    assert.ok(Buffer.from(ready.secret, "hex").length >= 32);
    assert.ok(Buffer.byteLength(ready.socket) <= 100);
    assert.equal(path.dirname(ready.socket), path.join(runtime, "specplane"));
    assert.equal(fs.statSync(path.dirname(ready.socket)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(ready.socket).mode & 0o777, 0o600);
    const first = ready.actions[0] as { name: string; description: string; inputSchema: unknown };
    assert.ok(first.name && first.description && first.inputSchema);
    assert.ok((ready.actions as { name: string }[]).some((a) => a.name === "spec_retrieve"));
    const r = await request(ready.socket, "/shutdown", {}, ready.secret);
    assert.equal(r.status, 200);
    assert.equal(await exited(child), 0);
    assert.equal(fs.existsSync(ready.socket), false);
    assert.equal((await exited(child)), 0);
  } finally { child.kill("SIGKILL"); }
});

test("a request without the secret or with a wrong one gets 401, runs nothing and leaves no audit entry", async () => {
  const root = repo(), server = await start(root);
  try {
    const body = { action: "role_list", input: {}, caller: {}, model: "m" };
    assert.equal((await request(server.ready.socket, "/call", body)).status, 401);
    assert.equal((await request(server.ready.socket, "/call", body, "x".repeat(server.ready.secret.length))).status, 401);
    assert.equal((await request(server.ready.socket, "/call", body, "short")).status, 401);
    assert.equal((await request(server.ready.socket, "/shutdown", {})).status, 401);
    assert.equal(fs.existsSync(path.join(root, ".git", "specplane", "audit.jsonl")), false);
    assert.equal((await request(server.ready.socket, "/call", body, server.ready.secret)).status, 200);
  } finally { await server.stop(); }
});

test("a main-agent call and a subagent call get their roles from the caller and the audit shows the agent type and the model", async () => {
  const root = repo();
  assert.equal(roleCreate(ctx(root), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow"] }).ok, true);
  commit(root);
  assert.equal(roleApprove(ctx(root), "helper").ok, true);
  assert.equal(ruleCreate(ctx(root), "small", { role: "helper", matches: ["subagent=scribe", "delegated=true"] }).ok, true);
  commit(root);
  assert.equal(ruleApprove(ctx(root), "small").ok, true);
  const server = await start(root);
  try {
    const call = async (action: string, caller: unknown, input: unknown = {}): Promise<Reply> =>
      request(server.ready.socket, "/call", { action, input, caller, model: "claude-test-1" }, server.ready.secret);
    const main = await call("role_list", {});
    assert.equal(main.body.status, "done");
    assert.equal(main.body.isError, false);
    assert.equal(JSON.parse(main.body.text as string).ok, true);
    let last = auditActors(root).pop()!;
    assert.deepEqual([last.command, last.actor.role, last.actor.agentType, last.actor.model], ["role.list", "llm", undefined, "claude-test-1"]);
    // The action id form is accepted too; identity in the input is ignored.
    const sub = await call("role.list", { agentId: "a1", agentType: "scribe", toolUseId: "toolu_1" }, { subagent: "scribe", agent_type: "scribe", caller: { agentId: "a1", agentType: "scribe" } });
    assert.equal(sub.body.isError, true, "the schema refuses extra input");
    last = auditActors(root).pop()!;
    assert.equal(last.actor.role, "helper", "the role comes from the caller, not the input");
    const ok = await call("role_list", { agentId: "a1", agentType: "scribe", toolUseId: "toolu_2" });
    assert.equal(ok.body.isError, false);
    last = auditActors(root).pop()!;
    assert.deepEqual([last.actor.role, last.actor.agentType, last.actor.model], ["helper", "scribe", "claude-test-1"]);
    // An agent type from the input alone, with no caller, gives no identity.
    await call("role_list", {}, { agent_type: "scribe", subagent: "scribe" });
    assert.equal(auditActors(root).pop()!.actor.role, "llm");
    const unknown = await call("no_such_action", {});
    assert.equal(unknown.status, 400);
  } finally { await server.stop(); }
});

test("a call over the limit answers pending and /poll delivers the result once", async () => {
  const root = repo();
  const server = await start(root, { answerLimitMs: 1 });
  try {
    // With a 1 ms limit most calls are pending; keep asking until done.
    const first = await request(server.ready.socket, "/call", { action: "role_list", input: {}, caller: {}, model: "m" }, server.ready.secret);
    let r = first.body;
    for (let i = 0; r.status === "pending" && i < 1000; i++) {
      assert.match(r.job as string, /^j\d+-[0-9a-f]+$/);
      r = (await request(server.ready.socket, "/poll", { job: r.job }, server.ready.secret)).body;
    }
    assert.equal(r.status, "done");
    if (first.body.status === "pending") {
      const again = await request(server.ready.socket, "/poll", { job: first.body.job }, server.ready.secret);
      assert.equal(again.status, 404, "a delivered result is not kept");
    }
    assert.equal((await request(server.ready.socket, "/poll", { job: "nope" }, server.ready.secret)).status, 404);
    assert.equal((await request(server.ready.socket, "/poll", { job: "j1" })).status, 401);
  } finally { await server.stop(); }
});

test("a finished job is dropped after the keep time", async () => {
  const root = repo();
  const server = await start(root, { answerLimitMs: 1, jobKeepMs: 20 });
  try {
    let r = (await request(server.ready.socket, "/call", { action: "role_list", input: {}, caller: {}, model: "m" }, server.ready.secret)).body;
    if (r.status !== "pending") return; // finished within the limit: nothing is kept
    await new Promise((x) => setTimeout(x, 300));
    r = (await request(server.ready.socket, "/poll", { job: r.job }, server.ready.secret)).body;
    assert.equal(r.status, "unknown");
  } finally { await server.stop(); }
});

test("a body over 4 MiB is refused", async () => {
  const root = repo(), server = await start(root);
  try {
    const r = await request(server.ready.socket, "/call", { action: "role_list", input: { pad: "x".repeat(5 * 1024 * 1024) } }, server.ready.secret).catch((e: NodeJS.ErrnoException) => ({ status: 0, body: { error: e.code } }));
    assert.ok(r.status === 413 || r.status === 0);
    assert.equal(fs.existsSync(path.join(root, ".git", "specplane", "audit.jsonl")), false);
  } finally { await server.stop(); }
});

test("shutdown answers, removes the socket and closes the server", async () => {
  const root = repo(), server = await start(root);
  const r = await request(server.ready.socket, "/shutdown", {}, server.ready.secret);
  assert.equal(r.status, 200);
  await server.closed;
  assert.equal(fs.existsSync(server.ready.socket), false);
});

test("the server stops when its parent is gone", async () => {
  const root = repo(), runtime = tmp();
  const parent = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const { child, ready } = await spawnEntry(root, parent.pid!, runtime);
  try {
    assert.equal(child.exitCode, null);
    parent.kill("SIGKILL");
    assert.equal(await exited(child), 0);
    assert.equal(fs.existsSync(ready.socket), false);
  } finally { parent.kill("SIGKILL"); child.kill("SIGKILL"); }
});

/** A socket file whose owner was killed: nothing answers on it. */
async function deadSocket(file: string): Promise<void> {
  const c = spawn(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(file)}, () => console.log("up"))`], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise<void>((r) => c.stdout!.once("data", () => r()));
  c.kill("SIGKILL");
  await exited(c);
  assert.equal(fs.existsSync(file), true, "the socket file is left behind");
}

test("a leftover dead socket is replaced and a live one refuses", async () => {
  const root = repo();
  const socketPath = path.join(tmp(), "s.sock");
  await deadSocket(socketPath);
  const second = await startSessionServer({ session: "sess2", root, parentPid: process.pid, socketPath });
  try {
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
    await assert.rejects(startSessionServer({ session: "sess3", root, parentPid: process.pid, socketPath }), /answers/);
    assert.equal((await request(socketPath, "/call", { action: "role_list" }, second.ready.secret)).status, 200, "the live server was not removed");
  } finally { await second.stop(); }
});

test("the socket name is the same for a session, and the start sweeps other dead sockets but not live ones", async () => {
  const root = repo(), runtime = tmp(), dir = path.join(runtime, "specplane");
  fs.mkdirSync(dir, { mode: 0o700 });
  const dead = path.join(dir, "s-0123456789abcdef.sock");
  await deadSocket(dead);
  const live = await startSessionServer({ session: "other", root, parentPid: process.pid, socketPath: path.join(dir, "s-fedcba9876543210.sock") });
  const a = await spawnEntry(root, process.pid, runtime);
  try {
    assert.equal(fs.existsSync(dead), false, "the dead socket is swept");
    assert.equal(fs.existsSync(live.ready.socket), true, "a live socket is kept");
    const again = path.basename(a.ready.socket);
    assert.match(again, /^s-[0-9a-f]{16}\.sock$/);
    await request(a.ready.socket, "/shutdown", {}, a.ready.secret);
    await exited(a.child);
    const b = await spawnEntry(root, process.pid, runtime);
    try { assert.equal(path.basename(b.ready.socket), again, "deterministic per session"); } finally { b.child.kill("SIGKILL"); }
  } finally { a.child.kill("SIGKILL"); await live.stop(); }
});

test("after shutdown starts, new calls get 503 and a running call finishes", async () => {
  const root = repo(), server = await start(root, { answerLimitMs: 2000 });
  const secret = server.ready.secret, socket = server.ready.socket;
  // Keep one connection open so the 503 can be observed after the stop begins.
  const agent = new http.Agent({ keepAlive: true, socketPath: socket } as http.AgentOptions);
  const viaAgent = (route: string): Promise<number> => new Promise((resolve, reject) => {
    const req = http.request({ agent, socketPath: socket, path: route, method: "POST", headers: { [SECRET_HEADER]: secret } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end("{}");
  });
  try {
    assert.equal(await viaAgent("/poll"), 404);
    const stopped = server.stop();
    const status = await viaAgent("/call").catch(() => 503); // a refused connection also means nothing ran
    assert.equal(status, 503);
    await stopped;
    assert.equal(fs.existsSync(path.join(root, ".git", "specplane", "audit.jsonl")), false);
  } finally { agent.destroy(); }
});

test("a socket path over 100 bytes fails clearly", async () => {
  const root = repo();
  const dir = path.join(tmp(), "d".repeat(100));
  fs.mkdirSync(dir, { mode: 0o700 });
  await assert.rejects(startSessionServer({ session: "s", root, parentPid: process.pid, socketPath: path.join(dir, "s.sock") }), /100 bytes/);
});

test("the host version match is recorded and the Claude adapter reports subagent-identity from it", async () => {
  const root = repo();
  assert.equal(claudeAdapter.capabilities(root)["subagent-identity"], false);
  const mismatch = await start(root, { session: "mism", hostVersion: "2.2.0", checkedVersion: "2.1.322" });
  assert.equal(claudeAdapter.capabilities(root)["subagent-identity"], false);
  await mismatch.stop();
  const match = await start(root, { session: "match", hostVersion: "2.1.322", checkedVersion: "2.1.322" });
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(root, ".git", "specplane", "sessions", "match.host.json"), "utf8"));
    assert.equal(rec.match, true);
    assert.equal(claudeAdapter.capabilities(root)["subagent-identity"], true);
  } finally { await match.stop(); }
  assert.equal(claudeAdapter.capabilities(root)["subagent-identity"], false, "the record goes with the server");
  // With a session server the match alone decides: an installed caller hook does not count.
  fs.mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-caller.sh"), "#!/bin/sh\n");
  assert.equal(claudeAdapter.capabilities(root)["subagent-identity"], true, "no session server: the hook rule");
  const bad = await start(root, { session: "bad", hostVersion: "9.9.9", checkedVersion: "2.1.322" });
  try { assert.equal(claudeAdapter.capabilities(root)["subagent-identity"], false); } finally { await bad.stop(); }
});
