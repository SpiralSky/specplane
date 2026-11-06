// Suites from configuration (spec: `architecture/claude-integration` § Reviewed test suites). The Claude workflow server resolves commands from the
// verification settings bound to the prepared request. Fixtures only: the runner is a stand-in, so no command is ever executed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeMcpServer, type RunnerPort } from './claude-mcp.js';
import { resolveSuite, type SuiteTable } from './claude-suites.js';

const NONCE = 'nonce-0123456789abcdef';
const TABLE: SuiteTable = { 'unit-suite': { command: ['node', '--test', 'dist/unit.test.js'], format: 'node-tap-v13' } };
const settings = (suites: SuiteTable, mode: 'auto' | 'manual' = 'auto') => ({ mode, suites });
const criterion = (suiteId: string, format = 'node-tap-v13') => ({ id: 'c:1', testRequirements: [{ suiteId, format }] });
const PREPARED = (suiteId: string, format?: string) => ({ requestId: 'req-1', workflow: 'plan-step', criteria: [criterion(suiteId, format)] });

type Call = { method: string; params: Record<string, unknown> };
function fakeRunner(prepared: unknown): RunnerPort & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async handleLine(line: string) {
      const m = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
      calls.push({ method: m.method, params: m.params });
      const value = m.method === 'prepare' ? prepared
        : m.method === 'executeTest' ? { artifact: { path: 'e1.json', digest: 'sha256:x', kind: 'test' }, executionId: 'e1', exitCode: 0, signal: null, assertions: [{ suiteId: 'unit-suite', executed: 3, failed: 0, skipped: 0, parentExecutionId: null, evidence: {} }] }
        : {};
      return { id: m.id, result: { protocol: 1, ok: true, value, notices: [] } } as never;
    },
  };
}
const call = (server: ReturnType<typeof createClaudeMcpServer>, name: string, args: Record<string, unknown>, id: number) =>
  server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) as Promise<{ result: { isError: boolean; content: [{ text: string }] } }>;

async function prepared(prep: unknown, suites?: SuiteTable, mode: 'auto' | 'manual' = 'auto') {
  const runner = fakeRunner(prep);
  const server = createClaudeMcpServer(runner, suites ? { verificationFor: () => settings(suites, mode) } : {});
  await call(server, 'bind', { nonce: NONCE }, 1);
  const p = await call(server, 'prepare', { nonce: NONCE }, 2);
  return { runner, server, prepare: p.result };
}
const executeCalls = (r: { calls: Call[] }) => r.calls.filter(c => c.method === 'executeTest');
const cancels = (r: { calls: Call[] }) => r.calls.filter(c => c.method === 'cancel');

test('own-key lookup only: __proto__, constructor and toString are unknown suites', () => {
  assert.equal(resolveSuite(TABLE, '__proto__'), undefined);
  assert.equal(resolveSuite(TABLE, 'constructor'), undefined);
  assert.equal(resolveSuite(TABLE, 'toString'), undefined);
  assert.deepEqual(resolveSuite(TABLE, 'unit-suite'), { executable: 'node', args: ['--test', 'dist/unit.test.js'], format: 'node-tap-v13' });
});

test('the suite of a mapped criterion runs the configured command and the reply carries only the receipt summary', async () => {
  const { runner, server, prepare } = await prepared(PREPARED('unit-suite'), TABLE);
  assert.equal(prepare.isError, false, prepare.content[0].text);
  const out = await call(server, 'executeTest', { nonce: NONCE, requestId: 'req-1' }, 3);
  assert.equal(out.result.isError, false, out.result.content[0].text);
  // One run serves the criterion and the step-level receipt, so the suite never runs twice.
  assert.deepEqual(executeCalls(runner).map(c => c.params), [{ requestId: 'req-1', criterionIds: ['c:1'], executable: 'node', args: ['--test', 'dist/unit.test.js'], reportFormat: 'node-tap-v13', suiteId: 'unit-suite' }]);
  const receipts = JSON.parse(out.result.content[0].text).value.receipts;
  assert.equal(receipts[0].suiteId, 'unit-suite');
  assert.deepEqual(receipts[0].suites, [{ suiteId: 'unit-suite', executed: 3, failed: 0, skipped: 0 }]);
});

test('a model-supplied command is refused before anything runs (executable, args, cwd, env, shell, reportFormat)', async () => {
  const { runner, server } = await prepared(PREPARED('unit-suite'), TABLE);
  let id = 10;
  for (const extra of [{ executable: '/bin/sh' }, { args: ['-c', 'id'] }, { cwd: '/' }, { env: { A: 'b' } }, { command: 'rm -rf /' }, { shell: true }, { reportFormat: 'junit-xml' }]) {
    const out = await call(server, 'executeTest', { nonce: NONCE, requestId: 'req-1', ...extra }, id++);
    assert.equal(out.result.isError, true);
    assert.match(out.result.content[0].text, /takes requestId and criterionIds only/);
  }
  assert.deepEqual(executeCalls(runner), [], 'no executeTest reached the runner');
  assert.deepEqual(cancels(runner), [], 'a refused call does not cancel the request');
});

test('an unknown suiteId is refused at prepare, cancels the request and runs nothing', async () => {
  const { runner, prepare } = await prepared(PREPARED('not-in-table'), TABLE);
  assert.equal(prepare.isError, true);
  assert.match(prepare.content[0].text, /not in verification\.suites \(not-in-table\)/);
  assert.deepEqual(cancels(runner).map(c => c.params), [{ requestId: 'req-1' }]);
  assert.deepEqual(executeCalls(runner), []);
});

test('a suite whose table format differs from the required format is refused and cancels the request', async () => {
  const { runner, server, prepare } = await prepared(PREPARED('unit-suite', 'junit-xml'), TABLE);
  assert.equal(prepare.isError, false);
  const out = await call(server, 'executeTest', { nonce: NONCE, requestId: 'req-1' }, 3);
  assert.equal(out.result.isError, true);
  assert.match(out.result.content[0].text, /reports node-tap-v13, but the request requires junit-xml/);
  assert.deepEqual(cancels(runner).map(c => c.params), [{ requestId: 'req-1' }]);
  assert.deepEqual(executeCalls(runner), []);
});

test('without bound verification settings a mapped plan-step is cancelled and executeTest is unavailable', async () => {
  const { runner, prepare } = await prepared(PREPARED('unit-suite'));
  assert.equal(prepare.isError, true);
  assert.deepEqual(cancels(runner).map(c => c.params), [{ requestId: 'req-1' }]);
  const bare = createClaudeMcpServer(fakeRunner(PREPARED('unit-suite')));
  await call(bare, 'bind', { nonce: NONCE }, 1);
  const out = await call(bare, 'executeTest', { nonce: NONCE, requestId: 'req-1', executable: '/bin/sh', args: ['-c', 'id'] }, 2);
  assert.equal(out.result.isError, true);
});

test('a step-level run covers every configured suite when the step has no mapping, and only in auto mode', async () => {
  const two: SuiteTable = { ...TABLE, 'a-suite': { command: ['/usr/bin/true'], format: 'junit-xml' } };
  const none = { requestId: 'req-1', workflow: 'plan-step', criteria: [{ id: 'c:1', testRequirements: [] }] };
  const auto = await prepared(none, two);
  const out = await call(auto.server, 'executeTest', { nonce: NONCE, requestId: 'req-1' }, 3);
  assert.equal(out.result.isError, false, out.result.content[0].text);
  assert.deepEqual(executeCalls(auto.runner).map(c => [c.params.suiteId, c.params.executable, c.params.criterionIds]), [['a-suite', '/usr/bin/true', []], ['unit-suite', 'node', []]]);
  assert.deepEqual(JSON.parse(out.result.content[0].text).value.receipts.map((r: { suiteId: string; stepLevel: boolean }) => [r.suiteId, r.stepLevel]), [['a-suite', true], ['unit-suite', true]]);
  const manual = await prepared(none, two, 'manual');
  const refused = await call(manual.server, 'executeTest', { nonce: NONCE, requestId: 'req-1' }, 3);
  assert.equal(refused.result.isError, true);
  assert.deepEqual(executeCalls(manual.runner), []);
});

test('executeTest for a request that is not open is refused', async () => {
  const { runner, server } = await prepared(PREPARED('unit-suite'), TABLE);
  const out = await call(server, 'executeTest', { nonce: NONCE, requestId: 'req-other' }, 3);
  assert.equal(out.result.isError, true);
  assert.deepEqual(executeCalls(runner), []);
});

test('criterionIds narrows the run to named criteria; unknown, empty, duplicate or non-test ids are refused without cancelling', async () => {
  const prep = { requestId: 'req-1', workflow: 'plan-step', criteria: [criterion('unit-suite'), { id: 'c:2', testRequirements: [] }] };
  const { runner, server } = await prepared(prep, TABLE);
  let id = 20;
  for (const bad of [[], ['c:9'], ['c:2'], ['c:1', 'c:1'], 'c:1', [1]]) {
    const out = await call(server, 'executeTest', { nonce: NONCE, requestId: 'req-1', criterionIds: bad }, id++);
    assert.equal(out.result.isError, true);
    assert.match(out.result.content[0].text, /criterionIds must be a nonempty list/);
  }
  assert.deepEqual(executeCalls(runner), []);
  assert.deepEqual(cancels(runner), []);
  const ok = await call(server, 'executeTest', { nonce: NONCE, requestId: 'req-1', criterionIds: ['c:1'] }, id++);
  assert.equal(ok.result.isError, false, ok.result.content[0].text);
  assert.deepEqual(executeCalls(runner).map(c => c.params.criterionIds), [['c:1']]);
});
