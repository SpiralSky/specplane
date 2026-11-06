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
const req = (o: Record<string, unknown> = {}): Any => ({ requestId: 'r1', orchestrationId: 'o1', plan: 'p', step: 1, checkout: '/work/plan-p', workflowRequestPath: '/work/plan-p/.specplane/req.json', mode: 'unattended', limits: [{ kind: 'usd', amount: 2.5 }], ...o });
const mk = async (f: ReturnType<typeof fake>, extra: Record<string, unknown> = {}) => {
  const m = await load();
  return m.createClaudeSessionAdapter({ process: f.port, store: f.store, newId: () => '11111111-1111-4111-8111-111111111111', version: '2.1.317', ...extra });
};
const tick = () => new Promise(r => setTimeout(r, 0));
const INIT = JSON.stringify({ type: 'system', subtype: 'init', permissionMode: 'auto', plugins: [{ name: 'cc-plugin-telemetry' }, { name: 'specplane' }] });

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
  assert.deepEqual(argv.slice(0, 6), ['claude', '-p', '--session-id', '11111111-1111-4111-8111-111111111111', '--max-budget-usd', '2.5']);
  assert.match(argv.at(-1)!, /plan-step procedure.*\/work\/plan-p\/\.specplane\/req\.json$/);
  for (const bad of ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions']) assert.ok(!argv.includes(bad));
  assert.equal(s.pid, 4001);
});

test('route B launch: --max-budget-usd is omitted only without a usd limit; invalid limits, unknown kinds and multi-line paths refuse before any save or spawn', opts, async () => {
  const f = fake();
  const a = await mk(f);
  await a.launch(req({ limits: undefined }));
  assert.ok(!f.spawned[0].argv.includes('--max-budget-usd'));
  for (const bad of [{ limits: [{ kind: 'usd', amount: 0 }] }, { limits: [{ kind: 'usd', amount: -1 }] }, { limits: [{ kind: 'usd', amount: Number.NaN }] }, { limits: [{ kind: 'usage_percent', amount: 80 }] }, { workflowRequestPath: '/a\nb' }, { workflowRequestPath: '' }]) {
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

test('route B launch: after a spawn that threw, a later explicit launch of the same id starts a new session', opts, async () => {
  const g = fake({ throwOnSpawn: true });
  const b = await mk(g);
  await b.launch(req());
  assert.equal((await b.launch(req())).state, 'unknown');
  assert.equal(g.events.filter(e => e === 'spawn').length, 2);
});

test('route B launch: a live process on the same orchestration id refuses, spawns nothing and keeps the mapping; an exited one may relaunch', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const first = await a.launch(req());
  const saves = f.saved.length;
  await assert.rejects(a.launch(req()), /launch refused/);
  assert.equal(f.spawned.length, 1);
  assert.equal(f.saved.length, saves);
  assert.equal((await a.observe(first)).state, 'running');
  await a.cancel(first, 'SIGTERM').catch(() => undefined);
  f.spawned[0]!.exit(143);
  await new Promise(r => setTimeout(r, 0));
  await a.launch(req());
  assert.equal(f.spawned.length, 2);
});

test('route B launch: after a restart a stored mapping refuses unless its pid is positively dead', opts, async () => {
  for (const [alive, pid, refused] of [[() => true, 7, true], [undefined, 7, true], [() => false, undefined, true], [() => false, 7, false]] as const) {
    const f = fake(alive ? { alive } : {});
    f.saved.push({ orchestrationId: req().orchestrationId, nativeSessionId: 'old', ...(pid ? { pid } : {}) });
    const a = await mk(f);
    if (refused) { await assert.rejects(a.launch(req()), /launch refused/); assert.equal(f.spawned.length, 0); }
    else { await a.launch(req()); assert.equal(f.spawned.length, 1); }
  }
});

test('route B permissions: auto mode on launch and resume; the variadic lists never swallow the prompt; allow rules stay narrow and the hard limits are denied', opts, async () => {
  const m = await load();
  for (const mode of ['launch', 'resume'] as const) {
    const argv: string[] = m.buildArgv(mode, 'sid', req());
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'auto');
    assert.equal(argv[argv.indexOf('--permission-prompts') + 1], 'none');
    assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Skill');
    assert.equal(argv[argv.indexOf('--disallowedTools') + 1], m.DISALLOWED_TOOLS.join(','));
    assert.match(argv[argv.indexOf('--disallowedTools') + 2], /^--/);
    assert.equal(argv.at(-2), '--verbose');
  }
  assert.deepEqual([...m.ALLOWED_TOOLS], ['Skill']);
  for (const c of ['git push', 'git reset --hard', 'git clean', 'sudo', 'npm publish', 'specplane spec approve', 'specplane spec reopen', 'specplane plan approve', 'specplane plan finish', 'specplane plan step-done', 'specplane plan abandon', 'specplane decision accept']) assert.ok(m.DISALLOWED_TOOLS.includes(`Bash(${c} *)`), c);
  for (const rule of m.DISALLOWED_TOOLS) assert.ok(!rule.includes(','), rule);
});

test('route B guard: init without the plugin or without auto mode stops the process and is failed; a malformed value counts as missing', opts, async () => {
  const plugins = [{ name: 'specplane' }];
  for (const init of [{ permissionMode: 'auto', plugins: [{ name: 'cc-plugin-telemetry' }] }, { permissionMode: 'auto', plugins: [] }, { permissionMode: 'auto' }, { permissionMode: 'auto', plugins: 'specplane' }, { permissionMode: 'auto', plugins: [null] }, { plugins }, { permissionMode: 'default', plugins }, { permissionMode: 'dontAsk', plugins }]) {
    const f = fake();
    const a = await mk(f);
    const s = await a.launch(req());
    f.spawned[0].emit(JSON.stringify({ type: 'system', subtype: 'init', ...init }));
    assert.deepEqual(f.spawned[0].kills, ['SIGTERM'], JSON.stringify(init));
    assert.equal((await a.observe(s)).state, 'failed', JSON.stringify(init));
    f.spawned[0].emit(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));
    f.spawned[0].exit(0); await tick();
    assert.equal((await a.observe(s)).state, 'failed', `${JSON.stringify(init)} never becomes completed`);
  }
});

test('route B guard: a success with no init event is unknown, never completed; a good init is not stopped', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  f.spawned[0].emit(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));
  f.spawned[0].exit(0); await tick();
  assert.equal((await a.observe(s)).state, 'unknown');
  const g = fake();
  const b = await mk(g);
  await b.launch(req());
  g.spawned[0].emit(INIT);
  assert.deepEqual(g.spawned[0].kills, []);
});

test('route B observe: result success with exit 0 is completed; the state is running until the process exits', opts, async () => {
  const f = fake();
  const a = await mk(f);
  const s = await a.launch(req());
  assert.equal((await a.observe(s)).state, 'running');
  f.spawned[0].emit(INIT);
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
  const r = await a.resume(s, req({ limits: [{ kind: 'usd', amount: 1 }] }));
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
  const none = { launch: false, observe: false, resume: false, cancel: false, limitKinds: [] };
  const pass = { version: '2.1.317', launched: true, observed: true, resumed: true, cancelled: true, budgetStopSeen: true };
  const probe = async (extra: Record<string, unknown>) => {
    const caps = await (await mk(fake(), extra)).probe({ checkout: '/x', requirements: ['launch'] });
    return caps;
  };
  const pick = (c: Any) => ({ launch: c.launch, observe: c.observe, resume: c.resume, cancel: c.cancel, limitKinds: c.limitKinds });
  const bare = await probe({});
  assert.deepEqual(pick(bare), none);
  assert.deepEqual(bare.backends, ['worktree']);
  assert.equal(bare.host, 'claude-code');
  assert.equal(bare.surface, 'headless');
  assert.deepEqual(pick(await probe({ evidence: pass, version: '2.1.999' })), none);
  assert.deepEqual(pick(await probe({ evidence: pass, version: undefined })), none);
  assert.deepEqual(pick(await probe({ evidence: { ...pass, budgetStopSeen: false } })), { ...none, launch: true, observe: true, resume: true, cancel: true });
  assert.deepEqual(pick(await probe({ evidence: pass })), { launch: true, observe: true, resume: true, cancel: true, limitKinds: ['usd'] });
});

const PASS_U = { version: '2.1.317', launched: true, observed: true, resumed: true, cancelled: true, budgetStopSeen: true, usagePercentSeen: true };
// Test-only reader for a made-up event shape, so these tests pin the adapter's rules apart from the real reader below.
const readU = (e: Any) => (e && e.type === 'test_usage' ? [{ window: e.window, usedPercent: e.pct }] : undefined);
const U = (window: string, pct: unknown) => JSON.stringify({ type: 'test_usage', window, pct });
const ulim = (window: string, amount: number) => ({ limits: [{ kind: 'usage_percent', window, amount }] });

test('route B usage_percent: undeclared without readUsage, without evidence, with other-version evidence or without usagePercentSeen', opts, async () => {
  const kinds = async (extra: Record<string, unknown>) => (await (await mk(fake(), extra)).probe({ checkout: '/x', requirements: [] })).limitKinds;
  assert.deepEqual(await kinds({ evidence: PASS_U }), ['usd']);
  assert.deepEqual(await kinds({ readUsage: readU }), []);
  assert.deepEqual(await kinds({ readUsage: readU, evidence: PASS_U, version: '2.1.999' }), []);
  assert.deepEqual(await kinds({ readUsage: readU, evidence: { ...PASS_U, usagePercentSeen: false } }), ['usd']);
  assert.deepEqual(await kinds({ readUsage: readU, evidence: { ...PASS_U, usagePercentSeen: undefined } }), ['usd']);
  assert.deepEqual(await kinds({ readUsage: readU, evidence: PASS_U }), ['usd', 'usage_percent']);
  // Undeclared: launch refuses before any spawn, as before.
  const f = fake();
  await assert.rejects((await mk(f, { evidence: PASS_U })).launch(req(ulim('five_hour', 80))));
  await assert.rejects((await mk(f, { readUsage: readU, evidence: { ...PASS_U, usagePercentSeen: false } })).launch(req(ulim('five_hour', 80))));
  assert.equal(f.spawned.length, 0);
});

test('route B usage_percent: declared adapter validates window and amount and adds no argv flag', opts, async () => {
  const f = fake();
  const a = await mk(f, { readUsage: readU, evidence: PASS_U });
  for (const bad of [ulim('hourly', 50), ulim('five_hour', 0), ulim('five_hour', 101), ulim('five_hour', Number.NaN)]) await assert.rejects(a.launch(req({ orchestrationId: 'ox', ...bad })));
  assert.equal(f.spawned.length, 0);
  await a.launch(req({ limits: [{ kind: 'usd', amount: 2 }, { kind: 'usage_percent', window: 'seven_day', amount: 100 }] }));
  const argv = f.spawned[0].argv;
  assert.equal(argv.filter(x => x === '--max-budget-usd').length, 1);
  assert.ok(!argv.some(x => /usage|percent/.test(x)));
});

const startU = async (limits: Any, extra: Record<string, unknown> = {}, fopts: Parameters<typeof fake>[0] = {}) => {
  const f = fake(fopts);
  const a = await mk(f, { readUsage: readU, evidence: PASS_U, ...extra });
  const s = await a.launch(req({ limits }));
  f.spawned[0].emit(INIT);
  return { f, a, ref: { orchestrationId: 'o1', nativeSessionId: s.nativeSessionId } };
};
const finish = async (f: ReturnType<typeof fake>) => { f.spawned[0].emit(JSON.stringify({ type: 'result', subtype: 'success', is_error: false })); f.spawned[0].exit(0); await tick(); };

test('route B usage_percent: crossing the threshold for the matching window cancels through the cancel path and reports a limit stop', opts, async () => {
  const { f, a, ref } = await startU(ulim('five_hour', 80).limits);
  f.spawned[0].emit(U('seven_day', 99)); await tick();
  assert.deepEqual(f.spawned[0].kills, []);
  f.spawned[0].emit(U('five_hour', 79.9)); await tick();
  assert.deepEqual(f.spawned[0].kills, []);
  assert.equal((await a.observe(ref)).state, 'running');
  f.spawned[0].emit(U('five_hour', 80)); await tick();
  assert.deepEqual(f.spawned[0].kills, ['SIGTERM']);
  const s = await a.observe(ref);
  assert.equal(s.state, 'failed'); assert.equal(s.stop, 'limit');
  assert.deepEqual(await a.cancel(ref), { stopped: true, recoveryRequired: false });
});

test('route B usage_percent: a limit stop is reported only after the process exits; a late success result cannot turn it into completed', opts, async () => {
  const { f, a, ref } = await startU(ulim('seven_day', 50).limits, {}, { ignoreKill: true });
  f.spawned[0].emit(U('seven_day', 60)); await tick();
  assert.equal((await a.observe(ref)).state, 'running');
  await finish(f);
  const o = await a.observe(ref);
  assert.equal(o.state, 'failed'); assert.equal(o.stop, 'limit');
});

test('route B usage_percent: below the threshold the session continues to completed', opts, async () => {
  const { f, a, ref } = await startU(ulim('five_hour', 80).limits);
  f.spawned[0].emit(U('five_hour', 10)); f.spawned[0].emit(U('five_hour', 79)); await finish(f);
  assert.deepEqual(f.spawned[0].kills, []);
  const s = await a.observe(ref);
  assert.equal(s.state, 'completed'); assert.equal(s.stop, undefined);
});

test('route B usage_percent: with the limit active, no usable reading is unknown, never completed (fail-closed)', opts, async () => {
  const unusable: unknown[] = [undefined, { window: 'five_hour', usedPercent: Number.NaN }, { window: 'five_hour', usedPercent: -1 }, { window: 'five_hour', usedPercent: 101 }, { window: 'five_hour', usedPercent: '50' }];
  for (const r of unusable) {
    const { f, a, ref } = await startU(ulim('five_hour', 80).limits, { readUsage: () => (r === undefined ? r : [r]) });
    f.spawned[0].emit(U('five_hour', 1));
    await finish(f);
    assert.equal((await a.observe(ref)).state, 'unknown');
  }
  // A throwing reader and a reading for only the other window are equally unusable.
  const t1 = await startU(ulim('five_hour', 80).limits, { readUsage: () => { throw new Error('boom'); } });
  await finish(t1.f); assert.equal((await t1.a.observe(t1.ref)).state, 'unknown');
  const t2 = await startU(ulim('five_hour', 80).limits);
  t2.f.spawned[0].emit(U('seven_day', 1)); await finish(t2.f); assert.equal((await t2.a.observe(t2.ref)).state, 'unknown');
  // Two windows: both must have a reading.
  const t3 = await startU([...ulim('five_hour', 80).limits, ...ulim('seven_day', 80).limits]);
  t3.f.spawned[0].emit(U('five_hour', 1)); await finish(t3.f); assert.equal((await t3.a.observe(t3.ref)).state, 'unknown');
});

test('route B usage_percent: without a usage limit the reader is not consulted and usd-only sessions behave as before', opts, async () => {
  let calls = 0;
  const { f, a, ref } = await startU([{ kind: 'usd', amount: 2.5 }], { readUsage: () => { calls++; return undefined; } });
  await finish(f);
  assert.equal(calls, 0); assert.equal((await a.observe(ref)).state, 'completed');
});

test('route B stays gated in the plugin: handlers do not import the adapter and no marker gates reasoning', opts, async () => {
  const fs = await import('node:fs');
  const handlers = fs.readFileSync(path.join(repo, 'harnesses/claude/plugin/hooks/handlers.ts'), 'utf8');
  assert.ok(!/nativeReasoning|native-reasoning/.test(handlers));
  assert.ok(!/session-adapter/.test(handlers));
});

// The event as captured on 2.1.317 (host-evidence/2.1.317/usage-capture.jsonl), with the utilization values made settable.
const rateLimitEvent = (fiveHour: unknown, sevenDay: unknown) => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed', resetsAt: 1793962800, rateLimitType: 'five_hour', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: fiveHour, resetsAt: 1793962800, status: 'allowed' }, seven_day: { utilization: sevenDay, resetsAt: 1794474000, status: 'allowed' } },
  },
  uuid: 'bc5324cd-911c-4312-8650-713c300ea022', session_id: '333ceeff-d44a-4ddb-bc6f-613688f7c734',
});

test('readClaudeUsage reads both windows of the captured event as percentages', opts, async () => {
  const { readClaudeUsage } = await load();
  assert.deepEqual(readClaudeUsage(rateLimitEvent(0.01, 0.17)), [{ window: 'five_hour', usedPercent: 1 }, { window: 'seven_day', usedPercent: 17 }]);
  assert.deepEqual(readClaudeUsage(rateLimitEvent(0.29, 0)), [{ window: 'five_hour', usedPercent: 29 }, { window: 'seven_day', usedPercent: 0 }]);
});

test('readClaudeUsage reads an account past its limit as 100 and skips what it cannot read', opts, async () => {
  const { readClaudeUsage } = await load();
  assert.deepEqual(readClaudeUsage(rateLimitEvent(1.02, 0.5)), [{ window: 'five_hour', usedPercent: 100 }, { window: 'seven_day', usedPercent: 50 }]);
  assert.deepEqual(readClaudeUsage(rateLimitEvent('0.5', -1)), []);
  for (const e of [null, 'x', { type: 'assistant' }, { type: 'rate_limit_event' }, { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: null } }]) assert.equal(readClaudeUsage(e), undefined);
});

test('route B usage_percent: with the real reader, one event satisfies limits on both windows and stops on either', opts, async () => {
  const { readClaudeUsage } = await load();
  const both = [{ kind: 'usage_percent', window: 'five_hour', amount: 80 }, { kind: 'usage_percent', window: 'seven_day', amount: 80 }];
  const below = await startU(both, { readUsage: readClaudeUsage });
  below.f.spawned[0].emit(JSON.stringify(rateLimitEvent(0.01, 0.17)));
  await finish(below.f);
  assert.equal((await below.a.observe(below.ref)).state, 'completed');
  const over = await startU(both, { readUsage: readClaudeUsage });
  over.f.spawned[0].emit(JSON.stringify(rateLimitEvent(0.01, 0.8)));
  assert.deepEqual(over.f.spawned[0].kills, ['SIGTERM']);
});
