/**
 * Deterministic coverage for the Claude native handlers (claude-delivery 02). The handler logic is
 * host-independent TypeScript in harnesses/claude/plugin/hooks/commands.ts; Bun loads it from source.
 * Host interaction (registration, dialogs, origins) is covered by `claude plugin test`
 * (harnesses/claude/plugin/handlers.test.ts). No live Claude host is involved here.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { coreInfo } from '../core/index.js';
import { workflowResultSchema } from '../core/schemas.js';
import { lazyValidator } from '../lazy-validator.js';
import { CLAUDE_WORKFLOWS } from './conformance-matrix.js';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(dist, '..', '..', '..');
const cliJs = path.join(dist, 'cli.js');
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const opts = { skip: hasBun ? false : 'loads TypeScript source; run with Bun' };

type Port = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/commands.ts')).href);

function context(overrides: Port = {}) {
  const calls: string[][] = [];
  const queue: any[] = [];
  let asked = 0;
  const ctx: any = {
    origin: { kind: 'composer' }, signal: new AbortController().signal, queue,
    core: { cli: async (argv: string[]) => { calls.push(argv); return { exitCode: 0, stdout: 'ok', stderr: '' }; } },
    human: { confirm: async () => { asked++; return 'confirmed'; } },
    ...overrides,
  };
  return { ctx, calls, queue, asked: () => asked };
}

test('every Claude workflow has a native command and none has a public skill', opts, async () => {
  const m = await load();
  for (const workflow of CLAUDE_WORKFLOWS) {
    const cmd = m.NATIVE_COMMANDS.find((c: { workflow: string }) => c.workflow === workflow);
    assert.ok(cmd, `${workflow} has no native command`);
    assert.ok(!fs.existsSync(path.join(repo, 'harnesses/claude/templates/skills', workflow, 'SKILL.md')), `${workflow}: a public skill must not exist (D10, D19)`);
    const asset = path.join(repo, 'harnesses/claude/templates', m.reasoningAsset(workflow).replace(/^\.claude\//, ''));
    assert.equal(fs.existsSync(asset), cmd.kind === 'reasoning', `${workflow}: reasoning asset ${cmd.kind === 'reasoning' ? 'missing' : 'must not exist for a mechanical workflow'}`);
  }
  const names = m.NATIVE_COMMANDS.map((c: { name: string }) => c.name);
  assert.equal(new Set(names).size, names.length);
});

test('mechanical handlers have no model port and refuse state changes from any origin but a direct user gesture', opts, async () => {
  const m = await load();
  for (const cmd of m.NATIVE_COMMANDS.filter((c: { kind: string; readOnly: boolean }) => c.kind !== 'reasoning' && !c.readOnly)) {
    const { ctx, calls, asked } = context({ origin: { kind: 'plugin' } });
    const out = await m.runCommand(cmd, 'feature/x', ctx);
    assert.equal(out.exitCode, 2, cmd.name);
    assert.equal(calls.length, 0, `${cmd.name} ran the core for a non-user origin`);
    assert.equal(asked(), 0);
  }
  const { ctx, calls } = context({ origin: { kind: 'tool' } });
  const status = await m.runCommand(m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === 'plan-status'), '', ctx);
  assert.equal(status.text, 'ok');
  assert.deepEqual(calls, [['plan', 'list', '--live']]);
});

test('human gates are never answered by arguments or model output', opts, async () => {
  const m = await load();
  const approve = m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === 'approve');
  const declined = context({ human: { confirm: async () => 'declined' } });
  assert.match((await m.runCommand(approve, 'feature/x yes confirm', declined.ctx)).text, /Cancelled/);
  assert.equal(declined.calls.length, 0);
  const unavailable = context({ human: { confirm: async () => 'unavailable' } });
  const refused = await m.runCommand(approve, 'feature/x', unavailable.ctx);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.text, /specplane spec approve feature\/x/);
  assert.equal(unavailable.calls.length, 0);
  const flags = context();
  for (const arg of ['feature/x --yes', 'feature/x --confirm', '--approved feature/x']) assert.equal((await m.runCommand(approve, arg, flags.ctx)).exitCode, 2, arg);
  assert.equal(flags.calls.length, 0);
  const abandon = m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === 'plan-abandon');
  assert.equal((await m.runCommand(abandon, '2026-11-01-p --force', flags.ctx)).exitCode, 2);
});

test('approve groups IDs by kind, stops at the first refusal and reopen is spec-only', opts, async () => {
  const m = await load();
  const approve = m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === 'approve');
  const a = context();
  await m.runCommand(approve, 'feature/a claude:architecture/b 2026-11-01-p decision/0003', a.ctx);
  assert.deepEqual(a.calls, [['spec', 'approve', 'feature/a', 'claude:architecture/b'], ['plan', 'approve', '2026-11-01-p'], ['decision', 'accept', 'decision/0003']]);
  const stop = context({ core: { cli: async (argv: string[]) => { stop.calls.push(argv); return { exitCode: 1, stdout: '', stderr: 'refused: not in review' }; } } });
  const out = await m.runCommand(approve, 'feature/a 2026-11-01-p', stop.ctx);
  assert.equal(out.exitCode, 1);
  assert.equal(stop.calls.length, 1);
  const r = context();
  await m.runCommand(approve, 'feature/a --reopen', r.ctx);
  assert.deepEqual(r.calls, [['spec', 'reopen', 'feature/a']]);
  assert.equal((await m.runCommand(approve, '2026-11-01-p --reopen', r.ctx)).exitCode, 2);
});

test('docs handler returns the real core topic bytes unchanged with core and docs versions in a separate header', opts, async () => {
  const m = await load();
  const real = (...args: string[]) => spawnSync(process.execPath, [cliJs, ...args], { encoding: 'utf8', cwd: repo });
  const cli = async (argv: string[]) => { const r = real(...argv); return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }; };
  const docs = m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === 'specplane-docs');
  const { ctx } = context({ core: { cli }, origin: { kind: 'tool' } });
  const out = await m.runCommand(docs, 'concepts', ctx);
  const plain = real('docs', 'concepts').stdout;
  assert.equal(out.text, `Specplane core ${coreInfo.version} · docs ${coreInfo.docsVersion}\n\n${plain.trimEnd()}`);
  const search = await m.runCommand(docs, 'search plan', ctx);
  assert.match(search.text, /^Specplane core .* · docs /);
  assert.equal((await m.runCommand(docs, '--json', ctx)).exitCode, 2);
});

test('the registration plan keeps built-in and foreign names, reports them, and leaves reasoning off without a bound core', opts, async () => {
  const m = await load();
  const plan = m.planRegistration([{ name: 'approve', source: 'builtin' }, { name: 'validate', source: 'user' }], false);
  assert.deepEqual(plan.collisions.map((c: { name: string }) => c.name), ['validate', 'approve']);
  assert.ok(plan.collisions.every((c: { manual: string }) => c.manual.includes('specplane')));
  assert.ok(!plan.register.some((c: { name: string }) => ['approve', 'validate'].includes(c.name)));
  assert.equal(plan.unavailable.length, 6);
  assert.equal(m.planRegistration([], true).unavailable.length, 0);
});

test('the model cannot call the Specplane workflow server; other tools pass the tool.check gate', opts, async () => {
  const handlers = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__plugin_specplane_specplane__prepare' }), true);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__specplane__record' }), true);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__github__issue' }), false);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'Bash' }), false);
  assert.equal(handlers.isSpecplaneServerTool({}), false);
});

// Reasoning path (claude-delivery 03). A fake Specplane server stands for `$.mcp`; each call is recorded with its arguments.
type Reply = { ok: boolean; value?: unknown; message: string; code?: string; details?: unknown };
type Script = Record<string, (args: Record<string, unknown>) => Reply>;
function fakeServer(script: Script = {}, connection: Record<string, unknown> = { connected: true }) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  let connects = 0;
  const server = {
    connect: async () => { connects++; return connection; },
    call: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      const step = script[tool];
      return step ? step(args) : { ok: true, value: {}, message: '' };
    },
  };
  return { server, calls, connects: () => connects };
}
const NONCE = 'a'.repeat(32);
const PREPARED = { requestId: 'r1', criteria: [{ id: 'c1' }] };
/** Serves the prepared request the way the MCP server does: bounded `detail` pages of its JSON (16 characters here, so paging runs). */
const detailScript = (value: unknown): Script => ({
  detail: (args) => {
    const json = JSON.stringify(value);
    const offset = args.offset as number;
    const chunk = json.slice(offset, offset + 16);
    const next = offset + chunk.length;
    return { ok: true, value: { requestId: args.requestId, offset, total: json.length, chunk, next: next < json.length ? next : null, done: next >= json.length }, message: '' };
  },
});
const PREPARE_OK: Script = { prepare: () => ({ ok: true, value: { requestId: 'r1' }, message: '' }), ...detailScript(PREPARED) };
const PROPOSAL = { protocol: 1, requestId: 'r1', resultDigest: 'd' };
const RESULT = { protocol: 1, requestId: 'r1', outcome: 'done' };
const session = (server: unknown, binding = { bound: false }) => ({ checkout: '/repo', nonce: NONCE, server, binding });
const REASONING_ARGS: Record<string, string> = {
  'plan-step': '2026-11-01-plan',
  'plan-finish': '2026-11-01-plan',
  'spec-assist': 'draft a spec for search',
  'spec-draft-architecture': 'repo:feature/a repo:feature/b',
  'plan-create': 'ship search',
  'decision-new': 'pick a store',
};
const byName = (m: any, name: string) => m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === name);

test('the mod constant for the extension id equals the package identity the installer writes', opts, async () => {
  const m = await load();
  const pkg = await import('./claude-package.js');
  assert.equal(m.CLAUDE_EXTENSION_ID, pkg.CLAUDE_EXTENSION_ID);
});

test('each reasoning command connects, binds once per session, and prepares with the nonce and a closed initiation', opts, async () => {
  const m = await load();
  const fake = fakeServer(PREPARE_OK);
  const binding = { bound: false };
  for (const [name, args] of Object.entries(REASONING_ARGS)) {
    const { ctx, queue } = context({ session: session(fake.server, binding) });
    const out = await m.runCommand(byName(m, name), args, ctx);
    assert.equal(out.exitCode, undefined, name);
    assert.equal(queue.length, 1, name);
    assert.equal(queue[0].assetPath, `.claude/skills/specplane-reason-${name}/SKILL.md`, name);
  }
  assert.equal(fake.connects(), 6);
  assert.deepEqual(fake.calls.filter(c => c.tool !== 'detail').map(c => c.tool), ['bind', 'prepare', 'prepare', 'prepare', 'prepare', 'prepare', 'prepare']);
  assert.ok(fake.calls.every(c => c.args.nonce === NONCE));
  const planStep = fake.calls.find(c => c.args.workflow === 'plan-step')!.args;
  assert.deepEqual(planStep, { protocol: 1, extensionId: 'specplane-claude', checkout: '/repo', mode: 'attended', workflow: 'plan-step', selection: { planId: '2026-11-01-plan' }, nonce: NONCE });
  const spec = fake.calls.find(c => c.args.workflow === 'spec-draft-architecture')!.args;
  assert.deepEqual((spec.selection as { specIds: string[] }).specIds, ['repo:feature/a', 'repo:feature/b']);
});

test('malformed arguments are refused before the server is touched', opts, async () => {
  const m = await load();
  const fake = fakeServer(PREPARE_OK);
  for (const [name, args] of [['plan-step', ''], ['plan-step', 'a b'], ['spec-draft-architecture', 'notaspec'], ['plan-create', ''], ['decision-new', '  ']]) {
    const { ctx } = context({ session: session(fake.server) });
    assert.equal((await m.runCommand(byName(m, name), args, ctx)).exitCode, 2, `${name} ${args}`);
  }
  assert.equal(fake.connects(), 0);
  assert.equal(fake.calls.length, 0);
});

test('a server that does not connect, or a refused bind, prepares nothing and says so', opts, async () => {
  const m = await load();
  const disabled = fakeServer(PREPARE_OK, { connected: false, message: 'Specplane server is disabled.' });
  const a = context({ session: session(disabled.server) });
  const outA = await m.runCommand(byName(m, 'plan-create'), 'ship search', a.ctx);
  assert.equal(outA.exitCode, 1);
  assert.match(outA.text, /disabled\. Nothing was delegated\./);
  assert.equal(disabled.calls.length, 0);
  assert.equal(a.queue.length, 0);

  const noBind = fakeServer({ ...PREPARE_OK, bind: () => ({ ok: false, message: 'already bound' }) });
  const b = context({ session: session(noBind.server) });
  assert.equal((await m.runCommand(byName(m, 'plan-create'), 'ship search', b.ctx)).exitCode, 1);
  assert.deepEqual(noBind.calls.map(c => c.tool), ['bind']);
  assert.equal(b.queue.length, 0);
});

test('a refused prepare is reported and sends no close; a prepare call that throws may hold a lease, so every request is closed', opts, async () => {
  const m = await load();
  const refused = fakeServer({ prepare: () => ({ ok: false, message: 'dirty checkout.' }) });
  const a = context({ session: session(refused.server, { bound: true }) });
  const outA = await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', a.ctx);
  assert.match(outA.text, /dirty checkout\. Nothing was delegated\./);
  assert.deepEqual(refused.calls.map(c => c.tool), ['prepare']);
  const thrown = fakeServer({ prepare: () => { throw new Error('boom'); } });
  const b = context({ session: session(thrown.server, { bound: true }) });
  const outB = await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', b.ctx);
  assert.equal(outB.exitCode, 1);
  assert.match(outB.text, /boom/);
  assert.equal(b.queue.length, 0);
  assert.deepEqual(thrown.calls.at(-1), { tool: 'close', args: { nonce: NONCE } });
});

test('cancellation after prepare closes the request and delegates nothing', opts, async () => {
  const m = await load();
  const controller = new AbortController();
  const fake = fakeServer({ prepare: () => { controller.abort(); return { ok: true, value: PREPARED, message: '' }; } });
  const { ctx, queue } = context({ session: session(fake.server, { bound: true }), signal: controller.signal });
  assert.equal((await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx)).exitCode, 130);
  assert.equal(queue.length, 0);
  assert.deepEqual(fake.calls.at(-1), { tool: 'close', args: { requestId: 'r1', nonce: NONCE } });
});

test('a matching result is validated, recorded, and its lease closed last', opts, async () => {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, validate: () => ({ ok: true, value: PROPOSAL, message: '' }), record: () => ({ ok: true, value: {}, message: '' }) });
  const { ctx, queue } = context({ session: session(fake.server) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const pending = new Map([[queue[0].requestId, queue[0]]]);
  const out = await m.acceptResult(pending, { requestId: 'r1', result: RESULT }, { session: ctx.session });
  assert.equal(out.ok, true);
  assert.deepEqual(fake.calls.slice(-3).map(c => c.tool), ['validate', 'record', 'close']);
  assert.deepEqual(fake.calls.find(c => c.tool === 'validate')!.args, { requestId: 'r1', result: RESULT, nonce: NONCE });
  assert.deepEqual(fake.calls.find(c => c.tool === 'record')!.args, { ...PROPOSAL, nonce: NONCE });
  assert.deepEqual(fake.calls.at(-1)!.args, { requestId: 'r1', nonce: NONCE });
  const calls = fake.calls.length;
  assert.equal((await m.acceptResult(pending, { requestId: 'r1', result: RESULT }, { session: ctx.session })).ok, false);
  assert.equal(fake.calls.length, calls, 'a settled request is refused without a server call');
});

test('close runs whether validation refuses, throws, or recording refuses', opts, async () => {
  const m = await load();
  const cases: Script[] = [
    { validate: () => ({ ok: false, message: 'Invalid evidence.', value: undefined }) },
    { validate: () => { throw new Error('crash'); } },
    { validate: () => ({ ok: true, value: PROPOSAL, message: '' }), record: () => ({ ok: false, message: 'Confirmation required.', value: undefined }) },
  ];
  for (const script of cases) {
    const fake = fakeServer({ ...PREPARE_OK, ...script });
    const { ctx, queue } = context({ session: session(fake.server) });
    await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
    const out = await m.acceptResult(new Map([['r1', queue[0]]]), { requestId: 'r1', result: RESULT }, { session: ctx.session });
    assert.equal(out.ok, false);
    assert.equal(fake.calls.at(-1)!.tool, 'close');
  }
});

test('a correctable refusal keeps the request open for a corrected result (D23)', opts, async () => {
  const m = await load();
  let refusals = 1;
  const fake = fakeServer({
    ...PREPARE_OK,
    validate: () => (refusals-- > 0 ? { ok: false, code: 'INVALID_EVIDENCE', message: 'Blocked result needs a concrete BLOCKED: open issue', value: undefined } : { ok: true, value: PROPOSAL, message: '' }),
    record: () => ({ ok: true, value: {}, message: '' }),
  });
  const { ctx, queue } = context({ session: session(fake.server) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const pending = new Map([['r1', queue[0]]]);
  const first = await m.acceptResult(pending, { requestId: 'r1', result: RESULT }, { session: ctx.session });
  assert.equal(first.ok, false);
  assert.match(first.text, /open issue\. Nothing was recorded\. The request is still open.*2 attempts left/);
  assert.equal(fake.calls.some(c => c.tool === 'close'), false);
  assert.equal(pending.has('r1'), true);
  const second = await m.acceptResult(pending, { requestId: 'r1', result: RESULT }, { session: ctx.session });
  assert.equal(second.ok, true);
  assert.deepEqual(fake.calls.slice(-3).map(c => c.tool), ['validate', 'record', 'close']);
  assert.equal(pending.has('r1'), false);
});

test('correctable refusals end the request at the attempt limit (D23)', opts, async () => {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, validate: () => ({ ok: false, code: 'INVALID_EVIDENCE', message: 'Invalid evidence.', value: undefined }) });
  const { ctx, queue } = context({ session: session(fake.server) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const pending = new Map([['r1', queue[0]]]);
  const texts: string[] = [];
  for (let i = 0; i < m.MAX_RESULT_ATTEMPTS; i++) texts.push((await m.acceptResult(pending, { requestId: 'r1', result: RESULT }, { session: ctx.session })).text);
  assert.match(texts[1], /1 attempt left/);
  assert.match(texts.at(-1)!, /This request has ended/);
  assert.equal(fake.calls.filter(c => c.tool === 'validate').length, m.MAX_RESULT_ATTEMPTS);
  assert.deepEqual(fake.calls.at(-1)!.args, { requestId: 'r1', nonce: NONCE });
  assert.equal(fake.calls.at(-1)!.tool, 'close');
  assert.equal(pending.size, 0);
});

test('a refusal a corrected result cannot fix closes the request (D23)', opts, async () => {
  const m = await load();
  const script: Script[] = [
    { validate: () => ({ ok: false, code: 'STALE_STATE', message: 'Session is stale.', value: undefined }) },
    { validate: () => ({ ok: false, lost: true, message: 'Specplane server call validate failed.', value: undefined }) },
  ];
  for (const step of script) {
    const fake = fakeServer({ ...PREPARE_OK, ...step });
    const { ctx, queue } = context({ session: session(fake.server) });
    await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
    const pending = new Map([['r1', queue[0]]]);
    const out = await m.acceptResult(pending, { requestId: 'r1', result: RESULT }, { session: ctx.session });
    assert.match(out.text, /This request has ended/);
    assert.equal(fake.calls.at(-1)!.tool, 'close');
    assert.equal(pending.size, 0);
  }
});

test('a prepared request is read back in detail pages and its whole request is queued', opts, async () => {
  const m = await load();
  const fake = fakeServer(PREPARE_OK);
  const { ctx, queue } = context({ session: session(fake.server) });
  assert.equal((await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx)).exitCode, undefined);
  assert.deepEqual(queue[0].request, PREPARED);
  assert.ok(fake.calls.filter(c => c.tool === 'detail').length > 1, 'the request spans several pages');
  assert.equal(fake.calls.some(c => c.tool === 'close'), false);
});

test('a prepare reply that cannot be read closes every request of the binding, since its lease may be held', opts, async () => {
  const m = await load();
  const fake = fakeServer({ prepare: () => ({ ok: true, value: 'Result too large; read the file in chunks.', message: 'Result too large; read the file in chunks.' }) });
  const { ctx, queue } = context({ session: session(fake.server, { bound: true }) });
  const out = await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  assert.match(out.text, /Nothing was delegated/);
  assert.equal(queue.length, 0);
  assert.deepEqual(fake.calls.at(-1), { tool: 'close', args: { nonce: NONCE } });
});

test('a request whose details cannot be read is closed by its id and delegates nothing', opts, async () => {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, detail: () => ({ ok: false, message: 'Specplane server call detail failed: boom' }) });
  const { ctx, queue } = context({ session: session(fake.server, { bound: true }) });
  const out = await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  assert.equal(out.exitCode, 1);
  assert.equal(queue.length, 0);
  assert.deepEqual(fake.calls.at(-1), { tool: 'close', args: { requestId: 'r1', nonce: NONCE } });
});

test('a completion result whose request id cannot be read closes the open requests and clears them', opts, async () => {
  const m = await load();
  const fake = fakeServer(PREPARE_OK);
  const { ctx, queue } = context({ session: session(fake.server, { bound: true }) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const pending = new Map([[queue[0].requestId, queue[0]]]);
  const out = await m.acceptResult(pending, { result: RESULT }, { session: ctx.session });
  assert.equal(out.ok, false);
  assert.equal(pending.size, 0);
  assert.deepEqual(fake.calls.at(-1), { tool: 'close', args: { nonce: NONCE } });
});

test('a result with no readable id does not claim the requests were closed when close fails', opts, async () => {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, close: () => ({ ok: false, message: 'close refused' }) });
  const { ctx, queue } = context({ session: session(fake.server, { bound: true }) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const pending = new Map([[queue[0].requestId, queue[0]]]);
  const out = await m.acceptResult(pending, { result: RESULT }, { session: ctx.session });
  assert.equal(out.ok, false);
  assert.doesNotMatch(out.text, /were closed/);
  assert.match(out.text, /closing the open Specplane requests failed/);
  assert.equal(pending.size, 0);
});

test('a result for an unknown request is refused and closes nothing', opts, async () => {
  const m = await load();
  const fake = fakeServer(PREPARE_OK);
  const out = await m.acceptResult(new Map(), { requestId: 'nope', result: RESULT }, { session: session(fake.server) });
  assert.equal(out.ok, false);
  assert.equal(fake.calls.length, 0);
});

test('the delegation prompt inlines the prepared request, names the completion tool, and is not an approval', opts, async () => {
  const m = await load();
  const prompt = m.delegationPrompt({ workflow: 'plan-step', requestId: 'r1', assetPath: '.claude/skills/specplane-reason-plan-step/SKILL.md', request: { criteria: [] } });
  assert.match(prompt, /specplane-reason-plan-step\/SKILL\.md/);
  assert.match(prompt, /"criteria":\[\]/);
  assert.match(prompt, /specplane_result/);
  assert.match(prompt, /not an approval/);
});

test('the prompt carries a schema-valid result for the request, so the model need not guess its shape (D24)', opts, async () => {
  const m = await load();
  const digest = 'a'.repeat(64);
  const delegation = { workflow: 'spec-assist', requestId: 'r1', assetPath: 'SKILL.md', request: { base: { digest }, criteria: [{ id: 'c1' }, { id: 'c2' }] } };
  const template = m.resultTemplate(delegation);
  assert.equal(lazyValidator(workflowResultSchema)(template), true);
  assert.deepEqual(template.criterionEvidence.map((e: { criterionId: string }) => e.criterionId), ['c1', 'c2']);
  assert.equal(template.baseDigest, digest);
  const prompt = m.delegationPrompt(delegation);
  assert.ok(prompt.includes(JSON.stringify(template)));
  assert.match(prompt, /even when you cannot finish/);
});

test('only workflows that would write a body are told to report blocked instead (D24, D17 B)', opts, async () => {
  const m = await load();
  const prompt = (workflow: string) => m.delegationPrompt({ workflow, requestId: 'r1', assetPath: 'SKILL.md', request: {} });
  for (const workflow of ['spec-assist', 'spec-draft-architecture', 'plan-create', 'decision-new']) assert.match(prompt(workflow), /leave out `creation` and `finalizedEdits`/);
  for (const workflow of ['plan-step', 'plan-finish']) assert.doesNotMatch(prompt(workflow), /finalizedEdits/);
});

test('every reasoning procedure reads the request from the prompt and always reports (D24)', opts, async () => {
  const dir = path.join(repo, 'harnesses/claude/templates/skills');
  const procedures = fs.readdirSync(dir).filter(name => name.startsWith('specplane-reason-'));
  assert.equal(procedures.length, 6);
  for (const name of procedures) {
    const text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(text, /request file describes|Read that file/, name);
    assert.match(text, /no request file on disk/, name);
    assert.match(text, /LeaseRefused/, name);
    assert.match(text, /Call it even when you cannot finish/, name);
  }
});

test('server replies are read from the core Result, or from plain text for bind and refusals', opts, async () => {
  const m = await load();
  const okReply = m.serverReply({ content: [{ type: 'text', text: '{"protocol":1,"ok":true,"value":{"requestId":"r1"},"notices":[]}' }], isError: false });
  assert.equal(okReply.ok, true);
  assert.deepEqual(okReply.value, { requestId: 'r1' });
  assert.equal(m.serverReply({ content: [{ type: 'text', text: '{"protocol":1,"ok":false,"error":{"code":"INVALID_EVIDENCE","message":"Bad."}}' }], isError: true }).code, 'INVALID_EVIDENCE');
  const stale = m.serverReply({ content: [{ type: 'text', text: '{"protocol":1,"ok":false,"error":{"code":"STALE_STATE","message":"Session is stale."}}' }], isError: true });
  assert.equal(stale.ok, false);
  assert.equal(stale.message, 'Session is stale.');
  const nonce = m.serverReply({ content: [{ type: 'text', text: 'Nonce does not match the bound session.' }], isError: true });
  assert.equal(nonce.ok, false);
  assert.equal(nonce.message, 'Nonce does not match the bound session.');
  const bound = m.serverReply({ content: [{ type: 'text', text: '{"bound":true}' }], isError: false });
  assert.equal(bound.ok, true);
});

test('the tool.check nonce gate admits a server call only with the bound nonce; the completion tool and other tools are not server calls', opts, async () => {
  const h = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  const server = 'mcp__plugin_specplane_specplane__prepare';
  assert.equal(h.refusesServerCall({ tool: server, input: { nonce: NONCE } }, NONCE), false);
  assert.equal(h.refusesServerCall({ tool: server, input: {} }, NONCE), true);
  assert.equal(h.refusesServerCall({ tool: server, input: { nonce: 'b'.repeat(32) } }, NONCE), true);
  assert.equal(h.refusesServerCall({ tool: server, input: { nonce: NONCE } }, undefined), true);
  assert.equal(h.refusesServerCall({ tool: server }, NONCE), true);
  assert.equal(h.refusesServerCall({ tool: h.COMPLETION_TOOL_NAME, input: { requestId: 'r1' } }, NONCE), false);
  assert.equal(h.refusesServerCall({ tool: 'Bash', input: { command: 'ls' } }, NONCE), false);
});

test('the completion hook reads arguments from the tool.call event, and a fresh server handle dials before calling', opts, async () => {
  const h = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  // As the host delivers it: arguments beside `tool`, no `input` key.
  assert.deepEqual(h.resultArguments({ tool: h.COMPLETION_TOOL_NAME, tool_use_id: 't', requestId: 'r1', result: { a: 1 } }), { requestId: 'r1', result: { a: 1 } });

  const dialed: string[] = [], called: unknown[][] = [];
  const mcp = {
    connect: async (key: string) => { dialed.push(key); return { isConnected: true, server: 'plugin:specplane:specplane' }; },
    call: async (...args: unknown[]) => { called.push(args); return { content: [{ type: 'text', text: '{"ok":true,"value":{}}' }] }; },
  };
  const server = h.pluginServer({ mcp }); // the completion path: no connect() first
  await server.call('close', { requestId: 'r1' });
  await server.call('close', { requestId: 'r2' });
  assert.deepEqual(dialed, ['specplane']); // dialed once, then reused
  assert.deepEqual(called[0], ['plugin:specplane:specplane', 'close', { requestId: 'r1' }]);

  const down = h.pluginServer({ mcp: { connect: async () => ({ isConnected: false, message: 'no server' }) } });
  const reply = await down.call('close', {});
  assert.equal(reply.ok, false);
  assert.equal(reply.message, 'no server');
});

test('a queued delegation is submitted from a timer after the hook, once, and a failed timer leaves it queued', opts, async () => {
  const h = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  const submitted: string[] = [];
  const timers: (() => void)[] = [];
  const $ = {
    clock: { after: (_ms: number, fn: () => void) => { timers.push(fn); } },
    prompt: { submit: async ({ text }: { text: string }) => { submitted.push(text); return { text }; } },
    ui: { log: () => undefined },
  };
  const d = { workflow: 'spec-assist', requestId: 'r1', assetPath: 'a', request: { requestId: 'r1' } };
  const from = [d], into = new Map();
  h.scheduleDelegations($, from, into);
  assert.equal(submitted.length, 0); // nothing inside the hook: the host refuses a submit there
  assert.equal(timers.length, 1);
  timers[0]!();
  assert.equal(submitted.length, 1);
  assert.equal(from.length, 0);
  assert.equal(into.get('r1'), d);
  h.drainDelegations($, from, into); // the turn.complete backstop finds nothing left
  assert.equal(submitted.length, 1);
  h.scheduleDelegations($, from, into);
  assert.equal(timers.length, 1); // an empty queue sets no timer

  const kept = [d];
  h.scheduleDelegations({ ...$, clock: { after: () => { throw new Error('refused'); } } }, kept, new Map());
  assert.equal(kept.length, 1); // still queued for turn.complete
});

test('the registered gate allows only the mod\'s own server call, denies the rest, and a throwing gate denies too', opts, async () => {
  const h = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  const hooks: Record<string, { handler: any; catcher?: any }> = {};
  const on = (event: string, filter: unknown, fn?: unknown) => {
    const handler = typeof filter === 'function' ? filter : fn;
    const rec: { handler: any; catcher?: any } = { handler };
    if (event === 'tool.check') hooks[event] = rec;
    return { catch: (c: any) => { rec.catcher = c; } };
  };
  await h.startNative({ command: { list: async () => { throw new Error('no inventory'); } }, ui: { log: () => undefined } }, '/repo');
  h.registerNative(on as any);
  const gate = hooks['tool.check']!;
  const decider = (origin: unknown) => Object.assign(() => ({ decision: 'ask' }), { signal: new AbortController().signal, origin });
  const next = decider({ plugin: 'specplane', tier: 'user' });
  const model = decider({ plugin: 'engine', tier: 'core' });
  const other = decider({ plugin: 'other', tier: 'user' });
  const server = { tool: 'mcp__plugin_specplane_specplane__prepare', input: {} };
  const bound = { tool: 'mcp__plugin_specplane_specplane__prepare', input: { nonce: h.currentNonce() } };
  assert.equal(gate.handler({}, server, next).decision, 'deny');
  assert.equal(gate.handler({}, bound, next).decision, 'allow'); // answered here, never put to the mode's decider
  assert.equal(gate.handler({}, bound, model).decision, 'deny'); // a model holding the nonce is still refused
  assert.equal(gate.handler({}, bound, other).decision, 'deny');
  assert.equal(gate.handler({}, bound, decider(undefined)).decision, 'deny');
  assert.equal(gate.handler({}, { tool: 'Bash', input: {} }, model).decision, 'ask');
  assert.equal(gate.handler({}, { tool: h.COMPLETION_TOOL_NAME, input: {} }, model).decision, 'ask');
  assert.equal(gate.catcher({}, server, next).decision, 'deny');
  assert.equal(gate.catcher({}, { tool: 'Bash', input: {} }, next).decision, 'ask');
});

// D17 A, live check pending (spec: Confirming finalised content): the mod's two-call confirmation flow, fixtures only.
const CHALLENGE = { challengeId: 'c1', summary: 'Confirm these exact finalized spec edits.\nFile: a', targets: ['a'], expiresAt: '2099-01-01T00:00:00.000Z' };
const parkedRecord = (args: Record<string, unknown>) =>
  args.confirmation === undefined
    ? ({ ok: false, code: 'CONFIRMATION_REQUIRED', details: { challenge: CHALLENGE }, message: 'Finalized content needs confirmation.', value: undefined })
    : ({ ok: true, value: {}, message: '' });

async function confirmationCase(human: Port['human'], record: Script['record'] = parkedRecord) {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, validate: () => ({ ok: true, value: PROPOSAL, message: '' }), record });
  const { ctx, queue } = context({ session: session(fake.server) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const out = await m.acceptResult(new Map([['r1', queue[0]]]), { requestId: 'r1', result: RESULT }, { session: ctx.session, human, newInteractionId: () => 'dialog-1' });
  return { out, fake };
}

test('D17 A: a parked challenge is shown unmodified in the dialog and the second record carries the confirmation', opts, async () => {
  const shown: string[] = [];
  const { out, fake } = await confirmationCase({ confirm: async (summary: string) => { shown.push(summary); return 'confirmed'; } });
  assert.equal(out.ok, true, out.text);
  assert.deepEqual(shown, [CHALLENGE.summary]);
  const records = fake.calls.filter(c => c.tool === 'record');
  assert.equal(records.length, 2);
  assert.deepEqual(records[0]!.args, { ...PROPOSAL, nonce: NONCE });
  assert.deepEqual(records[1]!.args, { ...PROPOSAL, nonce: NONCE, confirmation: { challengeId: 'c1', decision: 'confirm', interactionId: 'dialog-1' } });
  assert.equal(fake.calls.at(-1)!.tool, 'close');
});

test('D17 A: a declined dialog sends a decline and reports nothing recorded', opts, async () => {
  const { out, fake } = await confirmationCase({ confirm: async () => 'declined' }, args => args.confirmation === undefined ? parkedRecord(args) : ({ ok: false, code: 'CONFIRMATION_REQUIRED', message: 'declined', value: undefined }));
  assert.equal(out.ok, false);
  assert.match(out.text, /declined/);
  assert.match(out.text, /Nothing was recorded/);
  assert.equal((fake.calls.filter(c => c.tool === 'record')[1]!.args as { confirmation: { decision: string } }).confirmation.decision, 'decline');
  assert.equal(fake.calls.at(-1)!.tool, 'close');
});

test('D17 A: an unavailable dialog (dismissed, or claude -p) sends no confirmation, names the manual command and closes', opts, async () => {
  const { out, fake } = await confirmationCase({ confirm: async () => 'unavailable' });
  assert.equal(out.ok, false);
  assert.match(out.text, /manual command/);
  assert.equal(fake.calls.filter(c => c.tool === 'record').length, 1);
  assert.equal(fake.calls.at(-1)!.tool, 'close');
});

test('D17 A: the mod never answers its own challenge when no human port is wired', opts, async () => {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, validate: () => ({ ok: true, value: PROPOSAL, message: '' }), record: parkedRecord });
  const { ctx, queue } = context({ session: session(fake.server) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const out = await m.acceptResult(new Map([['r1', queue[0]]]), { requestId: 'r1', result: RESULT }, { session: ctx.session });
  assert.equal(out.ok, false);
  assert.equal(fake.calls.filter(c => c.tool === 'record').length, 1);
});

test('D17 A: serverReply carries error.details so the challenge reaches the mod', opts, async () => {
  const m = await load();
  const reply = m.serverReply({ isError: true, content: [{ type: 'text', text: JSON.stringify({ protocol: 1, ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: 'm', details: { challenge: CHALLENGE } } }) }] });
  assert.equal(reply.code, 'CONFIRMATION_REQUIRED');
  assert.deepEqual(reply.details, { challenge: CHALLENGE });
});

// D16 A, live check pending (spec: Reviewed test suites): the mod's tool forwards only the request id.
test('specplane_run_tests sends only requestId to the server and drops anything else the model supplied', opts, async () => {
  const m = await load();
  const fake = fakeServer({ ...PREPARE_OK, executeTest: () => ({ ok: true, value: {}, message: '{"receipts":[]}' }) });
  const { ctx, queue } = context({ session: session(fake.server) });
  await m.runCommand(byName(m, 'plan-step'), '2026-11-01-plan', ctx);
  const pending = new Map([[queue[0].requestId, queue[0]]]);
  const out = await m.runReviewedTests(pending, { requestId: 'r1', executable: '/bin/sh', args: ['-c', 'id'], cwd: '/', env: { A: 'b' } }, { session: ctx.session });
  assert.equal(out.ok, true);
  const sent = fake.calls.filter(c => c.tool === 'executeTest');
  assert.deepEqual(sent.map(c => c.args), [{ requestId: 'r1', nonce: NONCE }]);
  const unknown = await m.runReviewedTests(pending, { requestId: 'nope' }, { session: ctx.session });
  assert.equal(unknown.ok, false);
  assert.equal(fake.calls.filter(c => c.tool === 'executeTest').length, 1, 'an unknown request id is refused without a server call');
});

test('the prompt names specplane_run_tests only for a plan-step whose criteria carry testRequirements (D16 A)', opts, async () => {
  const m = await load();
  const prompt = (workflow: string, criteria: unknown[]) => m.delegationPrompt({ workflow, requestId: 'r1', assetPath: 'SKILL.md', request: { criteria } });
  const withTests = [{ id: 'c1', testRequirements: [{ suiteId: 's', format: 'tap' }] }];
  assert.match(prompt('plan-step', withTests), /calling specplane_run_tests with \{"requestId":"r1"\} only/);
  assert.doesNotMatch(prompt('plan-step', [{ id: 'c1' }]), /specplane_run_tests/);
  assert.doesNotMatch(prompt('spec-assist', withTests), /specplane_run_tests/);
});

test('completion, validate, plan-status and plan-start delegate to exactly the core CLI operations and refuse bad arguments before the core is touched', opts, async () => {
  const m = await load();
  const cmd = (name: string) => m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === name);
  const run = async (name: string, args: string) => { const c = context(); const out = await m.runCommand(cmd(name), args, c.ctx); return { calls: c.calls, out }; };
  assert.deepEqual((await run('specplane-complete', 'feature/a')).calls, [['spec', 'complete', 'feature/a']]);
  assert.deepEqual((await run('specplane-complete', 'feature/a --status partial --dry-run')).calls, [['spec', 'implementation', 'feature/a', '--status', 'partial', '--dry-run']]);
  assert.deepEqual((await run('validate', '')).calls, [['validate']]);
  assert.deepEqual((await run('plan-status', '')).calls, [['plan', 'list', '--live']]);
  assert.deepEqual((await run('plan-start', '2026-11-01-p --no-fetch')).calls, [['plan', 'start', '2026-11-01-p', '--no-fetch']]);
  for (const [name, args] of [['specplane-complete', 'feature/a --status bogus'], ['specplane-complete', ''], ['plan-start', '']] as const) {
    const r = await run(name, args); assert.equal(r.calls.length, 0, `${name} ${args}`); assert.equal(r.out.exitCode, 2);
  }
  const model = context({ origin: { kind: 'tool' } });
  assert.notEqual((await m.runCommand(cmd('specplane-complete'), 'feature/a', model.ctx)).exitCode, 0);
  assert.equal(model.calls.length, 0, 'a state-changing command from a model origin never reaches the core');
});

test('the native reasoning path stays off unless the marker check passes, and a legacy skill keeps its name when it is on', opts, async () => {
  const h = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  const start = async (run: (argv: string[]) => Promise<{ exitCode: number }>, inventory: Array<{ name: string; source: string }> = []) => {
    const commands: string[] = [], tools: string[] = [], checked: string[][] = [];
    await h.startNative({
      plugin: { root: '/plugin' },
      process: { run: (argv: string[]) => { checked.push(argv); return run(argv); } },
      command: { list: async () => inventory, register: async (c: { name: string }) => { commands.push(c.name); } },
      tool: { register: async (t: { name: string }) => { tools.push(t.name); } },
      ui: { log: () => undefined },
    }, '/repo');
    return { commands, tools, checked };
  };
  const present = async () => ({ exitCode: 0 });
  for (const off of [async () => ({ exitCode: 1 }), async () => { throw new Error('no process'); }]) {
    const r = await start(off);
    assert.ok(!r.commands.includes('plan-step'));
    assert.deepEqual(r.tools, []);
  }
  const on = await start(present);
  assert.equal(on.checked[0].at(-1), `/plugin/${h.NATIVE_REASONING_MARKER}`);
  assert.ok(on.commands.includes('plan-step'));
  assert.equal(on.tools.length, 2);
  const skill = await start(present, [{ name: 'plan-step', source: 'projectSettings' }]);
  assert.ok(!skill.commands.includes('plan-step'), 'a legacy skill keeps /plan-step; native commands never shadow it');
  assert.ok(skill.commands.includes('plan-create'));
});
