import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { coreInfo } from '../core/build-info.js';
import { validateCompatibility, type ExtensionManifest } from '../core/compatibility.js';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { CODEX_SKILL } from './codex.js';

const SKILL_DIR = path.posix.dirname(CODEX_SKILL);
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.invalid' } }).trim();
const host = (root: string, workflow = 'plan-step') => ({ packageRoot: fs.realpathSync(path.join(root, SKILL_DIR)), extensionId: 'specplane-codex', host: 'codex', surface: 'cli', workflow, probes: { nativeCommands: true, backgroundSessions: true } });
const manifestOf = (root: string) => JSON.parse(fs.readFileSync(path.join(root, SKILL_DIR, 'specplane-extension.json'), 'utf8')) as ExtensionManifest;

test('codex init delivers a self-contained package that validates without this repository and keeps capability flags false', async () => {
  const root = makeRepo({});
  runInit(root, { harness: 'codex' });
  const dir = path.join(root, SKILL_DIR);
  for (const rel of ['SKILL.md', 'scripts/workflow.mjs', 'references/shared-procedure.md', 'dist/core/index.js', 'dist/core/workflow-runner.js', 'docs/manifest.json', 'docs/orientation.md', 'core/inventory.json', 'specplane-extension.json', 'package.json', 'node_modules/ajv/package.json']) assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  assert.equal(fs.existsSync(path.join(dir, 'dist/templates/claude')), false);
  assert.ok(fs.existsSync(path.join(dir, 'dist/templates/codex/contracts/codex-integration.md')), 'the installed CLI resolves its bundled contract and rules template without this repository');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'dist')).filter(n => n.endsWith('.test.js')), []);
  const manifest = manifestOf(root);
  assert.deepEqual(manifest.capabilities, { reasoning: true, nativeCommands: false, backgroundSessions: false });
  assert.deepEqual(manifest.hostCompatibility, []);
  for (const workflow of ['plan-step', 'plan-create', 'spec-assist', 'spec-draft-architecture', 'decision-new', 'validate']) {
    const result = await validateCompatibility(manifest, host(root, workflow), coreInfo);
    assert.equal(result.ok, true, `${workflow}: ${JSON.stringify(result)}`);
    // Probes claim native/background support, but no host evidence certifies it.
    if (result.ok) assert.deepEqual(result.value, { reasoning: true, nativeCommands: false, backgroundSessions: false });
  }
  const bytes = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  assert.match(bytes, /scripts\/workflow\.mjs/);
  assert.match(bytes, /Manual CLI fallback/);
  assert.match(fs.readFileSync(path.join(dir, 'references/shared-procedure.md'), 'utf8'), /^<!-- specplane-orientation: /);
});

test('installed manifest is applied last and install is idempotent; a tampered runtime file is refused', async () => {
  const root = makeRepo({});
  const first = runInit(root, { harness: 'codex' });
  assert.ok(first.some(line => line === `Created ${CODEX_SKILL}`));
  assert.ok(first.some(line => /^Codex workflow runner package: \d+ files \(\d+ added, 0 updated, 0 current, 0 preserved\)/.test(line)));
  const installed = JSON.parse(fs.readFileSync(path.join(root, '.specplane/installed/codex.json'), 'utf8')) as { files: { path: string }[]; state: { enabled: string } };
  assert.equal(installed.state.enabled, 'unobserved');
  assert.deepEqual(installed.files.map(f => f.path.replace(`${SKILL_DIR}/`, '')).sort(), ['SKILL.md', 'core/inventory.json', 'references/shared-procedure.md', 'scripts/workflow.mjs', 'specplane-extension.json']);
  const second = runInit(root, { harness: 'codex' });
  assert.ok(second.every(line => !line.startsWith('Created') && !line.startsWith('Updated')), second.join('\n'));
  assert.ok(second.some(line => /\(0 added, 0 updated, \d+ current, 0 preserved\)/.test(line)));
  fs.appendFileSync(path.join(root, SKILL_DIR, 'dist/core/index.js'), '// tampered\n');
  const result = await validateCompatibility(manifestOf(root), host(root), coreInfo);
  assert.equal(result.ok, false);
});

test('a customized package file is preserved, named as a collision, and makes the runner fail closed', async () => {
  const root = makeRepo({ [`${SKILL_DIR}/scripts/workflow.mjs`]: '// mine\n' });
  fs.mkdirSync(path.join(root, SKILL_DIR), { recursive: true });
  const lines = runInit(root, { harness: 'codex' });
  assert.equal(fs.readFileSync(path.join(root, SKILL_DIR, 'scripts/workflow.mjs'), 'utf8'), '// mine\n');
  assert.ok(lines.some(line => line.startsWith(`Collision ${SKILL_DIR}/scripts/workflow.mjs`)));
  assert.ok(lines.some(line => /refuse preparation/.test(line)));
  assert.equal((await validateCompatibility(manifestOf(root), host(root), coreInfo)).ok, false);
});

type Reply = { id: number; result: { ok: boolean; error?: { code: string; message: string } } };
/** Runs the installed script as a persistent process: one request at a time, each awaited before the next. */
async function converse(root: string, cwd: string, evidence: string, requests: object[]): Promise<{ replies: Reply[]; status: number | null; stderr: string }> {
  const child = spawn(process.execPath, [path.join(root, SKILL_DIR, 'scripts/workflow.mjs'), 'serve', '--checkout', root], { cwd, env: { ...process.env, SPECPLANE_HOST_EVIDENCE: evidence }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; let buffer = ''; const replies: Reply[] = []; let wake: (() => void) | undefined;
  child.stderr.on('data', b => { stderr += b; });
  child.stdout.on('data', b => { buffer += b; let i; while ((i = buffer.indexOf('\n')) >= 0) { replies.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  const status = new Promise<number | null>(resolve => child.on('close', resolve));
  for (const request of requests) {
    const want = replies.length + 1;
    child.stdin.write(JSON.stringify(request) + '\n');
    for (let i = 0; i < 500 && replies.length < want; i++) await new Promise<void>(r => { wake = r; setTimeout(r, 20); });
  }
  child.stdin.end();
  return { replies, status: await status, stderr };
}
const prepare = { id: 1, method: 'prepare', params: { protocol: 1, workflow: 'plan-step', extensionId: 'specplane-codex', mode: 'attended', selection: { planId: '2026-01-01-absent' } } };
const consumer = () => {
  const tmp = makeRepo({});
  const root = path.join(tmp, 'consumer');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  runInit(root, { harness: 'codex' });
  return { tmp, root };
};

test('the installed script serves NDJSON from the skill directory alone; without host evidence preparation is refused as incompatible, and close ends the process', async () => {
  const { tmp, root } = consumer();
  const run = await converse(root, tmp, '', [{ ...prepare, params: { ...prepare.params, checkout: root } }, { id: 2, method: 'close', params: {} }]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.replies.length, 2, JSON.stringify(run));
  assert.equal(run.replies[0].result.ok, false);
  assert.equal(run.replies[0].result.error?.code, 'INCOMPATIBLE', JSON.stringify(run.replies[0]));
  assert.equal(run.replies[1].result.ok, true);
});

test('the installed script gets past compatibility when host evidence is supplied', async () => {
  const { tmp, root } = consumer();
  const evidence = JSON.stringify({ surface: 'cli', probes: { nativeCommands: false, backgroundSessions: false } });
  const run = await converse(root, tmp, evidence, [{ ...prepare, params: { ...prepare.params, checkout: root } }, { id: 2, method: 'close', params: {} }]);
  assert.equal(run.status, 0, run.stderr);
  assert.notEqual(run.replies[0].result.error?.code, 'INCOMPATIBLE', JSON.stringify(run.replies[0]));
  assert.equal(run.replies[0].result.ok, false, 'the plan does not exist, so preparation still refuses');
});

test('the packaged reference documents manual fallback, recording manifest, unknown identity and offline docs', () => {
  const root = makeRepo({});
  runInit(root, { harness: 'codex' });
  const text = fs.readFileSync(path.join(root, SKILL_DIR, 'references/shared-procedure.md'), 'utf8');
  assert.match(text, /Manual CLI fallback/);
  assert.match(text, /--recording-set FILE/);
  assert.match(text, /beforeDigest,afterDigest,purpose/);
  assert.match(text, /unknown/);
  assert.match(text, /docs\/orientation\.md/);
  assert.match(text, /nativeCommands: false/);
  assert.doesNotMatch(text, /packages\/cli|harnesses\//);
});
