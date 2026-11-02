import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeRepo } from '../test-repo.js';
import { executeOperation } from './index.js';
import { acquireWriterLease } from './writer-leases.js';

const rootFile = 'docs/specifications/features/root.md';
const childFile = 'docs/specifications/features/child.md';
const header = (id: string) => `---\nid: feature/${id}\ntitle: ${id}\nstatus: approved\nauthor: user\n`;
function fixture() {
  const root = makeRepo({ [rootFile]: header('root') + 'extends: feature/child#heading\nimplementation: {status: partial, evidence: [manual], implementation_revision: abc}\nother: keep\n---\n# Body\n', [childFile]: header('child') + 'extends: feature/grandchild\n---\n# Child\n', 'docs/specifications/features/grandchild.md': header('grandchild') + '---\n# Grandchild\n', dirty: 'unstaged\n' });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', 'dirty']);
  return root;
}
const call = (root: string, status: 'incomplete' | 'partial' | 'complete', dryRun = false) => executeOperation({ operation: 'spec.implementation', arguments: { id: 'feature/root', status, dryRun } }, { checkout: root, extensionId: 'test' });
test('core and CLI preserve evidence and body, cover statuses, dry-run and repeated complete', () => {
  const root = fixture();
  try {
    const original = fs.readFileSync(path.join(root, rootFile), 'utf8');
    const index = fs.readFileSync(path.join(root, '.git/index'));
    const preview = call(root, 'complete', true); assert.ok(preview.ok); assert.equal(preview.value.assessment_status, 'current'); assert.equal(fs.readFileSync(path.join(root, rootFile), 'utf8'), original); assert.equal(fs.existsSync(path.join(root, '.git/specplane-runtime')), false);
    const cli = spawnSync(process.execPath, [path.resolve('dist/cli.js'), 'spec', 'complete', 'feature/root', '--json'], { cwd: root, encoding: 'utf8' }); assert.equal(cli.status, 0, cli.stderr); const result = JSON.parse(cli.stdout); assert.equal(result.fingerprint, preview.value.fingerprint);
    const after = fs.readFileSync(path.join(root, rootFile), 'utf8'); assert.match(after, /evidence:\n\s+- manual/); assert.match(after, /implementation_revision: abc/); assert.ok(after.endsWith('other: keep\n---\n# Body\n')); assert.match(after, /base:feature\/child/); assert.match(after, /base:feature\/grandchild/);
    const repeated = call(root, 'complete'); assert.ok(repeated.ok); assert.equal(repeated.value.changed, false); assert.equal(fs.readFileSync(path.join(root, rootFile), 'utf8'), after);
    for (const status of ['incomplete', 'partial'] as const) { const receipt = call(root, status); assert.ok(receipt.ok); assert.equal(receipt.value.assessment_status, 'unrecorded'); assert.equal(receipt.value.fingerprint, null); assert.match(fs.readFileSync(path.join(root, rootFile), 'utf8'), /assessed_dependencies:/); }
    assert.equal(fs.readFileSync(path.join(root, 'dirty'), 'utf8'), 'unstaged\n'); assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('invalid metadata, missing closure and held checkout lease refuse without altering files', () => {
  const root = fixture();
  try {
    const file = path.join(root, rootFile), original = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(path.join(root, childFile)); assert.equal(call(root, 'complete').ok, false); assert.equal(fs.readFileSync(file, 'utf8'), original);
    fs.writeFileSync(file, original.replace('status: partial', 'status: invalid')); assert.equal(call(root, 'partial').ok, false); assert.match(fs.readFileSync(file, 'utf8'), /status: invalid/);
    fs.writeFileSync(file, original); const lease = acquireWriterLease({ checkouts: [root], requestId: 'test' });
    try { assert.equal(call(root, 'partial').ok, false); assert.equal(fs.readFileSync(file, 'utf8'), original); } finally { lease.release(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
