import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo, stepFile, id } from '../core/workflow-test-fixture.js';
import { sha256 } from '../core/workflow-preparation.js';
import { createWorkflowRunner, type RunnerResponse } from '../core/workflow-runner.js';
import type { ExecutionPort } from '../core/contracts.js';
import { createClaudeMcpServer, MAX_RESULT_BYTES, MCP_PROTOCOL_VERSION, TOOLS, type RunnerPort } from './claude-mcp.js';

const NONCE = 'nonce-0123456789abcdef';

/** A runner stand-in that records each forwarded request and answers ok. */
type Respond = (method: string, params: Record<string, unknown>) => Record<string, unknown>;
function fakeRunner(respond: Respond = method => ({ protocol: 1, ok: true, value: { echoed: method }, notices: [] })): RunnerPort & { calls: Array<{ method: string; params: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    async handleLine(line: string): Promise<RunnerResponse> {
      const message = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
      calls.push({ method: message.method, params: message.params });
      return { id: message.id, result: respond(message.method, message.params) as RunnerResponse['result'] };
    },
  };
}

const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: '2.0', id, method, params });
const callTool = (name: string, args: Record<string, unknown>, id = 1) => rpc('tools/call', { name, arguments: args }, id);

async function drive(server: ReturnType<typeof createClaudeMcpServer>, messages: unknown[]): Promise<Array<Record<string, any>>> {
  const replies: Array<Record<string, any>> = [];
  const lines = messages.map(m => JSON.stringify(m) + '\n');
  async function* input() { for (const l of lines) yield l; }
  await server.serve({ input: input(), write: l => replies.push(JSON.parse(l)) });
  return replies;
}

/** Sends each call after the previous reply, so replies come back in call order (the server runs requests concurrently). */
async function seq(server: ReturnType<typeof createClaudeMcpServer>, messages: unknown[]): Promise<Array<Record<string, any>>> {
  const replies: Array<Record<string, any>> = [];
  for (const message of messages) replies.push((await drive(server, [message]))[0]!);
  return replies;
}

test('initialize, ping and tools/list answer the MCP subset; notifications get no reply', async () => {
  const server = createClaudeMcpServer(fakeRunner());
  const replies = await drive(server, [
    rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '0' } }, 1),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc('ping', {}, 2),
    rpc('tools/list', {}, 3),
  ]);
  assert.equal(replies.length, 3);
  assert.equal(replies[0].result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(replies[0].result.capabilities, { tools: {} });
  assert.deepEqual(replies[1].result, {});
  const names = replies[2].result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names, TOOLS.map(t => t.name));
  assert.ok(!names.includes('specplane_result'));
});

test('workflow tools are refused before bind, after a wrong nonce, and on a second bind', async () => {
  const runner = fakeRunner();
  const server = createClaudeMcpServer(runner);
  const replies = await seq(server, [
    callTool('inspect', { nonce: NONCE, requestId: 'x' }, 1),
    callTool('bind', { nonce: 'short' }, 2),
    callTool('bind', { nonce: NONCE }, 3),
    callTool('inspect', { nonce: 'wrong-nonce-wrong-nonce', requestId: 'x' }, 4),
    callTool('bind', { nonce: 'another-nonce-0123456789' }, 5),
    callTool('inspect', { nonce: NONCE, requestId: 'x' }, 6),
  ]);
  assert.equal(replies[0].result.isError, true);
  assert.equal(replies[1].result.isError, true);
  assert.equal(replies[2].result.isError, false);
  assert.equal(replies[3].result.isError, true);
  assert.equal(replies[4].result.isError, true);
  assert.match(replies[4].result.content[0].text, /already bound/);
  assert.equal(replies[5].result.isError, false);
  assert.deepEqual(runner.calls.map(c => c.method), ['inspect']);
});

test('each tool forwards one runner request; the nonce is stripped and close cancels only its request', async () => {
  const runner = fakeRunner();
  const server = createClaudeMcpServer(runner);
  const replies = await seq(server, [
    callTool('bind', { nonce: NONCE }, 1),
    callTool('validate', { nonce: NONCE, requestId: 'req-0', result: { b: 2 } }, 2),
    callTool('close', { nonce: NONCE, requestId: 'req-1', extra: 'dropped' }, 3),
  ]);
  assert.equal(replies[1].result.isError, true, 'validate refuses a request this session does not hold open');
  assert.deepEqual(runner.calls, [{ method: 'cancel', params: { requestId: 'req-1' } }]);
});

test('validate sends the request the server holds, never one the caller supplies', async () => {
  const kept = { protocol: 1, requestId: 'req-9', workflow: 'plan-step', criteria: [{ id: 'c1' }] };
  const runner = fakeRunner(method => (method === 'prepare' ? { protocol: 1, ok: true, value: kept, notices: [] } : { protocol: 1, ok: true, value: { proposal: true }, notices: [] }));
  const server = createClaudeMcpServer(runner);
  const replies = await seq(server, [
    callTool('bind', { nonce: NONCE }, 1),
    callTool('prepare', { nonce: NONCE, workflow: 'plan-step' }, 2),
    callTool('validate', { nonce: NONCE, requestId: 'req-9', prepared: { forged: true }, result: { b: 2 } }, 3),
    callTool('validate', { nonce: NONCE, requestId: 'req-404', result: { b: 2 } }, 4),
  ]);
  assert.equal(replies[1].result.isError, false);
  assert.equal(replies[2].result.isError, false);
  assert.deepEqual(runner.calls.find(c => c.method === 'validate')!.params, { prepared: kept, result: { b: 2 } });
  assert.equal(replies[3].result.isError, true, 'validate refuses a request that is not open');
  assert.equal(runner.calls.filter(c => c.method === 'validate').length, 1);
});

test('a prepare reply is compact and the full request is read back in bounded detail pages', async () => {
  const big = { protocol: 1, requestId: 'req-7', workflow: 'plan-step', context: Array.from({ length: 400 }, (_, i) => ({ path: `spec-${i}.md`, text: 'x'.repeat(300) })) };
  const runner = fakeRunner(method => (method === 'prepare' ? { protocol: 1, ok: true, value: big, notices: [] } : { protocol: 1, ok: true, value: {}, notices: [] }));
  const server = createClaudeMcpServer(runner);
  const replies = await seq(server, [callTool('bind', { nonce: NONCE }, 1), callTool('prepare', { nonce: NONCE }, 2)]);
  const prepareText = replies[1].result.content[0].text as string;
  assert.ok(Buffer.byteLength(prepareText) < MAX_RESULT_BYTES);
  const compact = JSON.parse(prepareText).value;
  assert.deepEqual(Object.keys(compact).sort(), ['detailChars', 'requestId', 'status', 'workflow']);
  assert.equal(compact.requestId, 'req-7');
  let json = '';
  let offset = 0;
  for (let pages = 0; ; pages++) {
    assert.ok(pages < 1000, 'detail paging must terminate');
    const page = await seq(server, [callTool('detail', { nonce: NONCE, requestId: 'req-7', offset }, 10 + pages)]);
    assert.ok(Buffer.byteLength(page[0].result.content[0].text as string) < MAX_RESULT_BYTES);
    const value = JSON.parse(page[0].result.content[0].text).value;
    json += value.chunk;
    if (value.done) break;
    offset = value.next;
  }
  assert.equal(json.length, compact.detailChars);
  assert.deepEqual(JSON.parse(json), big);
  const bad = await seq(server, [callTool('detail', { nonce: NONCE, requestId: 'req-7', offset: json.length + 1 }, 90)]);
  assert.equal(bad[0].result.isError, true);
});

test('close without requestId cancels every open request of the session and reports each one', async () => {
  let serial = 0;
  const runner = fakeRunner(method => (method === 'prepare' ? { protocol: 1, ok: true, value: { requestId: `req-${++serial}`, workflow: 'plan-create' }, notices: [] } : { protocol: 1, ok: true, value: {}, notices: [] }));
  const server = createClaudeMcpServer(runner);
  const replies = await seq(server, [
    callTool('bind', { nonce: NONCE }, 1),
    callTool('prepare', { nonce: NONCE }, 2),
    callTool('prepare', { nonce: NONCE }, 3),
    callTool('close', { nonce: NONCE }, 4),
    callTool('close', { nonce: NONCE }, 5),
  ]);
  const first = JSON.parse(replies[3].result.content[0].text).value;
  assert.equal(first.closed.length, 2);
  assert.deepEqual(runner.calls.filter(c => c.method === 'cancel').map(c => c.params.requestId).sort(), [...first.closed].sort());
  assert.equal(replies[3].result.isError, false);
  assert.deepEqual(JSON.parse(replies[4].result.content[0].text).value.closed, [], 'a second close finds nothing open');
});

test('a prepared request whose reply cannot be delivered is cancelled by the server and reported as an error', async () => {
  const notices = [{ message: 'y'.repeat(MAX_RESULT_BYTES * 2) }];
  const runner = fakeRunner(method => (method === 'prepare' ? { protocol: 1, ok: true, value: { requestId: 'req-big', workflow: 'plan-step' }, notices } : { protocol: 1, ok: true, value: {}, notices: [] }));
  const server = createClaudeMcpServer(runner);
  const replies = await seq(server, [callTool('bind', { nonce: NONCE }, 1), callTool('prepare', { nonce: NONCE }, 2), callTool('close', { nonce: NONCE }, 3)]);
  assert.equal(replies[1].result.isError, true);
  assert.match(replies[1].result.content[0].text, /req-big.*cancelled/);
  assert.deepEqual(runner.calls.filter(c => c.method === 'cancel').map(c => c.params), [{ requestId: 'req-big' }]);
  assert.equal(JSON.parse(replies[2].result.content[0].text).value.closed.length, 0, 'nothing is left open for the mod to close');
});

test('unknown tools and methods are refused with JSON-RPC errors or tool errors', async () => {
  const server = createClaudeMcpServer(fakeRunner());
  const replies = await drive(server, [
    rpc('resources/list', {}, 1),
    callTool('bind', { nonce: NONCE }, 2),
    callTool('specplane_result', { nonce: NONCE }, 3),
  ]);
  assert.equal(replies[0].error.code, -32601);
  assert.equal(replies[2].result.isError, true);
});

// Lease held across two calls and released on close, against the real runner (fixture repository).
const passing: ExecutionPort = { execute: async () => ({ executable: process.execPath, exitCode: 0, signal: null, stdout: new TextEncoder().encode('TAP version 13\n1..1\nok 1 - runs\n'), stderr: new Uint8Array() }) };

async function preparedServer() {
  const r = repo();
  const mapping = { schemaVersion: 1, workflow: 'plan-step', criteria: [{ sourcePath: stepFile, sourceDigest: sha256(fs.readFileSync(path.join(r.cwd, stepFile))), criterionIndex: 1, evidence: 'test', testRequirements: [{ suiteId: 'workflow-suite', format: 'node-tap-v13' }] }] };
  const p = await fixture('plan-step', '# Contract\n\n## Procedure\n\n```specplane-test-requirements\n' + JSON.stringify(mapping) + '\n```\n');
  const runner = createWorkflowRunner({ checkout: r.cwd, extensionId: p.host.extensionId, compatibilityFor: () => ({ manifest: p.manifest, host: p.host }), execution: passing });
  const server = createClaudeMcpServer(runner);
  const initiation = { protocol: 1, workflow: 'plan-step', extensionId: p.host.extensionId, checkout: r.cwd, mode: 'attended', selection: { planId: id } };
  const prepared = (await seq(server, [callTool('bind', { nonce: NONCE }, 1), callTool('prepare', { nonce: NONCE, ...initiation }, 2)]))[1];
  assert.equal(prepared.result.isError, false, prepared.result.content[0].text);
  const requestId = JSON.parse(prepared.result.content[0].text).value.requestId as string;
  return { runner, server, requestId, prepareText: prepared.result.content[0].text as string };
}

test('realistic prepared request: every reply stays under the 16 KB bound and close without requestId releases the lease', async () => {
  const { runner, server, requestId, prepareText } = await preparedServer();
  assert.ok(Buffer.byteLength(prepareText) < MAX_RESULT_BYTES, `prepare reply is ${Buffer.byteLength(prepareText)} bytes`);
  const sizes = [Buffer.byteLength(prepareText)];
  const inspected = await seq(server, [callTool('inspect', { nonce: NONCE, requestId }, 3)]);
  sizes.push(Buffer.byteLength(inspected[0].result.content[0].text));
  let offset = 0;
  let json = '';
  for (let page = 0; ; page++) {
    const reply = await seq(server, [callTool('detail', { nonce: NONCE, requestId, offset }, 10 + page)]);
    sizes.push(Buffer.byteLength(reply[0].result.content[0].text));
    const value = JSON.parse(reply[0].result.content[0].text).value;
    json += value.chunk;
    if (value.done) break;
    offset = value.next;
  }
  assert.deepEqual(JSON.parse(json).requestId, requestId);
  assert.ok(sizes.every(size => size < MAX_RESULT_BYTES), `reply sizes ${sizes.join(', ')}`);
  const closed = await seq(server, [callTool('close', { nonce: NONCE }, 90)]);
  assert.equal(closed[0].result.isError, false, closed[0].result.content[0].text);
  assert.deepEqual(JSON.parse(closed[0].result.content[0].text).value.closed, [requestId]);
  assert.deepEqual(runner.tracked(), []);
});

test('a prepared request holds the lease across calls and close releases it', async () => {
  const { server, requestId } = await preparedServer();
  const second = await seq(server, [callTool('inspect', { nonce: NONCE, requestId }, 3)]);
  assert.equal(second[0].result.isError, false);
  const held = JSON.parse(second[0].result.content[0].text).value;
  assert.notEqual(held.lease, 'released', 'lease must still be held between two calls');
  const closed = await seq(server, [callTool('close', { nonce: NONCE, requestId }, 4)]);
  assert.equal(closed[0].result.isError, false, closed[0].result.content[0].text);
  assert.equal(JSON.parse(closed[0].result.content[0].text).value.lease, 'released');
});

test('disconnect (runner EOF, as the entry runs on stdin end or a killed host) releases a held lease', async () => {
  const { runner, requestId, server } = await preparedServer();
  const before = await seq(server, [callTool('inspect', { nonce: NONCE, requestId }, 3)]);
  assert.notEqual(JSON.parse(before[0].result.content[0].text).value.lease, 'released');
  const ended = (async function* () { /* no input */ })();
  assert.equal(await runner.serve({ input: ended, write: () => undefined }), 0);
  // After EOF the runner refuses new requests ("Runner is closing."), so the proof is the runner's tracked set: the request was cancelled and dropped.
  assert.deepEqual(runner.tracked(), []);
});
