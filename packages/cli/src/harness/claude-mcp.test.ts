import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo, stepFile, id } from '../core/workflow-test-fixture.js';
import { sha256 } from '../core/workflow-preparation.js';
import { createWorkflowRunner, type RunnerResponse } from '../core/workflow-runner.js';
import type { ExecutionPort } from '../core/contracts.js';
import { createClaudeMcpServer, MCP_PROTOCOL_VERSION, TOOLS, type RunnerPort } from './claude-mcp.js';

const NONCE = 'nonce-0123456789abcdef';

/** A runner stand-in that records each forwarded request and answers ok. */
function fakeRunner(): RunnerPort & { calls: Array<{ method: string; params: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    async handleLine(line: string): Promise<RunnerResponse> {
      const message = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
      calls.push({ method: message.method, params: message.params });
      return { id: message.id, result: { protocol: 1, ok: true, value: { echoed: message.method }, notices: [] } };
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
  const replies = await drive(server, [
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
  await drive(server, [
    callTool('bind', { nonce: NONCE }, 1),
    callTool('validate', { nonce: NONCE, prepared: { a: 1 }, result: { b: 2 } }, 2),
    callTool('close', { nonce: NONCE, requestId: 'req-1', extra: 'dropped' }, 3),
  ]);
  assert.deepEqual(runner.calls, [
    { method: 'validate', params: { prepared: { a: 1 }, result: { b: 2 } } },
    { method: 'cancel', params: { requestId: 'req-1' } },
  ]);
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
  const prepared = (await drive(server, [callTool('bind', { nonce: NONCE }, 1), callTool('prepare', { nonce: NONCE, ...initiation }, 2)]))[1];
  assert.equal(prepared.result.isError, false, prepared.result.content[0].text);
  const requestId = JSON.parse(prepared.result.content[0].text).value.requestId as string;
  return { runner, server, requestId };
}

test('a prepared request holds the lease across calls and close releases it', async () => {
  const { server, requestId } = await preparedServer();
  const second = await drive(server, [callTool('inspect', { nonce: NONCE, requestId }, 3)]);
  assert.equal(second[0].result.isError, false);
  const held = JSON.parse(second[0].result.content[0].text).value;
  assert.notEqual(held.lease, 'released', 'lease must still be held between two calls');
  const closed = await drive(server, [callTool('close', { nonce: NONCE, requestId }, 4)]);
  assert.equal(closed[0].result.isError, false, closed[0].result.content[0].text);
  assert.equal(JSON.parse(closed[0].result.content[0].text).value.lease, 'released');
});

test('disconnect (runner EOF, as the entry runs on stdin end or a killed host) releases a held lease', async () => {
  const { runner, requestId, server } = await preparedServer();
  const before = await drive(server, [callTool('inspect', { nonce: NONCE, requestId }, 3)]);
  assert.notEqual(JSON.parse(before[0].result.content[0].text).value.lease, 'released');
  const ended = (async function* () { /* no input */ })();
  assert.equal(await runner.serve({ input: ended, write: () => undefined }), 0);
  // After EOF the runner refuses new requests ("Runner is closing."), so the proof is the runner's tracked set: the request was cancelled and dropped.
  assert.deepEqual(runner.tracked(), []);
});
