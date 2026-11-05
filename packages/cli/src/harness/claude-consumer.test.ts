/** Consumer-side scripted-client tests: the installed Claude package driven as a separate project would drive it. Deterministic scripted results over the installed MCP server and CLI only; no live Claude host, session, model or plugin load is claimed, and no `claude` process is started. */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runInit } from '../commands/init.js';
import { sha256 } from '../core/workflow-preparation.js';
import { CLAUDE_EXTENSION_ID, CLAUDE_MCP_ENTRY, CLAUDE_PACKAGE_DIR } from './claude-package.js';

const ID = '2026-11-05-claude-consumer';
const STEP = `plans/${ID}/steps/01-feature.md`;
const PROCEDURE = `plans/${ID}/procedure.md`;
const NONCE = 'nonce-0123456789abcdef';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-consumer-')));
const put = (root: string, rel: string, text: string) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

/** A consumer repository that has none of this source tree: Claude package installed, a ready plan on `plan/<id>` and a bare remote. `tests` adds a testRequirements mapping to the step. */
function consumer(opts: { plan?: boolean; tests?: boolean } = {}) {
  const base = tmp(); const root = path.join(base, 'consumer'); const bare = path.join(base, 'remote.git');
  fs.mkdirSync(root); git(root, 'init', '-q', '-b', 'main'); git(base, 'init', '-q', '--bare', bare);
  put(root, '.specplane/config.yaml', 'spec_roots:\n  - name: base\n    path: specs\nplans:\n  forge: none\n  require_approved_specs: none\nexecution:\n  backend: branch\n');
  put(root, 'specs/features/calc.md', '---\nid: feature/calc\ntitle: Calc\nstatus: approved\nauthor: user\n---\n# Calc\n\n## Acceptance criteria\n\n- [ ] Adds numbers\n');
  runInit(root, { harness: 'claude' });
  put(root, 'src/calc.js', 'exports.add = (a, b) => 0;\n');
  const planText = (execution: string) => `---\nid: ${ID}\ntitle: Calc\nstatus: ready\nspecs: [base:feature/calc]\n${execution}---\n# Plan\n`;
  put(root, `plans/${ID}/PLAN.md`, planText(''));
  put(root, STEP, `---\nplan: ${ID}\nstep: 1\ntitle: Add\nstatus: pending\ncontext:\n  - file: src/calc.js\n  - file: ${PROCEDURE}\n---\n# Add\n\n## Acceptance criteria\n\n- [ ] add returns the sum\n`);
  if (opts.tests) {
    const mapping = { schemaVersion: 1, workflow: 'plan-step', criteria: [{ sourcePath: STEP, sourceDigest: sha256(fs.readFileSync(path.join(root, STEP))), criterionIndex: 1, evidence: 'test', testRequirements: [{ suiteId: 'calc', format: 'node-tap-v13' }] }] };
    put(root, PROCEDURE, '# Procedure\n\n```specplane-test-requirements\n' + JSON.stringify(mapping) + '\n```\n');
  } else put(root, PROCEDURE, '# Procedure\n\nImplement the step.\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base'); git(root, 'remote', 'add', 'origin', bare); git(root, 'push', '-q', 'origin', 'main');
  const baseCommit = git(root, 'rev-parse', 'HEAD');
  if (opts.plan === false) return { base, root, bare, baseCommit };
  git(root, 'switch', '-qc', `plan/${ID}`);
  put(root, `plans/${ID}/PLAN.md`, planText(`execution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${baseCommit}\n`));
  git(root, 'commit', '-qam', 'bind plan'); git(root, 'push', '-qu', 'origin', `plan/${ID}`);
  return { base, root, bare, baseCommit };
}

type Out = { ok: boolean; isError: boolean; value?: any; error?: { code: string; message: string }; text: string };
/** Scripted MCP client: spawns the installed server entry, binds once and awaits each tool reply before the next call. */
function client(root: string, cwd: string) {
  const child = spawn(process.execPath, [path.join(root, CLAUDE_PACKAGE_DIR, CLAUDE_MCP_ENTRY)], { cwd, env: { ...process.env, SPECPLANE_CHECKOUT: cwd }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let stderr = ''; const replies = new Map<number, any>(); let wake: (() => void) | undefined; let n = 0;
  child.stderr.on('data', b => { stderr += b; });
  child.stdout.on('data', b => { buffer += b; let i; while ((i = buffer.indexOf('\n')) >= 0) { const r = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); replies.set(r.id, r); } wake?.(); });
  const exited = new Promise<number | null>(resolve => child.on('close', resolve));
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Out> => {
    const id = ++n;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { nonce: NONCE, ...args } } }) + '\n');
    for (let i = 0; i < 1500 && !replies.has(id); i++) await new Promise<void>(r => { wake = r; setTimeout(r, 20); });
    const reply = replies.get(id); assert.ok(reply, `no reply to ${name}; stderr: ${stderr}`);
    const text = reply.result.content[0].text as string; let parsed: any = {}; try { parsed = JSON.parse(text); } catch { /* plain-text refusal */ }
    return { ok: parsed.ok === true || parsed.bound === true, isError: reply.result.isError === true, value: parsed.value ?? parsed, error: parsed.error, text };
  };
  /** Reads the whole prepared request through the bounded detail pages. */
  const detail = async (requestId: string) => { let json = ''; let offset = 0; for (;;) { const page = await call('detail', { requestId, offset }); assert.equal(page.isError, false, page.text); json += page.value.chunk; if (page.value.done) break; offset = page.value.next; } return JSON.parse(json); };
  return { call, detail, stderr: () => stderr, finish: async () => { child.stdin.end(); return exited; } };
}
const initiation = (root: string, workflow: string, selection: object) => ({ protocol: 1, workflow, extensionId: CLAUDE_EXTENSION_ID, checkout: root, mode: 'attended', selection });
const blocked = (p: any, changes: object[] = []) => ({ protocol: 1, requestId: p.requestId, baseDigest: p.base.digest, outcome: 'blocked', summary: 'record findings', changes, criterionEvidence: p.criteria.map((k: any) => ({ criterionId: k.id, assessment: 'uncertain', rationale: 'Semantic review stays with a human.', artifacts: [] })), gaps: [], contextExpansion: [], contributionEvents: [], openIssues: 'BLOCKED: proposal only', nextKnows: 'Review the proposal.' });
const leases = (root: string) => fs.readdirSync(path.join(root, '.git'), { recursive: true }).map(String).filter(n => n.startsWith('specplane-runtime') && /lease/i.test(n)).sort();

/** The installed CLI, run as a consumer would, from the package directory alone. */
const cliOf = (root: string) => (cwd: string, ...args: string[]) => spawnSync(process.execPath, [path.join(root, CLAUDE_PACKAGE_DIR, 'dist/cli.js'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' } });

test('plan step without a reviewed mapping: synchronize the remote plan branch, record a blocked result with the edit and publish through the installed server', async () => {
  const f = consumer();
  const other = path.join(f.base, 'other'); git(f.base, 'clone', '-q', '--branch', `plan/${ID}`, f.bare, other);
  put(other, 'NOTES.md', 'from another clone\n'); git(other, 'add', '.'); git(other, 'commit', '-qm', 'notes'); git(other, 'push', '-q', 'origin', `plan/${ID}`);
  const remoteHead = git(other, 'rev-parse', 'HEAD');
  const idle = leases(f.root);
  const c = client(f.root, f.root);
  assert.equal((await c.call('bind')).ok, true);
  const prepared = await c.call('prepare', initiation(f.root, 'plan-step', { planId: ID })); assert.equal(prepared.ok, true, prepared.text);
  const p = await c.detail(prepared.value.requestId);
  assert.equal(p.base.head, remoteHead, 'preparation synchronized the remote plan branch');
  const before = sha256(fs.readFileSync(path.join(f.root, 'src/calc.js')));
  fs.writeFileSync(path.join(f.root, 'src/calc.js'), 'exports.add = (a, b) => a + b;\n');
  // Without a reviewed testRequirements mapping a criterion stays uncertain, so a `done` result is refused (INVALID_EVIDENCE); mapped steps are cancelled natively (D16 C). A blocked result is the reachable outcome.
  const change = { path: 'src/calc.js', beforeDigest: before, afterDigest: sha256(fs.readFileSync(path.join(f.root, 'src/calc.js'))), purpose: 'implement add' };
  const refusedDone = await c.call('validate', { requestId: p.requestId, result: { ...blocked(p, [change]), outcome: 'done', criterionEvidence: [{ criterionId: p.criteria[0].id, assessment: 'met', rationale: 'Reviewed by the scripted client.', artifacts: [] }] } });
  assert.equal(refusedDone.error?.code, 'INVALID_EVIDENCE', refusedDone.text);
  const result = blocked(p, [change]);
  const validated = await c.call('validate', { requestId: p.requestId, result }); assert.equal(validated.ok, true, validated.text);
  const recorded = await c.call('record', validated.value); assert.equal(recorded.ok, true, recorded.text);
  assert.equal(recorded.value.publication, 'published');
  assert.equal(recorded.value.commit, git(f.root, 'rev-parse', 'HEAD'));
  assert.equal(git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`), recorded.value.commit);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal((await c.call('close')).ok, true);
  assert.equal(await c.finish(), 0, c.stderr());
  assert.deepEqual(leases(f.root), idle, 'close leaves no lease file behind');
});

test('a plan step whose criteria carry testRequirements is cancelled by the native server (D16 C): nothing is edited or recorded and no lease is left', async () => {
  const f = consumer({ tests: true }); const head = git(f.root, 'rev-parse', 'HEAD');
  const c = client(f.root, f.root); await c.call('bind');
  const refused = await c.call('prepare', initiation(f.root, 'plan-step', { planId: ID }));
  assert.equal(refused.isError, true, refused.text); assert.match(refused.text, /testRequirements/);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(git(f.root, 'status', '--porcelain'), '');
  assert.equal(await c.finish(), 0, c.stderr());
  const again = client(f.root, f.root); await again.call('bind');
  const next = await again.call('prepare', initiation(f.root, 'plan-step', { planId: ID }));
  assert.match(next.text, /testRequirements/, 'a later session is refused by D16 C, not by a stale lease');
  await again.finish();
});

test('a diverged remote plan branch refuses preparation without merging, discarding or rewriting local work', async () => {
  const f = consumer();
  put(f.root, 'local.txt', 'local work\n'); git(f.root, 'add', 'local.txt'); git(f.root, 'commit', '-qm', 'local');
  const other = path.join(f.base, 'other'); git(f.base, 'clone', '-q', '--branch', `plan/${ID}`, f.bare, other);
  put(other, 'remote.txt', 'remote work\n'); git(other, 'add', '.'); git(other, 'commit', '-qm', 'remote'); git(other, 'push', '-q', 'origin', `plan/${ID}`);
  const head = git(f.root, 'rev-parse', 'HEAD'); const remote = git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`);
  const c = client(f.root, f.root); await c.call('bind');
  const refused = await c.call('prepare', initiation(f.root, 'plan-step', { planId: ID }));
  assert.equal(refused.ok, false, refused.text); assert.equal(refused.error?.code, 'PREPARATION_FAILED'); assert.match(refused.error?.message ?? '', /diverge/i);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head); assert.equal(fs.readFileSync(path.join(f.root, 'local.txt'), 'utf8'), 'local work\n');
  assert.equal(fs.existsSync(path.join(f.root, 'remote.txt')), false); assert.equal(git(f.bare, 'rev-parse', `refs/heads/plan/${ID}`), remote);
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  await c.call('close'); await c.finish();
});

test('ordinary no-plan work: read-only validation and a draft-authorized spec edit record without a plan, approval or lifecycle change', async () => {
  const f = consumer({ plan: false });
  fs.appendFileSync(path.join(f.root, '.specplane/config.yaml'), 'specs:\n  feature:\n    llm_role: draft\n');
  git(f.root, 'commit', '-qam', 'policy'); git(f.root, 'switch', '-qc', 'work/no-plan'); git(f.root, 'push', '-qu', 'origin', 'work/no-plan');
  const head = git(f.root, 'rev-parse', 'HEAD');
  const request = (workflow: string) => initiation(f.root, workflow, { specIds: ['base:feature/calc'], input: 'Review the requested content' });
  const c = client(f.root, f.root); await c.call('bind');
  const validate = await c.call('prepare', request('spec-assist')); assert.equal(validate.ok, true, validate.text);
  const vp = await c.detail(validate.value.requestId);
  const vProposal = await c.call('validate', { requestId: vp.requestId, result: blocked(vp) }); assert.equal(vProposal.ok, true, vProposal.text);
  const vRecorded = await c.call('record', vProposal.value); assert.equal(vRecorded.ok, true, vRecorded.text);
  assert.equal(vRecorded.value.commit, null); assert.equal(git(f.root, 'rev-parse', 'HEAD'), head);
  await c.call('close'); assert.equal(await c.finish(), 0, c.stderr());
  const c2 = client(f.root, f.root); await c2.call('bind');
  const assist = await c2.call('prepare', request('spec-assist')); assert.equal(assist.ok, true, assist.text);
  const ap = await c2.detail(assist.value.requestId); assert.equal(ap.scope.planId, undefined);
  const specPath = 'specs/features/calc.md'; const original = fs.readFileSync(path.join(f.root, specPath), 'utf8');
  const revised = original.replace('# Calc\n', '# Calc\n\nSums two integers.\n'); fs.writeFileSync(path.join(f.root, specPath), revised);
  const change = { path: specPath, beforeDigest: sha256(original), afterDigest: sha256(revised), purpose: 'requested body revision' };
  const aProposal = await c2.call('validate', { requestId: ap.requestId, result: blocked(ap, [change]) }); assert.equal(aProposal.ok, true, aProposal.text);
  const aRecorded = await c2.call('record', aProposal.value); assert.equal(aRecorded.ok, true, aRecorded.text);
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), aRecorded.value.commit);
  assert.match(fs.readFileSync(path.join(f.root, specPath), 'utf8'), /^status: approved$/m, 'approval metadata is untouched');
  assert.equal(git(f.root, 'diff', '--name-only', `${head}..HEAD`), specPath, 'only the edited spec is committed: no plan or lifecycle file');
  assert.equal(git(f.root, 'status', '--porcelain'), '');
  await c2.call('close'); assert.equal(await c2.finish(), 0, c2.stderr());
});

test('offline docs: the installed CLI answers outside any repository, with no network, no lease and no repository writes', () => {
  const f = consumer({ plan: false }); const cli = cliOf(f.root); const outside = tmp();
  const index = cli(outside, 'docs', '--json'); assert.equal(index.status, 0, index.stderr);
  const ids = (JSON.parse(index.stdout) as { items: { topic_id: string }[] }).items.map(t => t.topic_id); assert.ok(ids.includes('completion'), ids.join());
  const topic = cli(outside, 'docs', 'completion'); assert.equal(topic.status, 0, topic.stderr); assert.match(topic.stdout, /implementation/i);
  assert.equal(cli(outside, 'docs', 'search', 'stale', '--json').status, 0);
  assert.deepEqual(fs.readdirSync(outside), [], 'docs wrote nothing into the working directory');
  const state = () => JSON.stringify([git(f.root, 'status', '--porcelain'), leases(f.root)]);
  const before = state(); assert.equal(cli(f.root, 'docs', 'completion').status, 0);
  assert.equal(state(), before, 'no lease, runtime state or working-tree change');
});

test('stale manual completion is reported as reassessment, never silently re-declared, and the consumer install shows no drift beyond the unresolved contract anchor', () => {
  const f = consumer({ plan: false }); const cli = cliOf(f.root); const spec = path.join(f.root, 'specs/features/calc.md');
  // Finding: the installed skills cite `architecture/agent-skills`, a spec a consumer repository does not have, so each shows an unresolved-anchor drift warning. Only that one kind is expected; any other drift is a failure.
  const drift = (JSON.parse(cli(f.root, 'validate', '--json').stdout) as { warnings: { type: string; message: string }[] }).warnings.filter(w => w.type === 'skill-drift');
  assert.deepEqual(drift.filter(w => !/`architecture\/agent-skills` does not resolve/.test(w.message)), [], 'no drift other than the unresolved contract anchor');
  const done = JSON.parse(cli(f.root, 'spec', 'complete', 'feature/calc', '--json').stdout);
  assert.equal(done.implementation_status, 'complete'); assert.equal(done.assessment_status, 'current');
  git(f.root, 'commit', '-qam', 'declare complete');
  fs.appendFileSync(spec, '\n- [ ] Subtracts numbers\n'); git(f.root, 'commit', '-qam', 'new requirement');
  const shown = JSON.parse(cli(f.root, 'spec', 'show', 'feature/calc', '--json').stdout);
  assert.equal(shown.implementation_status, 'complete', 'the old declaration is preserved');
  assert.equal(shown.assessment_status, 'reassessment_needed'); assert.ok(shown.assessment_reasons.length > 0);
  assert.ok((JSON.parse(cli(f.root, 'validate', '--json').stdout) as { warnings: { type: string }[] }).warnings.some(w => w.type === 'implementation-reassessment'));
  const dry = JSON.parse(cli(f.root, 'spec', 'complete', 'feature/calc', '--dry-run', '--json').stdout);
  assert.equal(dry.dry_run, true); assert.equal(git(f.root, 'status', '--porcelain'), '', 'a dry run leaves the declaration alone');
});

test('scripted evidence stays unverified: the manifest and installed record certify no host version, native or background capability after a full cycle', async () => {
  const f = consumer(); const c = client(f.root, f.root); await c.call('bind');
  const prepared = await c.call('prepare', initiation(f.root, 'plan-step', { planId: ID })); assert.equal(prepared.ok, true, prepared.text);
  assert.equal((await c.call('close')).ok, true); await c.finish();
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, CLAUDE_PACKAGE_DIR, 'specplane-extension.json'), 'utf8'));
  assert.deepEqual(manifest.hostCompatibility, []); assert.equal(manifest.capabilities.nativeCommands, false); assert.equal(manifest.capabilities.backgroundSessions, false);
  const installed = JSON.parse(fs.readFileSync(path.join(f.root, '.specplane/installed/claude.json'), 'utf8'));
  assert.equal(installed.state.enabled, 'unobserved');
  assert.equal(fs.existsSync(path.join(f.root, 'harnesses')), false, 'the consumer holds no copy of this source tree or its host evidence');
});
