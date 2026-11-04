/** Consumer-side scripted-client tests: the installed Codex skill package driven as a separate project would drive it. Deterministic scripted results only; no live Codex host, session or model comprehension is claimed. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runInit } from '../commands/init.js';
import { sha256 } from '../core/workflow-preparation.js';
import { CODEX_SKILL } from './codex.js';

const SKILL_DIR = path.posix.dirname(CODEX_SKILL);
const ID = '2026-11-05-consumer';
const STEP = `plans/${ID}/steps/01-feature.md`;
const PROCEDURE = `plans/${ID}/procedure.md`;
const EVIDENCE = JSON.stringify({ surface: 'cli', probes: { nativeCommands: false, backgroundSessions: false } });
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-consumer-')));
const put = (root: string, rel: string, text: string) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

/** A consumer repository that has none of this source tree: Codex skill installed, a ready plan on `plan/<id>`, and a bare remote. */
function consumer(opts: { plan?: boolean } = {}) {
  const base = tmp(); const root = path.join(base, 'consumer'); const bare = path.join(base, 'remote.git');
  fs.mkdirSync(root); git(root, 'init', '-q', '-b', 'main'); git(base, 'init', '-q', '--bare', bare);
  put(root, '.specplane/config.yaml', 'spec_roots:\n  - name: base\n    path: specs\nplans:\n  forge: none\n  require_approved_specs: none\nexecution:\n  backend: branch\n');
  put(root, 'specs/features/calc.md', '---\nid: feature/calc\ntitle: Calc\nstatus: approved\nauthor: user\n---\n# Calc\n\n## Acceptance criteria\n\n- [ ] Adds numbers\n');
  runInit(root, { harness: 'codex' });
  fs.appendFileSync(path.join(root, '.git/info/exclude'), `${SKILL_DIR}/\n`);
  put(root, 'src/calc.js', 'exports.add = (a, b) => 0;\n');
  const planText = (execution: string) => `---\nid: ${ID}\ntitle: Calc\nstatus: ready\nspecs: [base:feature/calc]\n${execution}---\n# Plan\n`;
  put(root, `plans/${ID}/PLAN.md`, planText(''));
  put(root, STEP, `---\nplan: ${ID}\nstep: 1\ntitle: Add\nstatus: pending\ncontext:\n  - file: src/calc.js\n  - file: ${PROCEDURE}\n---\n# Add\n\n## Acceptance criteria\n\n- [ ] add returns the sum\n`);
  const mapping = { schemaVersion: 1, workflow: 'plan-step', criteria: [{ sourcePath: STEP, sourceDigest: sha256(fs.readFileSync(path.join(root, STEP))), criterionIndex: 1, evidence: 'test', testRequirements: [{ suiteId: 'calc', format: 'node-tap-v13' }] }] };
  put(root, PROCEDURE, '# Procedure\n\n```specplane-test-requirements\n' + JSON.stringify(mapping) + '\n```\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base'); git(root, 'remote', 'add', 'origin', bare); git(root, 'push', '-q', 'origin', 'main');
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  if (opts.plan === false) return { base, root, bare, baseCommit };
  git(root, 'switch', '-qc', `plan/${ID}`);
  put(root, `plans/${ID}/PLAN.md`, planText(`execution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${baseCommit}\n`));
  git(root, 'commit', '-qam', 'bind plan'); git(root, 'push', '-qu', 'origin', `plan/${ID}`);
  return { base, root, bare, baseCommit };
}

type Reply = { id: number | string | null; result: { ok: boolean; value?: any; error?: { code: string; message: string } } };
/** Scripted protocol client: spawns the installed script, sends one request at a time and awaits each reply before the next, so later requests can use earlier values. */
function client(root: string, cwd: string, evidence = EVIDENCE) {
  const child = spawn(process.execPath, [path.join(root, SKILL_DIR, 'scripts/workflow.mjs'), 'serve', '--checkout', root], { cwd, env: { ...process.env, SPECPLANE_HOST_EVIDENCE: evidence }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let stderr = ''; const replies: Reply[] = []; let wake: (() => void) | undefined; let n = 0;
  child.stderr.on('data', b => { stderr += b; });
  child.stdout.on('data', b => { buffer += b; let i; while ((i = buffer.indexOf('\n')) >= 0) { replies.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  const exited = new Promise<number | null>(resolve => child.on('close', resolve));
  const call = async (method: string, params: object): Promise<Reply['result']> => {
    const id = ++n; const want = replies.length + 1;
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    for (let i = 0; i < 1500 && replies.length < want; i++) await new Promise<void>(r => { wake = r; setTimeout(r, 20); });
    const reply = replies[want - 1]; assert.ok(reply, `no reply to ${method}; stderr: ${stderr}`); assert.equal(reply.id, id);
    return reply.result;
  };
  return { call, stderr: () => stderr, finish: async () => { child.stdin.end(); return exited; } };
}
const initiation = (root: string, selection: object = { planId: ID }) => ({ protocol: 1, workflow: 'plan-step', extensionId: 'specplane-codex', checkout: root, mode: 'attended', selection });
const TAP_SCRIPT = "require('node:assert/strict').equal(require('./src/calc.js').add(2, 3), 5); console.log('TAP version 13\\n# Subtest: calc\\n    ok 1 - add returns the sum\\n    1..1\\nok 1 - calc\\n1..1');";

/** Prepare, edit the implementation, run the real assertion through the runner, validate and record. */
async function cycle(root: string, c: ReturnType<typeof client>) {
  const prepared = await c.call('prepare', initiation(root)); assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const p = prepared.value; const before = sha256(fs.readFileSync(path.join(root, 'src/calc.js')));
  fs.writeFileSync(path.join(root, 'src/calc.js'), 'exports.add = (a, b) => a + b;\n');
  const executed = await c.call('executeTest', { requestId: p.requestId, criterionIds: [p.criteria[0].id], executable: process.execPath, args: ['-e', TAP_SCRIPT], reportFormat: 'node-tap-v13' });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  const result = { protocol: 1, requestId: p.requestId, baseDigest: p.base.digest, outcome: 'done', summary: 'implement add', changes: [{ path: 'src/calc.js', beforeDigest: before, afterDigest: sha256(fs.readFileSync(path.join(root, 'src/calc.js'))), purpose: 'implement add' }], criterionEvidence: [{ criterionId: p.criteria[0].id, assessment: 'met', rationale: 'The scripted assertion add(2, 3) === 5 ran in a child process and passed.', artifacts: [executed.value.artifact] }], gaps: [], contextExpansion: [], contributionEvents: [], openIssues: '', nextKnows: 'Nothing further.' };
  const validated = await c.call('validate', { prepared: p, result }); assert.equal(validated.ok, true, JSON.stringify(validated));
  return { prepared: p, executed: executed.value, result, validated: validated.value };
}

test('ordinary remote-backed plan step: synchronize, implement, run the real assertion, record and publish through the installed script', async () => {
  const f = consumer();
  // Another clone advances the plan branch before the session starts: preparation must fast-forward first.
  const other = path.join(f.base, 'other'); git(f.base, 'clone', '-q', '--branch', `plan/${ID}`, f.bare, other);
  put(other, 'NOTES.md', 'from another clone\n'); git(other, 'add', '.'); git(other, 'commit', '-qm', 'notes'); git(other, 'push', '-q', 'origin', `plan/${ID}`);
  const remoteHead = git(other, 'rev-parse', 'HEAD');
  const c = client(f.root, f.base);
  const run = await cycle(f.root, c);
  assert.equal(run.prepared.base.head, remoteHead, 'preparation synchronized the remote plan branch');
  assert.equal(fs.readFileSync(path.join(f.root, 'NOTES.md'), 'utf8'), 'from another clone\n');
  const recorded = await c.call('record', run.validated); assert.equal(recorded.ok, true, JSON.stringify(recorded));
  assert.equal(recorded.value.publication, 'published');
  assert.equal(recorded.value.commit, git(f.root, 'rev-parse', 'HEAD'));
  assert.equal(git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`), recorded.value.commit);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.match(fs.readFileSync(path.join(f.root, recorded.value.handoff), 'utf8'), /executed 1, failed 0, skipped 0/);
  assert.equal((await c.call('close', {})).ok, true);
  assert.equal(await c.finish(), 0, c.stderr());
});

test('a failed push keeps the local commit and reports publication failed; a retry publishes that same commit', async () => {
  const f = consumer();
  const hook = path.join(f.bare, 'hooks/pre-receive'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const c = client(f.root, f.base);
  const run = await cycle(f.root, c);
  const first = await c.call('record', run.validated); assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.publication, 'failed');
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), first.value.commit, 'the local commit is kept');
  assert.notEqual(git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`), first.value.commit);
  fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n');
  const second = await c.call('record', run.validated); assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.value.publication, 'published'); assert.equal(second.value.commit, first.value.commit);
  assert.equal(git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`), first.value.commit);
  await c.call('close', {}); await c.finish();
});

test('a diverged remote plan branch refuses preparation without merging, discarding or rewriting local work', async () => {
  const f = consumer();
  put(f.root, 'local.txt', 'local work\n'); git(f.root, 'add', 'local.txt'); git(f.root, 'commit', '-qm', 'local');
  const other = path.join(f.base, 'other'); git(f.base, 'clone', '-q', '--branch', `plan/${ID}`, f.bare, other);
  put(other, 'remote.txt', 'remote work\n'); git(other, 'add', '.'); git(other, 'commit', '-qm', 'remote'); git(other, 'push', '-q', 'origin', `plan/${ID}`);
  const head = git(f.root, 'rev-parse', 'HEAD'); const remote = git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`);
  const c = client(f.root, f.base);
  const refused = await c.call('prepare', initiation(f.root));
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.error?.code, 'PREPARATION_FAILED'); assert.match(refused.error?.message ?? '', /diverge/i);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(fs.readFileSync(path.join(f.root, 'local.txt'), 'utf8'), 'local work\n');
  assert.equal(fs.existsSync(path.join(f.root, 'remote.txt')), false);
  assert.equal(git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`), remote);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  await c.call('close', {}); await c.finish();
});

/** The installed CLI, run as a consumer would, from the skill directory alone. */
const cliOf = (root: string) => (cwd: string, ...args: string[]) => spawnSync(process.execPath, [path.join(root, SKILL_DIR, 'dist/cli.js'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' } });

test('ordinary no-plan work: read-only validation and a draft-authorized spec edit record without a plan, approval or lifecycle change', async () => {
  const f = consumer({ plan: false });
  fs.appendFileSync(path.join(f.root, '.specplane/config.yaml'), 'specs:\n  feature:\n    llm_role: draft\n');
  git(f.root, 'commit', '-qam', 'policy'); git(f.root, 'switch', '-qc', 'work/no-plan');
  git(f.root, 'push', '-qu', 'origin', 'work/no-plan');
  const head = git(f.root, 'rev-parse', 'HEAD');
  const c = client(f.root, f.base);
  const request = (workflow: string) => ({ protocol: 1, workflow, extensionId: 'specplane-codex', checkout: f.root, mode: 'attended', selection: { specIds: ['base:feature/calc'], input: 'Review the requested content' } });
  const blocked = (p: any, changes: object[] = []) => ({ protocol: 1, requestId: p.requestId, baseDigest: p.base.digest, outcome: 'blocked', summary: 'record findings', changes, criterionEvidence: p.criteria.map((k: any) => ({ criterionId: k.id, assessment: 'uncertain', rationale: 'Semantic review stays with a human.', artifacts: [] })), gaps: [], contextExpansion: [], contributionEvents: [], openIssues: 'BLOCKED: proposal only', nextKnows: 'Review the proposal.' });

  const validate = await c.call('prepare', request('validate')); assert.equal(validate.ok, true, JSON.stringify(validate));
  const vProposal = await c.call('validate', { prepared: validate.value, result: blocked(validate.value) }); assert.equal(vProposal.ok, true, JSON.stringify(vProposal));
  const vRecorded = await c.call('record', vProposal.value); assert.equal(vRecorded.ok, true, JSON.stringify(vRecorded));
  assert.equal(vRecorded.value.commit, null); assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);

  // A recorded request keeps its writer lease until the session closes, so the next workflow runs in a new session.
  await c.call('close', {}); assert.equal(await c.finish(), 0, c.stderr());
  const c2 = client(f.root, f.base);
  const assist = await c2.call('prepare', request('spec-assist')); assert.equal(assist.ok, true, JSON.stringify(assist));
  assert.equal(assist.value.scope.planId, undefined);
  const specPath = 'specs/features/calc.md'; const original = fs.readFileSync(path.join(f.root, specPath), 'utf8');
  const revised = original.replace('# Calc\n', '# Calc\n\nSums two integers.\n'); fs.writeFileSync(path.join(f.root, specPath), revised);
  const change = { path: specPath, beforeDigest: sha256(original), afterDigest: sha256(revised), purpose: 'requested body revision' };
  const aProposal = await c2.call('validate', { prepared: assist.value, result: blocked(assist.value, [change]) }); assert.equal(aProposal.ok, true, JSON.stringify(aProposal));
  const aRecorded = await c2.call('record', aProposal.value); assert.equal(aRecorded.ok, true, JSON.stringify(aRecorded));
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), aRecorded.value.commit); assert.equal(git(f.bare, 'rev-parse', 'refs/heads/work/no-plan'), aRecorded.value.commit);
  const after = fs.readFileSync(path.join(f.root, specPath), 'utf8');
  assert.match(after, /^status: approved$/m, 'approval metadata is untouched'); assert.match(after, /Sums two integers/);
  assert.equal(git(f.root, 'diff', '--name-only', `${head}..HEAD`), specPath, 'the recorded commit touches only the edited spec: no plan or lifecycle file');
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  await c2.call('close', {}); assert.equal(await c2.finish(), 0, c2.stderr());
});

test('offline docs: the installed CLI answers outside any repository, with no network, no lease and no repository writes', () => {
  const f = consumer({ plan: false }); const cli = cliOf(f.root); const outside = tmp();
  const index = cli(outside, 'docs', '--json'); assert.equal(index.status, 0, index.stderr);
  const ids = (JSON.parse(index.stdout) as { items: { topic_id: string }[] }).items.map(t => t.topic_id); assert.ok(ids.includes('completion'), ids.join());
  const topic = cli(outside, 'docs', 'completion'); assert.equal(topic.status, 0, topic.stderr); assert.match(topic.stdout, /implementation/i);
  const search = cli(outside, 'docs', 'search', 'stale', '--json'); assert.equal(search.status, 0, search.stderr);
  assert.deepEqual(fs.readdirSync(outside), [], 'docs wrote nothing into the working directory');
  const state = () => JSON.stringify([git(f.root, 'status', '--porcelain'), fs.readdirSync(path.join(f.root, '.git'), { recursive: true }).map(String).filter(n => n.startsWith('specplane-runtime')).sort()]);
  const before = state();
  assert.equal(cli(f.root, 'docs', 'completion').status, 0);
  assert.equal(state(), before, 'no lease, runtime state or working-tree change');
});

test('stale manual completion is reported as reassessment, never silently re-declared, and a clean consumer install validates without spurious drift', () => {
  const f = consumer({ plan: false }); const cli = cliOf(f.root); const spec = path.join(f.root, 'specs/features/calc.md');
  const warnings = (JSON.parse(cli(f.root, 'validate', '--json').stdout) as { warnings: { type: string; message: string }[] }).warnings.filter(w => w.type === 'freshness' && /SKILL\.md/.test(w.message) || w.type === 'skill-drift');
  assert.deepEqual(warnings, [], 'the installed package resolves its own rules template and bundled contract');
  const done = JSON.parse(cli(f.root, 'spec', 'complete', 'feature/calc', '--json').stdout);
  assert.equal(done.implementation_status, 'complete'); assert.equal(done.assessment_status, 'current');
  assert.equal(git(f.root, 'status', '--porcelain').includes('specs/features/calc.md'), true, 'a declaration stays uncommitted until the user commits it');
  git(f.root, 'commit', '-qam', 'declare complete');
  fs.appendFileSync(spec, '\n- [ ] Subtracts numbers\n'); git(f.root, 'commit', '-qam', 'new requirement');
  const shown = JSON.parse(cli(f.root, 'spec', 'show', 'feature/calc', '--json').stdout);
  assert.equal(shown.implementation_status, 'complete', 'the old declaration is preserved');
  assert.equal(shown.assessment_status, 'reassessment_needed'); assert.ok(shown.assessment_reasons.length > 0);
  const report = JSON.parse(cli(f.root, 'validate', '--json').stdout) as { warnings: { type: string }[] };
  assert.ok(report.warnings.some(w => w.type === 'implementation-reassessment'));
  const dry = JSON.parse(cli(f.root, 'spec', 'complete', 'feature/calc', '--dry-run', '--json').stdout);
  assert.equal(dry.dry_run, true); assert.equal(git(f.root, 'status', '--porcelain'), '', 'a dry run leaves the declaration alone');
});

test('scripted evidence stays unverified: the manifest and installed record claim no host, native or background capability after a full cycle', async () => {
  const f = consumer(); const c = client(f.root, f.base);
  const run = await cycle(f.root, c); const recorded = await c.call('record', run.validated); assert.equal(recorded.ok, true, JSON.stringify(recorded));
  await c.call('close', {}); await c.finish();
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, SKILL_DIR, 'specplane-extension.json'), 'utf8'));
  assert.deepEqual(manifest.hostCompatibility, []); assert.equal(manifest.capabilities.nativeCommands, false); assert.equal(manifest.capabilities.backgroundSessions, false);
  const installed = JSON.parse(fs.readFileSync(path.join(f.root, '.specplane/installed/codex.json'), 'utf8'));
  assert.equal(installed.state.enabled, 'unobserved');
  const handoff = fs.readFileSync(path.join(f.root, recorded.value.handoff), 'utf8');
  assert.doesNotMatch(handoff, /session[_ -]?id|native session/i, 'no session identity is invented for an unobserving scripted client');
});
