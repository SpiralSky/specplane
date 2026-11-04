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
  const queue: unknown[] = [];
  let asked = 0;
  const ctx = {
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

test('reasoning delegation prepares through the core, queues an extension-origin request and records only a matching result', opts, async () => {
  const m = await load();
  const step = m.NATIVE_COMMANDS.find((c: { name: string }) => c.name === 'plan-step');
  const recorded: unknown[] = [];
  const core = {
    cli: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    prepare: async (workflow: string) => ({ ok: true, requestId: 'r1', requestPath: `/tmp/${workflow}.json` }),
    record: async (id: string, result: unknown) => { recorded.push([id, result]); return { ok: true, text: 'recorded' }; },
  };
  const { ctx, queue } = context({ core });
  const out = await m.runCommand(step, '', ctx);
  assert.equal(out.exitCode, undefined);
  assert.equal(queue.length, 1);
  const prompt = m.delegationPrompt(queue[0]);
  assert.match(prompt, /specplane-reason-plan-step\/SKILL\.md/);
  assert.match(prompt, /not an approval/);
  const pending = new Map([['r1', queue[0]]]);
  const human = { confirm: async () => 'confirmed' };
  assert.equal((await m.acceptResult(pending, { requestId: 'nope', result: {} }, { core, human, signal: ctx.signal })).ok, false);
  assert.equal((await m.acceptResult(pending, { requestId: 'r1', result: { outcome: 'done' } }, { core, human, signal: ctx.signal })).ok, true);
  assert.equal((await m.acceptResult(pending, { requestId: 'r1', result: {} }, { core, human, signal: ctx.signal })).ok, false);
  assert.equal(recorded.length, 1);
  const refused = context({ core: { ...core, prepare: async () => ({ ok: false, message: 'dirty checkout.' }) } });
  assert.match((await m.runCommand(step, '', refused.ctx)).text, /Nothing was delegated/);
  assert.equal(refused.queue.length, 0);
  const none = context();
  assert.match((await m.runCommand(step, '', none.ctx)).text, /unavailable/);
  const plugin = context({ origin: { kind: 'plugin' }, core });
  assert.equal((await m.runCommand(step, '', plugin.ctx)).exitCode, 2);
  assert.equal(plugin.queue.length, 0);
});

test('the model cannot call the Specplane workflow server; other tools pass the tool.check gate', async () => {
  const handlers = await import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts')).href);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__plugin_specplane_specplane__prepare' }), true);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__specplane__record' }), true);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'mcp__github__issue' }), false);
  assert.equal(handlers.isSpecplaneServerTool({ tool: 'Bash' }), false);
  assert.equal(handlers.isSpecplaneServerTool({}), false);
});
