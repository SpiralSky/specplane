import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { runInit } from '../commands/init.js';
import { checkGuidance } from '../docs/freshness.js';
import { docsIndex } from '../docs/operations.js';
import { makeRepo } from '../test-repo.js';
import { testHooks } from './containment.transaction.js';
import { buildInstalledManifest, decideLegacy, installedManifestPath, type ObservedFile } from './rollout.js';

afterEach(() => { delete testHooks.interrupt; });

const USER_SETTINGS = JSON.stringify({ permissions: { allow: ['Bash(echo:*)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }] } }, null, 2) + '\n';
const USER_AGENTS = '# Mine\n\nrouting table stays\n';

function repo(): string {
  const root = makeRepo({ 'AGENTS.md': USER_AGENTS, '.claude/settings.json': USER_SETTINGS });
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

for (const order of [['claude', 'codex'], ['codex', 'claude']]) {
  test(`install order ${order.join(' then ')} and repeated init preserve settings, user text and the other extension`, () => {
    const root = repo();
    for (const harness of order) runInit(root, { harness });
    const settings = JSON.parse(read(root, '.claude/settings.json'));
    assert.ok(settings.permissions.allow.includes('Bash(echo:*)'), 'user permission kept');
    assert.ok(JSON.stringify(settings.hooks.PreToolUse).includes('my-own-hook.sh'), 'user hook kept');
    assert.ok(read(root, 'AGENTS.md').startsWith(USER_AGENTS), 'user text before the managed block kept');
    assert.ok(fs.existsSync(path.join(root, '.claude/skills/plan-step/SKILL.md')));
    assert.ok(fs.existsSync(path.join(root, '.agents/skills/specplane/SKILL.md')));
    for (const h of ['claude', 'codex']) assert.equal(JSON.parse(read(root, installedManifestPath(h))).harness, h);
    const first = tree(root);
    runInit(root, {});
    runInit(root, { harness: order[0] });
    assert.deepEqual(tree(root), first, 'repeated init changes nothing');
  });
}

test('both install orders produce the same shared guidance and manifests', () => {
  const a = repo(); const b = repo();
  for (const h of ['claude', 'codex']) runInit(a, { harness: h });
  for (const h of ['codex', 'claude']) runInit(b, { harness: h });
  assert.deepEqual(tree(a), tree(b));
});

test('a customized public skill is preserved, reported as a collision, and kept out of the manifest as installed', () => {
  const root = repo();
  const custom = '.claude/skills/plan-step/SKILL.md';
  fs.mkdirSync(path.dirname(path.join(root, custom)), { recursive: true });
  fs.writeFileSync(path.join(root, custom), 'my own plan-step\n');
  const lines = runInit(root, { harness: 'claude' });
  assert.equal(read(root, custom), 'my own plan-step\n');
  const line = lines.find(l => l.startsWith(`Collision ${custom}`));
  assert.ok(line?.includes('`/plan-step` stays unavailable') && line.includes('specplane init --harness claude'), line);
  const manifest = JSON.parse(read(root, installedManifestPath('claude')));
  assert.deepEqual(manifest.collisions.map((c: { path: string }) => c.path), [custom]);
  assert.equal(manifest.files.find((f: { path: string }) => f.path === custom).outcome, 'customized');
  const legacy = manifest.legacy as { command: string; action: string }[];
  assert.equal(legacy.find(l => l.command === '/plan-step')?.action, 'preserve');
  assert.ok(legacy.filter(l => l.command !== '/plan-step').every(l => l.action === 'keep'), 'no replacement is observed, so every other public skill stays');
  assert.equal(manifest.state.enabled, 'unobserved');
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/decision-new/SKILL.md')), 'other commands remain available');
});

test('legacy retirement needs an unmodified owned file and observed replacement evidence', () => {
  const file: ObservedFile = { path: '.claude/skills/validate/SKILL.md', outcome: 'installed', sha256: 'x', command: '/validate' };
  assert.equal(decideLegacy(file, undefined).action, 'keep');
  assert.equal(decideLegacy(file, { usable: true }).action, 'keep', 'evidence without a source is not evidence');
  assert.equal(decideLegacy(file, { usable: false, source: 'probe' }).action, 'keep');
  assert.equal(decideLegacy(file, { usable: true, source: 'host 1.2 probe' }).action, 'retire');
  assert.equal(decideLegacy({ ...file, outcome: 'customized' }, { usable: true, source: 'host 1.2 probe' }).action, 'preserve');
  assert.equal(buildInstalledManifest('claude', [file], { usable: true, source: 's' }).legacy[0].action, 'retire');
});

test('the installed manifest is applied last', () => {
  const root = repo();
  const manifest = path.join(root, installedManifestPath('claude'));
  let applied = 0; let lastIndex = -1; const seenBefore: boolean[] = [];
  testHooks.interrupt = (point) => {
    const m = /^after-apply:(\d+)$/.exec(point);
    if (!m) return;
    applied += 1; lastIndex = Number(m[1]);
    seenBefore.push(fs.existsSync(manifest));
  };
  runInit(root, { harness: 'claude' });
  assert.ok(applied > 3);
  assert.deepEqual(seenBefore.slice(0, -1).filter(Boolean), [], 'absent until the final replacement');
  assert.equal(seenBefore.at(-1), true);
  assert.ok(lastIndex === applied - 1);
});

test('explicit refresh stamps release identity and preserves customization; startup and docs lookup never install', () => {
  const root = repo();
  runInit(root, { harness: 'claude' });
  const customRules = '.claude/rules/specplane.md';
  fs.writeFileSync(path.join(root, customRules), 'my rules\n');
  const before = tree(root);
  docsIndex(); checkGuidance(root);
  assert.deepEqual(tree(root), before, 'lookup and checks wrote nothing');
  const lines = runInit(root, { harness: 'codex', refreshGuidance: true });
  assert.ok(lines.some(l => l.includes('AGENTS.md')));
  assert.match(read(root, 'AGENTS.md'), /specplane:begin v2 docs=\S+ contract=\d+ sha256=[0-9a-f]{64}/);
  assert.ok(read(root, 'AGENTS.md').startsWith(USER_AGENTS));
  assert.equal(read(root, customRules), 'my rules\n', 'customized guidance file preserved');
  assert.ok(fs.existsSync(path.join(root, '.agents/skills/specplane/SKILL.md')));
  runInit(root, { refreshGuidance: true });
  assert.equal(JSON.parse(read(root, installedManifestPath('claude'))).collisions[0].path, customRules, 'the manifest records the observed collision');
  const after = tree(root);
  runInit(root, { refreshGuidance: true });
  assert.deepEqual(tree(root), after, 'repeating the refresh is a no-op');
});
