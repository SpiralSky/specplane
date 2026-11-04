/** Release-evidence guards: pins, skill drift, blocked Claude delivery and human-only steps stay separate. No live-host claim. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkAllPins } from '../commands/spec-pin.js';
import { runValidate } from '../commands/validate.js';
import { loadConfig } from '../config.js';
import { checkSkillDrift } from '../spec/skill-drift.js';
import { CONFIG, makeRepo, spec } from '../test-repo.js';
import { EXPECTED_CLAUDE_PENDING, releaseBlockers, releaseEvidence } from './release-evidence.js';

const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
function repoWithSkills() {
  const root = makeRepo({
    '.specplane/config.yaml': CONFIG,
    'specs/architecture/agent-skills.md': spec({ id: 'architecture/agent-skills', title: 'T', status: 'approved', author: 'user' }, '# A\n\n## Plan step\n'),
  });
  git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'c');
  const pin = git(root, 'rev-parse', '--short=7', 'HEAD:specs/architecture/agent-skills.md');
  const skill = (name: string, p: string) => {
    fs.mkdirSync(path.join(root, '.claude/skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n<!-- specplane-contract: architecture/agent-skills#plan-step@${p} -->\n# ${name}\n`);
  };
  skill('current', pin); skill('stale', 'abcdef1');
  return { root, config: loadConfig(root).config };
}

test('current spec dependency pins do not imply installed-skill conformance, and stale skill warnings stay visible without failing validation', () => {
  const { root, config } = repoWithSkills();
  assert.equal(checkAllPins(config, root).failed, false, 'spec dependency pins are current');
  const drift = checkSkillDrift(config, root);
  assert.deepEqual(drift.map(f => f.file), ['.claude/skills/stale/SKILL.md']);
  const before = fs.readFileSync(path.join(root, '.claude/skills/stale/SKILL.md'), 'utf8');
  const r = runValidate(root);
  assert.deepEqual(r.errors.filter(f => f.type === 'skill-drift'), []);
  assert.ok(r.warnings.some(f => f.type === 'skill-drift'), 'the stale skill pin remains a warning');
  assert.equal(fs.readFileSync(path.join(root, '.claude/skills/stale/SKILL.md'), 'utf8'), before, 'validate never refreshes a skill comment');
  assert.equal(releaseEvidence().skillConformance, 'not-claimed');
});

test('a matching content pin is not conformance evidence: the host rows stay pending when drift is clean', () => {
  const { root, config } = repoWithSkills();
  fs.rmSync(path.join(root, '.claude/skills/stale'), { recursive: true });
  assert.deepEqual(checkSkillDrift(config, root), []);
  const claude = releaseEvidence().hosts.find(h => h.host === 'claude')!;
  assert.deepEqual(claude.delivered, []);
  assert.equal(claude.pending.length, EXPECTED_CLAUDE_PENDING);
});

test('blocked Claude delivery and unreviewed pins are named blockers, independent of any unavailable flag', () => {
  const blockers = releaseBlockers();
  assert.ok(blockers.some(b => /^claude: 11 workflow\(s\) not delivered \(claude-delivery 01 is blocked on native host API evidence\)/.test(b)), blockers.join('\n'));
  assert.ok(blockers.some(b => /awaiting user implementation review/.test(b)));
  const e = releaseEvidence();
  const spoofed = { ...e, unavailable: true, hosts: e.hosts.map(h => ({ ...h, blocker: undefined })) } as typeof e;
  assert.ok(releaseBlockers(spoofed).some(b => b.startsWith('claude:')), 'dropping the reason or setting a generic flag does not clear the blocker');
  assert.equal(e.hosts.find(h => h.host === 'codex')!.pending.length, 0);
});

test('finish, merge and publication stay human-only and no release evidence carries hashes or a refresher', () => {
  const e = releaseEvidence();
  assert.deepEqual(e.humanOnly, ['finish', 'merge', 'publication']);
  assert.deepEqual([e.pinReview.state, e.pinReview.refreshedBy], ['awaiting-user-review', 'none']);
  assert.doesNotMatch(JSON.stringify(e), /\b[0-9a-f]{7,40}\b/, 'release evidence freezes no hash');
});
