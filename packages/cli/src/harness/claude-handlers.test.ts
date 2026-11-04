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

test('every Claude workflow has a native command; reasoning workflows keep a fallback skill and mechanical ones have none', opts, async () => {
  const m = await load();
  for (const workflow of CLAUDE_WORKFLOWS) {
    const cmd = m.NATIVE_COMMANDS.find((c: { workflow: string }) => c.workflow === workflow);
    assert.ok(cmd, `${workflow} has no native command`);
    const fallback = fs.existsSync(path.join(repo, 'harnesses/claude/templates/skills', workflow, 'SKILL.md'));
    assert.equal(fallback, cmd.kind === 'reasoning', `${workflow}: fallback skill ${cmd.kind === 'reasoning' ? 'missing' : 'must not exist (D10)'}`);
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

test('the model cannot call the Specplane workflow server; other tools pass the tool.check gate', async () => {
  const handlers = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__plugin_specplane_specplane__prepare' }), true);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__specplane__record' }), true);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__github__issue' }), false);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'Bash' }), false);
  assert.equal(handlers.isSpecplaneServerTool({}), false);
});

// Reasoning path (claude-delivery 03). A fake Specplane server stands for `$.mcp`; each call is recorded with its arguments.
type Reply = { ok: boolean; value?: unknown; message: string };
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

test('server replies are read from the core Result, or from plain text for bind and refusals', opts, async () => {
  const m = await load();
  const okReply = m.serverReply({ content: [{ type: 'text', text: '{"protocol":1,"ok":true,"value":{"requestId":"r1"},"notices":[]}' }], isError: false });
  assert.equal(okReply.ok, true);
  assert.deepEqual(okReply.value, { requestId: 'r1' });
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

test('the registered gate denies a server call without the session nonce and a throwing gate denies it too', opts, async () => {
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
  const next = Object.assign(() => ({ decision: 'allow' }), { signal: new AbortController().signal });
  const server = { tool: 'mcp__plugin_specplane_specplane__prepare', input: {} };
  assert.equal(gate.handler({}, server, next).decision, 'deny');
  assert.equal(gate.handler({}, { tool: 'mcp__plugin_specplane_specplane__prepare', input: { nonce: h.currentNonce() } }, next).decision, 'allow');
  assert.equal(gate.handler({}, { tool: 'Bash', input: {} }, next).decision, 'allow');
  assert.equal(gate.catcher({}, server, next).decision, 'deny');
  assert.equal(gate.catcher({}, { tool: 'Bash', input: {} }, next).decision, 'allow');
});
