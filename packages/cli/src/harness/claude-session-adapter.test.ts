/**
 * Offline coverage for the Claude route B session adapter (claude-delivery 03 criterion 1; D25 option 1; A13).
 * A fake process port stands in for `$.process.spawn`; no test starts a real `claude`. The adapter is TypeScript source
 * under harnesses/claude/plugin/hooks, so Bun loads it; the Node fallback skips this file like the handler tests.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const opts = { skip: hasBun ? false : 'loads TypeScript source; run with Bun' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import(pathToFileURL(path.join(repo, 'harnesses/claude/plugin/hooks/session-adapter.ts')).href);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function fake(opts2: { throwOnSpawn?: boolean; ignoreKill?: boolean; alive?: (pid: number) => boolean } = {}) {
  const spawned: Array<{ argv: string[]; cwd: string; emit: (l: string) => void; exit: (c: number | null) => void; kills: string[] }> = [];
  const events: string[] = [];
  const port = {
    spawn(argv: string[], o: { cwd: string }) {
      events.push('spawn');
      if (opts2.throwOnSpawn) throw new Error('spawn failed');
      let cb: (l: string) => void = () => {};
      let resolve!: (c: number | null) => void;
      const exited = new Promise<number | null>(r => { resolve = r; });
      const rec = { argv: [...argv], cwd: o.cwd, emit: (l: string) => cb(l), exit: (c: number | null) => resolve(c), kills: [] as string[] };
      spawned.push(rec);
      return { pid: 4000 + spawned.length, onLine: (f: (l: string) => void) => { cb = f; }, exited, kill: (s: string) => { rec.kills.push(s); if (!opts2.ignoreKill) resolve(null); } };
    },
    ...(opts2.alive ? { isAlive: opts2.alive } : {}),
  };
  const saved: Any[] = [];
  const store = {
    save: (r: Any) => { events.push('save'); saved.push({ ...r }); },
    load: (id: string) => [...saved].reverse().find(r => r.orchestrationId === id),
  };
  return { port, store, spawned, saved, events };
}
const req = (o: Record<string, unknown> = {}): Any => ({ requestId: 'r1', orchestrationId: 'o1', plan: 'p', step: 1, checkout: '/work/plan-p', workflowRequestPath: '/work/plan-p/.specplane/req.json', mode: 'unattended', budgetUsd: 2.5, ...o });
const mk = async (f: ReturnType<typeof fake>, extra: Record<string, unknown> = {}) => {
  const m = await load();
  return m.createClaudeSessionAdapter({ process: f.port, store: f.store, newId: () => '11111111-1111-4111-8111-111111111111', version: '2.1.317', ...extra });
};
const tick = () => new Promise(r => setTimeout(r, 0));

test('route B launch: argv, checkout, mapping persisted before spawn, no --bare or permission bypass', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  assert.equal(s.state, 'running');
  assert.equal(s.nativeSessionId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(f.events.slice(0, 2), ['save', 'spawn']);
  assert.deepEqual(f.saved[0], { orchestrationId: 'o1', nativeSessionId: '11111111-1111-4111-8111-111111111111' });
  const { argv, cwd } = f.spawned[0];
  assert.equal(cwd, '/work/plan-p');
  assert.deepEqual(argv.slice(0, 9), ['claude', '-p', '--session-id', '11111111-1111-4111-8111-111111111111', '--max-budget-usd', '2.5', '--output-format', 'stream-json', '--verbose']);
  assert.equal(argv.length, 10);
  assert.match(argv[9], /plan-step procedure.*\/work\/plan-p\/\.specplane\/req\.json$/);
  for (const bad of ['--bare', '--dangerously-skip-permissions', '--permission-mode', '--allow-dangerously-skip-permissions']) assert.ok(!argv.includes(bad));
  assert.equal(s.pid, 4001);
});

test('route B launch: --max-budget-usd is omitted only without budgetUsd; invalid budgets and multi-line paths refuse before any save or spawn', opts, async () => {
  const f = fake();
  const a = await mk(f);
  await a.launch(req({ budgetUsd: undefined }));
  assert.ok(!f.spawned[0].argv.includes('--max-budget-usd'));
  for (const bad of [{ budgetUsd: 0 }, { budgetUsd: -1 }, { budgetUsd: Number.NaN }, { workflowRequestPath: '/a\nb' }, { workflowRequestPath: '' }]) {
    await assert.rejects(a.launch(req({ orchestrationId: 'ox', ...bad })));
  }
  assert.equal(f.spawned.length, 1);
  assert.ok(f.saved.every(r => r.orchestrationId === 'o1'));
  await assert.rejects(a.launch(req({ orchestrationId: 'oy', signal: AbortSignal.abort() })));
  assert.equal(f.spawned.length, 1);
});

test('route B launch: a failed mapping save spawns nothing; a failed spawn is unknown and never retried', opts, async () => {
  const f = fake();
  const m = await load();
  const a = m.createClaudeSessionAdapter({ process: f.port, store: { save() { throw new Error('disk'); }, load() { return undefined; } }, newId: () => 'x' });
  await assert.rejects(a.launch(req()));
  assert.equal(f.spawned.length, 0);
  const g = fake({ throwOnSpawn: true });
  const b = await mk(g);
  const s = await b.launch(req());
  assert.equal(s.state, 'unknown');
  assert.equal(g.events.filter(e => e === 'spawn').length, 1);
});

test('route B observe: result success with exit 0 is completed; the state is running until the process exits', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  assert.equal((await a.observe(s)).state, 'running');
  f.spawned[0].emit(JSON.stringify({ type: 'system', subtype: 'init' }));
  f.spawned[0].emit(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));
  assert.equal((await a.observe(s)).state, 'running');
  f.spawned[0].exit(0); await tick();
  assert.equal((await a.observe(s)).state, 'completed');
});

test('route B observe: any other terminal result, is_error, or non-zero exit is failed (budget stop included)', opts, async () => {
  for (const [lines, code] of [
    [[{ type: 'result', subtype: 'error_max_budget_usd' }], 0],
    [[{ type: 'result', subtype: 'error_during_execution' }], 1],
    [[{ type: 'result', subtype: 'success', is_error: true }], 0],
    [[{ type: 'result', subtype: 'success' }], 2],
    [[], 1],
  ] as Array<[Any[], number]>) {
    const f = fake();
    const a = await mk(f);
    const s = await a.launch(req());
    for (const l of lines) f.spawned[0].emit(JSON.stringify(l));
    f.spawned[0].exit(code); await tick();
    assert.equal((await a.observe(s)).state, 'failed', JSON.stringify([lines, code]));
  }
});

test('route B observe: missing process, unparseable output, unrecognised shape and exit 0 without a result are unknown, never no-session', opts, async () => {
  const f = fake();
  const a = await mk(f);
  assert.equal((await a.observe({ orchestrationId: 'nope' })).state, 'unknown');
  for (const line of ['not json', '[1]', '{"no":"type"}', JSON.stringify({ type: 'result' })]) {
    const g = fake();
    const b = await mk(g);
    const s = await b.launch(req());
    g.spawned[0].emit(line);
    assert.equal((await b.observe(s)).state, 'unknown', line);
    g.spawned[0].emit(JSON.stringify({ type: 'result', subtype: 'success' }));
    g.spawned[0].exit(0); await tick();
    assert.equal((await b.observe(s)).state, 'unknown', `${line} stays unknown`);
  }
  const s = await a.launch(req());
  f.spawned[0].exit(0); await tick();
  assert.equal((await a.observe(s)).state, 'unknown');
  assert.equal((await a.observe({ orchestrationId: 'o1', nativeSessionId: 'other' })).state, 'unknown');
  const h = fake();
  const c = await mk(h);
  const s2 = await c.launch(req());
  h.spawned[0].exit(null); await tick();
  assert.equal((await c.observe(s2)).state, 'unknown');
});

test('route B resume: --resume replaces --session-id, only when the mapping matches and no live process holds the session', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  await assert.rejects(a.resume(s, req()), /live process/);
  f.spawned[0].exit(1); await tick();
  await assert.rejects(a.resume({ ...s, nativeSessionId: 'wrong' }, req()), /no persisted mapping/);
  await assert.rejects(a.resume({ orchestrationId: 'o1' }, req()), /no persisted mapping/);
  await assert.rejects(a.resume(s, req({ orchestrationId: 'o2' })), /no persisted mapping/);
  const r = await a.resume(s, req({ budgetUsd: 1 }));
  assert.equal(r.state, 'running');
  const argv = f.spawned[1].argv;
  assert.deepEqual(argv.slice(0, 6), ['claude', '-p', '--resume', s.nativeSessionId, '--max-budget-usd', '1']);
  assert.ok(!argv.includes('--session-id'));
  assert.equal(f.spawned[1].cwd, '/work/plan-p');
  assert.equal((await a.observe(r)).state, 'running');
});

test('route B resume after a restart: refuses unless the port positively reports the recorded pid dead', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  for (const alive of [undefined, () => true, () => false] as Array<((pid: number) => boolean) | undefined>) {
    const g = fake(alive ? { alive } : {});
    g.saved.push(...f.saved);
    const b = await mk(g);
    if (alive && !alive(0)) { const r = await b.resume(s, req()); assert.equal(r.state, 'running'); assert.equal(g.spawned.length, 1); }
    else { await assert.rejects(b.resume(s, req()), /cannot confirm/); assert.equal(g.spawned.length, 0); }
  }
  const h = fake({ alive: () => false });
  h.saved.push({ orchestrationId: 'o1', nativeSessionId: s.nativeSessionId });
  await assert.rejects((await mk(h)).resume({ orchestrationId: 'o1', nativeSessionId: s.nativeSessionId }, req()), /cannot confirm/);
});

test('route B cancel: stopped only after the exit is observed; an ignored kill requires recovery', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  assert.deepEqual(await a.cancel(s), { stopped: true, recoveryRequired: false });
  assert.deepEqual(f.spawned[0].kills, ['SIGTERM']);
  assert.deepEqual(await a.cancel(s), { stopped: true, recoveryRequired: false });
  const g = fake({ ignoreKill: true });
  const b = await mk(g, { cancelWaitMs: 5 });
  const s2 = await b.launch(req());
  assert.deepEqual(await b.cancel(s2), { stopped: false, recoveryRequired: true });
  assert.deepEqual(await b.cancel({ orchestrationId: 'ghost' }), { stopped: false, recoveryRequired: true });
});

test('route B recovery: attach instructions from the persisted id, or an unavailable reason', opts, async () => {
  const f = fake();
  const a = await mk(f, { logPath: () => '/logs/o1.jsonl' });
  const s = await a.launch(req());
  assert.deepEqual(await a.recovery(s), { available: true, instructions: [['claude', '--resume', s.nativeSessionId], ['less', '/logs/o1.jsonl']] });
  assert.deepEqual((await a.recovery({ orchestrationId: 'o1' })).instructions?.[0], ['claude', '--resume', s.nativeSessionId]);
  const r = await a.recovery({ orchestrationId: 'none' });
  assert.equal(r.available, false);
  assert.ok(r.reason);
});

test('route B recovery: a ref id without a matching persisted mapping is unavailable', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const none = await a.recovery({ orchestrationId: 'o9', nativeSessionId: 'made-up-id' });
  assert.equal(none.available, false);
  const s = await a.launch(req());
  const other = await a.recovery({ orchestrationId: 'o1', nativeSessionId: 'not-the-persisted-id' });
  assert.equal(other.available, false);
  assert.equal((await a.recovery(s)).available, true);
});

test('route B probe is gated: every capability false without a passed probe record for the installed version', opts, async () => {
  const none = { launch: false, observe: false, resume: false, cancel: false, budgetEnforcement: false };
  const pass = { version: '2.1.317', launched: true, observed: true, resumed: true, cancelled: true, budgetStopSeen: true };
  const probe = async (extra: Record<string, unknown>) => {
    const caps = await (await mk(fake(), extra)).probe({ checkout: '/x', requirements: ['launch'] });
    return caps;
  };
  const pick = (c: Any) => ({ launch: c.launch, observe: c.observe, resume: c.resume, cancel: c.cancel, budgetEnforcement: c.budgetEnforcement });
  const bare = await probe({});
  assert.deepEqual(pick(bare), none);
  assert.deepEqual(bare.backends, ['worktree']);
  assert.equal(bare.host, 'claude-code');
  assert.equal(bare.surface, 'headless');
  assert.deepEqual(pick(await probe({ evidence: pass, version: '2.1.999' })), none);
  assert.deepEqual(pick(await probe({ evidence: pass, version: undefined })), none);
  assert.deepEqual(pick(await probe({ evidence: { ...pass, budgetStopSeen: false } })), { ...none, launch: true, observe: true, resume: true, cancel: true });
  assert.deepEqual(pick(await probe({ evidence: pass })), { launch: true, observe: true, resume: true, cancel: true, budgetEnforcement: true });
});

test('route B stays gated in the plugin: startNative keeps reasoning false and handlers do not import the adapter', opts, async () => {
  const fs = await import('node:fs');
  const handlers = fs.readFileSync(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts'), 'utf8');
  assert.match(handlers, /const reasoning = false/);
  assert.ok(!/session-adapter/.test(handlers));
});
