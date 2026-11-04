import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { findBlock, upsertBlock } from '../agents/standing.js';
import { checkFreshness } from '../commands/validate.js';
import { claude } from '../harness/claude.js';
import { templatesDir } from '../harness/index.js';
import { checkGuidance, refreshGuidance, releaseIdentity } from './freshness.js';

const registry = [claude];
const rules = '.claude/rules/specplane.md';
function repo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-fresh-'));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function snapshot(root: string): string {
  const out: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else out.push(`${path.relative(root, p)}:${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`);
  } };
  walk(root);
  return out.join('\n');
}
const state = (root: string, file: string) => checkGuidance(root, { registry }).find(a => a.path === file)!;

test('check reports missing owned guidance without writing', () => repo(root => {
  fs.mkdirSync(path.join(root, '.claude'));
  const before = snapshot(root);
  const assets = checkGuidance(root, { registry });
  assert.deepEqual(assets.map(a => [a.path, a.state]), [['AGENTS.md', 'missing'], [rules, 'missing']]);
  assert.equal(snapshot(root), before);
}));

test('check reports stale release identity, edited block and stale harness file by version and hash', () => repo(root => {
  fs.mkdirSync(path.join(root, '.claude/rules'), { recursive: true });
  const release = releaseIdentity();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), upsertBlock('# Mine\n', claude.workflowsLine, release).content);
  fs.copyFileSync(path.join(templatesDir('claude'), 'rules/specplane.md'), path.join(root, rules));
  assert.deepEqual(checkGuidance(root, { registry }).map(a => a.state), ['current', 'current']);

  const agents = path.join(root, 'AGENTS.md');
  const original = fs.readFileSync(agents, 'utf8');
  fs.writeFileSync(agents, original.replace(`docs=${release.docs}`, 'docs=0.0.9'));
  assert.match(state(root, 'AGENTS.md').reasons.join(), /docs version 0\.0\.9 is not the released/);
  fs.writeFileSync(agents, original.replace(`contract=${release.contract}`, 'contract=0'));
  assert.match(state(root, 'AGENTS.md').reasons.join(), /contract version 0 is not the released/);
  // Text edited inside the block: recorded hash no longer describes it.
  fs.writeFileSync(agents, original.replace('one step at a time', 'many steps'));
  const edited = state(root, 'AGENTS.md');
  assert.equal(edited.state, 'stale');
  assert.match(edited.reasons.join(), /differs from the released text/);
  assert.match(edited.reasons.join(), /recorded hash/);
  fs.writeFileSync(agents, original);

  fs.appendFileSync(path.join(root, rules), 'local note\n');
  const harness = state(root, rules);
  assert.equal(harness.state, 'stale');
  assert.match(harness.reasons[0], /sha256 [a-f0-9]{64} differs from released [a-f0-9]{64}/);
}));

test('validate flags a stale embedded release identity as a freshness warning, never repairing it', () => repo(root => {
  fs.mkdirSync(path.join(root, '.claude'));
  const stale = upsertBlock(null, claude.workflowsLine, releaseIdentity()).content.replace(/docs=\S+/, 'docs=0.0.1');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), stale);
  const before = snapshot(root);
  const report = checkFreshness(root, registry);
  assert.ok(report.warnings.some(f => f.file === 'AGENTS.md'));
  assert.equal(snapshot(root), before);
}));

test('refresh rewrites only the managed block and preserves surrounding and customised content', () => repo(root => {
  fs.mkdirSync(path.join(root, '.claude/rules'), { recursive: true });
  const agents = path.join(root, 'AGENTS.md');
  const old = upsertBlock('# Mine\n\nrouting table\n', claude.workflowsLine).content.replace('one step at a time', 'many steps');
  fs.writeFileSync(agents, old + '\nafter block\n');
  fs.writeFileSync(path.join(root, rules), 'my custom rules\n');

  const dry = refreshGuidance(root, { registry, dryRun: true });
  assert.equal(fs.readFileSync(agents, 'utf8'), old + '\nafter block\n');
  assert.deepEqual(dry.map(e => [e.path, e.action]), [['AGENTS.md', 'updated'], [rules, 'preserved']]);

  refreshGuidance(root, { registry });
  const text = fs.readFileSync(agents, 'utf8');
  assert.ok(text.startsWith('# Mine\n\nrouting table\n'));
  assert.ok(text.endsWith('\nafter block\n'));
  assert.equal(fs.readFileSync(path.join(root, rules), 'utf8'), 'my custom rules\n');
  assert.equal(state(root, 'AGENTS.md').state, 'current');
  const info = findBlock(text);
  assert.ok(info && info !== 'malformed' && info.meta?.docs === releaseIdentity().docs);
  assert.deepEqual(refreshGuidance(root, { registry }).map(e => e.action), ['unchanged', 'preserved']);
}));

test('refresh creates missing guidance, replaces only recognised earlier releases, and keeps malformed blocks', () => repo(root => {
  fs.mkdirSync(path.join(root, '.claude'));
  assert.deepEqual(refreshGuidance(root, { registry }).map(e => [e.path, e.action]), [['AGENTS.md', 'created'], [rules, 'created']]);
  const file = path.join(root, rules);
  assert.equal(state(root, rules).state, 'current');

  fs.writeFileSync(file, 'previous release\n');
  const digest = createHash('sha256').update('previous release\n').digest('hex');
  assert.equal(refreshGuidance(root, { registry, recognized: { [rules]: [digest] } })[1].action, 'updated');
  assert.equal(state(root, rules).state, 'current');

  const agents = path.join(root, 'AGENTS.md');
  fs.writeFileSync(agents, '<!-- specplane:begin v1 — x -->\nhand text\n');
  assert.equal(refreshGuidance(root, { registry })[0].action, 'preserved');
  assert.equal(fs.readFileSync(agents, 'utf8'), '<!-- specplane:begin v1 — x -->\nhand text\n');
}));

test('refresh refuses a damaged bundle and an escaping destination before writing anything', () => repo(root => {
  fs.mkdirSync(path.join(root, '.claude'));
  assert.throws(() => refreshGuidance(root, { registry, bundleDirectory: path.join(root, 'no-bundle') }), /Invalid documentation bundle/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-out-'));
  try {
    fs.symlinkSync(path.join(outside, 'target.md'), path.join(root, 'AGENTS.md'));
    assert.throws(() => refreshGuidance(root, { registry }), /symlink refused/);
    assert.equal(fs.existsSync(path.join(outside, 'target.md')), false);
    assert.equal(fs.existsSync(path.join(root, rules)), false);
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
}));

test('plain init rewrites keep a matching embedded identity', () => {
  const refreshed = upsertBlock(null, claude.workflowsLine, releaseIdentity()).content;
  assert.equal(upsertBlock(refreshed, claude.workflowsLine).action, 'unchanged');
});

test('generated authorship guidance follows the corrected contract', () => {
  const text = upsertBlock(null).content;
  assert.match(text, /`none` = read and implement only, with no spec-body edits, review, or suggestions/);
  assert.doesNotMatch(text, /decline and say why/);
});
