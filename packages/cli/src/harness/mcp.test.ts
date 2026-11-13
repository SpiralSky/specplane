import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { makeRepo, spec } from "../test-repo.js";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { listRequests, readRequest } from "../requests/store.js";
import { listActions } from "./actions.js";
import { MCP_PROTOCOL_VERSION, createMcpServer, toolName } from "./mcp.js";

const file = "docs/specifications/features/a.md";
function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "auto_warn: false\n", [file]: spec({ id: "feature/a", title: "A", authors: [] }, "# A\n\n## R1: First\n\nText\n") });
  for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"]]) run("git", args, { cwd: root });
  return root;
}
const server = (root: string) => createMcpServer({ root, id: "mcp-session", reportsContext: false, model: "reported-model" });
const rpc = async (s: ReturnType<typeof server>, method: string, params?: unknown, id: number | string = 1) => JSON.parse((await s.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params })))!);
const call = async (s: ReturnType<typeof server>, action: string, args: unknown) => {
  const r = await rpc(s, "tools/call", { name: toolName(action), arguments: args });
  return { ...r, reply: JSON.parse(r.result.content[0].text) };
};

test("initialize negotiates the protocol and notifications get no reply", async () => {
  const s = server(repo());
  const r = await rpc(s, "initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(r.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(await s.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })), null);
  assert.deepEqual((await rpc(s, "ping")).result, {});
});

test("tools/list returns exactly one tool per action with its schema and no user-only tools", async () => {
  const r = await rpc(server(repo()), "tools/list");
  const tools = r.result.tools as { name: string; inputSchema: { additionalProperties: boolean } }[];
  const actions = listActions();
  assert.equal(tools.length, 43);
  assert.deepEqual(tools.map((t) => t.name), actions.map((a) => toolName(a.id)));
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  tools.forEach((t, i) => assert.deepEqual(t.inputSchema, actions[i].inputSchema));
  for (const name of ["request_accept", "request_decline", "role_switch", "spec_override", "dispatch"]) assert.ok(!tools.some((t) => t.name === name), name);
  for (const t of tools) assert.equal(t.inputSchema.additionalProperties, false);
});

test("tools/call runs the action in process under the LLM permission, and malformed requests are errors", async () => {
  const root = repo();
  const s = server(root);
  const ok = await call(s, "spec.retrieve", { ids: ["feature/a"] });
  assert.equal(ok.result.isError, false);
  assert.equal(ok.reply.ok, true);
  const bad = await call(s, "spec.retrieve", { ids: [] });
  assert.equal(bad.result.isError, true);
  assert.match(bad.reply.findings.join(), /Invalid input/);
  const held = await call(s, "spec.delete", { spec: "feature/a" });
  assert.equal(held.result.isError, false);
  assert.ok(held.reply.request);
  assert.equal(listRequests(root).length, 1);
  assert.equal(fs.existsSync(path.join(root, file)), true, "request-user writes nothing");
  assert.equal((await rpc(s, "tools/call", { name: "role_switch", arguments: {} })).error.code, -32602);
  assert.equal((await rpc(s, "nope")).error.code, -32601);
  assert.equal(JSON.parse((await s.handleLine("{not json"))!).error.code, -32700);
  assert.equal(JSON.parse((await s.handleLine(JSON.stringify({ id: 1, method: "ping" })))!).error.code, -32600);
});

test("a denied permission is refused in process and an injected role is rejected", async () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "spec.delete.feature": "deny" };
  try {
    const s = server(root);
    const denied = await call(s, "spec.delete", { spec: "feature/a" });
    assert.equal(denied.result.isError, true);
    assert.match(denied.reply.findings.join(), /permission/);
    const injected = await call(s, "spec.delete", { spec: "feature/a", role: "administrator", actor: { role: "administrator" } });
    assert.equal(injected.result.isError, true);
    assert.equal(listRequests(root).length, 0);
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("the stdio entry point serves tools/list and tools/call with the adapter's session identity", async () => {
  const root = repo();
  const main = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-main.js");
  const child = spawn(process.execPath, [main], { cwd: root, env: { ...process.env, SPECPLANE_CHECKOUT: root, SPECPLANE_SESSION: "stdio-session", SPECPLANE_MODEL: "stdio-model" }, stdio: ["pipe", "pipe", "pipe"] });
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "spec_create", arguments: { spec: "feature/new", text: spec({ id: "feature/new", title: "N", authors: [] }) } } },
  ];
  child.stdin.end(requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  const replies = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(replies.map((r) => r.id), [1, 2, 3]);
  assert.equal(replies[1].result.tools.length, 43);
  const requestId = JSON.parse(replies[2].result.content[0].text).request;
  assert.ok(requestId);
  const stored = readRequest(root, requestId)!;
  assert.equal(stored.from.session, "stdio-session");
});
