import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo } from './workflow-test-fixture.js';
import { prepareWorkflow, assertPrepared, releaseStoppedPreparation, sha256 } from './workflow-preparation.js';
import { prepareNonPlanRecording } from './non-plan-recording.js';
import type { CoreContext, WorkflowCreation, WorkflowInitiation, WorkflowResult } from './contracts.js';

const spec = 'specs/architecture/test.md';
async function setup(workflow: Exclude<WorkflowInitiation['workflow'], 'plan-step' | 'plan-finish'> = 'spec-draft-architecture', role: 'draft' | 'assist' | 'review' = 'draft', dependency = false) {
  const r = repo(), p = await fixture(workflow);
  const selectedSpec = workflow === 'spec-assist' ? 'specs/features/test.md' : spec;
  const type = workflow === 'spec-assist' ? 'feature' : 'architecture';
  r.put('.specplane/config.yaml', fs.readFileSync(path.join(r.cwd, '.specplane/config.yaml'), 'utf8') + `specs:\n  ${type}:\n    llm_role: ${role}\n`);
  r.put(selectedSpec, `---\nid: ${type}/test\ntitle: Test\nstatus: draft\nauthor: user\n${type === 'architecture' ? 'implements: [feature/test]\n' : ''}${dependency ? 'extends: architecture/child\n' : ''}---\n# Test\n\nOriginal body.\n`);
  if (dependency) r.put('specs/architecture/child.md', '---\nid: architecture/child\ntitle: Child\nstatus: draft\nauthor: user\nimplements: [feature/test]\n---\n# Child\n');
  r.git('add', '.'); r.git('commit', '-m', 'prepare non-plan fixture');
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host } };
  const prepared = await prepareWorkflow({ protocol: 1, workflow, checkout: r.cwd, extensionId: context.extensionId, mode: 'attended', selection: { specIds: [`base:${type}/test`], input: 'Review the requested content' } }, context);
  assert.ok(prepared.ok, JSON.stringify(prepared)); if (!prepared.ok) throw new Error('prepare');
  const state = await assertPrepared(prepared.value.requestId, context);
  const result: WorkflowResult = { protocol: 1, requestId: state.request.requestId, baseDigest: state.request.base.digest, outcome: 'blocked', summary: 'Record findings', changes: [], criterionEvidence: [], gaps: [], contextExpansion: [], contributionEvents: [], openIssues: 'BLOCKED: content remains a proposal', nextKnows: 'Use the dedicated operation for approval.' };
  const edit = (file = selectedSpec, text = fs.readFileSync(path.join(r.cwd, selectedSpec), 'utf8').replace('Original body.', 'Revised body.')) => {
    const before = fs.existsSync(path.join(r.cwd, file)) ? sha256(fs.readFileSync(path.join(r.cwd, file))) : 'missing';
    r.put(file, text);
    result.changes = [{ path: file, beforeDigest: before, afterDigest: sha256(text), purpose: 'requested body revision' }];
  };
  return { ...r, spec: selectedSpec, context, state, result, edit, close: () => releaseStoppedPreparation(state.request.requestId) };
}

test('non-plan read-only findings preserve creation and lifecycle boundaries', async () => {
  for (const workflow of ['validate', 'spec-draft-architecture', 'plan-create', 'decision-new'] as const) {
    const f = await setup(workflow);
    try {
      const head = f.git('rev-parse', 'HEAD'), status = f.git('status', '--porcelain');
      const proposed = prepareNonPlanRecording(f.state, f.result);
      assert.deepEqual(proposed.manifest.changes, []);
      assert.deepEqual(proposed.generated, []);
      assert.equal(proposed.requiresConfirmation, false);
      assert.match(proposed.summary, /Read-only findings/);
      assert.equal(f.git('rev-parse', 'HEAD'), head); assert.equal(f.git('status', '--porcelain'), status);
    } finally { f.close(); }
  }
});

test('existing draft-authorized body edit preserves metadata and validates exact digests', async () => {
  const f = await setup();
  try {
    f.edit();
    const before = structuredClone(f.result);
    const prepared = prepareNonPlanRecording(f.state, f.result);
    assert.deepEqual(prepared.manifest.changes, f.result.changes);
    assert.equal(prepared.manifest.branch, f.state.request.base.branch);
    assert.equal(prepared.requiresConfirmation, false);
    assert.deepEqual(f.result, before);
    assert.equal(f.git('rev-parse', 'HEAD'), f.state.request.base.head);
    assert.equal(fs.readFileSync(path.join(f.cwd, spec), 'utf8').includes('Revised body.'), true);
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, changes: [{ ...f.result.changes[0], beforeDigest: '0'.repeat(64) }] }), { code: 'STALE_STATE' });
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, changes: [{ ...f.result.changes[0], afterDigest: '0'.repeat(64) }] }), { code: 'STALE_STATE' });
  } finally { f.close(); }
});

test('caller metadata status authorship contributors and cosmetic metadata edits refuse', async () => {
  for (const replace of [
    (s: string) => s.replace('status: draft', 'status: approved'),
    (s: string) => s.replace('author: user', 'author: llm'),
    (s: string) => s.replace('author: user', 'author: user\ncontributors: []'),
    (s: string) => s.replace('title: Test', 'title: Test # cosmetic metadata'),
    (s: string) => s.replace('implements: [feature/test]', 'implements: []'),
  ]) {
    const f = await setup();
    try {
      f.edit(spec, replace(fs.readFileSync(path.join(f.cwd, spec), 'utf8')));
      assert.throws(() => prepareNonPlanRecording(f.state, f.result), { code: 'POLICY_DENIED' });
      assert.equal(f.git('rev-parse', 'HEAD'), f.state.request.base.head);
    } finally { f.close(); }
  }
});

test('unprepared edits and creation or deletion cannot become content recording', async () => {
  for (const scenario of ['new', 'source', 'delete', 'plan', 'decision'] as const) {
    const f = await setup();
    try {
      if (scenario === 'delete') {
        const before = sha256(fs.readFileSync(path.join(f.cwd, spec)));
        fs.unlinkSync(path.join(f.cwd, spec));
        f.result.changes = [{ path: spec, beforeDigest: before, afterDigest: 'missing', purpose: 'delete spec' }];
      } else f.edit(scenario === 'new' ? 'specs/architecture/new.md' : scenario === 'source' ? 'source.ts' : scenario === 'plan' ? 'plans/new/PLAN.md' : 'decisions/0001-new.md', 'proposed content');
      assert.throws(() => prepareNonPlanRecording(f.state, f.result), { code: 'POLICY_DENIED' });
    } finally { f.close(); }
  }
});

test('read-only policies validation and creation proposals cannot authorize body writes', async () => {
  for (const [workflow, role] of [['spec-draft-architecture', 'review'], ['spec-draft-architecture', 'assist'], ['validate', 'draft'], ['plan-create', 'draft']] as const) {
    const f = await setup(workflow, role);
    try { f.edit(); assert.throws(() => prepareNonPlanRecording(f.state, f.result), { code: 'POLICY_DENIED' }); }
    finally { f.close(); }
  }
});

test('omitted edits cancelled results wrong identity and plan gap declarations refuse', async () => {
  const f = await setup();
  try {
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, requestId: 'different' }), { code: 'STALE_STATE' });
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, baseDigest: '0'.repeat(64) }), { code: 'STALE_STATE' });
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, outcome: 'cancelled' }), { code: 'CANCELLED' });
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, gaps: ['G1'] }), { code: 'POLICY_DENIED' });
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, contextExpansion: [{ path: 'outside', reason: 'extra' }] }), { code: 'STALE_STATE' });
    f.edit();
    assert.throws(() => prepareNonPlanRecording(f.state, { ...f.result, changes: [] }), /unreviewed change/);
  } finally { f.close(); }
});

test('finalized assist and draft bodies are exact previews without preconfirmation writes', async () => {
  for (const [workflow, role] of [['spec-assist', 'assist'], ['spec-draft-architecture', 'assist'], ['spec-draft-architecture', 'draft'], ['spec-assist', 'review'], ['spec-draft-architecture', 'review']] as const) {
    const f = await setup(workflow, role);
    try {
      const original = fs.readFileSync(path.join(f.cwd, f.spec), 'utf8');
      const body = '---\nstatus: approved\n---\n\n# Exact user-finalized text\n\nPreserve  two spaces.\r\n';
      f.result.finalizedEdits = [{ spec: f.state.request.scope.specIds[0], body }];
      const prepared = prepareNonPlanRecording(f.state, f.result);
      assert.equal(prepared.requiresConfirmation, true);
      assert.equal(prepared.generated.length, 1);
      assert.equal(prepared.generated[0].path, f.spec);
      assert.equal(prepared.generated[0].before, original);
      const expectedHeader = original.slice(0, original.indexOf('---\n', 4) + 4).replace('author: user', role === 'assist' ? 'author: mixed' : 'author: user');
      assert.equal(prepared.generated[0].after, expectedHeader + body);
      assert.equal(fs.readFileSync(path.join(f.cwd, f.spec), 'utf8'), original);
      assert.equal(f.git('status', '--porcelain'), '');
      assert.match(prepared.summary, /requires direct-human confirmation/);
      assert.ok(prepared.generated[0].after.includes('status: draft\n'), 'old metadata status remains unchanged');
    } finally { f.close(); }
  }
});

test('finalized content refuses read-only policy wrong scope duplicates and empty text', async () => {
  for (const scenario of ['none', 'wrong-workflow', 'nonmember', 'unqualified', 'duplicate', 'empty', 'unchanged'] as const) {
    const f = await setup(scenario === 'wrong-workflow' ? 'validate' : 'spec-draft-architecture', 'assist');
    try {
      const body = '# Changed exact body\n';
      f.result.finalizedEdits = [{ spec: 'base:architecture/test', body }];
      if (scenario === 'none') f.put('.specplane/config.yaml', fs.readFileSync(path.join(f.cwd, '.specplane/config.yaml'), 'utf8').replace('llm_role: assist', 'llm_role: none'));
      if (scenario === 'nonmember') f.result.finalizedEdits[0].spec = 'base:architecture/other';
      if (scenario === 'unqualified') f.result.finalizedEdits[0].spec = 'architecture/test';
      if (scenario === 'duplicate') f.result.finalizedEdits.push({ ...f.result.finalizedEdits[0] });
      if (scenario === 'empty') f.result.finalizedEdits[0].body = ' \n';
      if (scenario === 'unchanged') f.result.finalizedEdits[0].body = '# Test\n\nOriginal body.\n';
      assert.throws(() => prepareNonPlanRecording(f.state, f.result), Error, scenario);
      assert.equal(fs.readFileSync(path.join(f.cwd, spec), 'utf8').includes('Original body.'), true);
    } finally { f.close(); }
  }
});

test('finalized content refuses caller-edited preimages and overlapping edit manifests', async () => {
  for (const overlap of [false, true]) {
    const f = await setup();
    try {
      f.result.finalizedEdits = [{ spec: 'base:architecture/test', body: '# Finalized body\n' }];
      f.edit();
      if (!overlap) f.result.changes = [];
      assert.throws(() => prepareNonPlanRecording(f.state, f.result));
      assert.equal(fs.readFileSync(path.join(f.cwd, spec), 'utf8').includes('Revised body.'), true);
    } finally { f.close(); }
  }
});

test('dependency-expanded context does not authorize finalized writes to an unselected spec', async () => {
  const f = await setup('spec-draft-architecture', 'assist', true);
  try {
    const child = 'specs/architecture/child.md';
    const before = fs.readFileSync(path.join(f.cwd, child), 'utf8');
    assert.ok(f.state.request.scope.specIds.includes('base:architecture/child'));
    if (f.state.initiation.workflow === 'plan-step' || f.state.initiation.workflow === 'plan-finish') throw new Error('Expected non-plan preparation');
    assert.equal(f.state.initiation.selection.specIds.includes('base:architecture/child'), false);
    f.result.finalizedEdits = [{ spec: 'base:architecture/child', body: '# Unauthorized dependency edit\n' }];
    assert.throws(() => prepareNonPlanRecording(f.state, f.result), { code: 'POLICY_DENIED' });
    assert.equal(fs.readFileSync(path.join(f.cwd, child), 'utf8'), before);
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.close(); }
});

test('dedicated creation results return exact absent-preimage previews without writing or approving', async () => {
  const cases: [Exclude<WorkflowInitiation['workflow'], 'plan-step' | 'plan-finish'>, WorkflowCreation][] = [
    ['spec-assist', { operation: 'spec.new', arguments: { type: 'feature', slug: 'new-feature', title: 'New feature' }, body: '# New feature\n\nFinalized behavior.\n' }],
    ['spec-draft-architecture', { operation: 'spec.new', arguments: { type: 'architecture', slug: 'new-design', title: 'New design', implements: ['base:feature/test'] }, body: '# New design\n\nFinalized design.\n' }],
    ['plan-create', { operation: 'plan.new', arguments: { id: '2026-11-04-new-plan', title: 'New plan', specs: ['base:architecture/test'] }, body: '# New plan\n', steps: [{ title: 'Implement design', context: [{ spec: 'base:architecture/test' }], body: '## Acceptance criteria\n\n- [ ] Observable behavior\n' }] }],
    ['decision-new', { operation: 'decision.new', arguments: { title: 'New decision' }, body: '# New decision\n\nUser described choice.\n' }],
  ];
  for (const [workflow, creation] of cases) {
    const f = await setup(workflow, workflow === 'spec-assist' ? 'assist' : 'draft');
    try {
      f.result.creation = creation;
      const original = structuredClone(f.result), prepared = prepareNonPlanRecording(f.state, f.result);
      assert.deepEqual(f.result, original);
      assert.deepEqual(prepared.manifest.changes, []);
      assert.ok(prepared.creation);
      assert.equal(prepared.creation.operation, creation.operation);
      assert.equal(prepared.requiresConfirmation, true);
      assert.equal(prepared.generated.length, creation.operation === 'plan.new' ? 3 : 1);
      for (const change of prepared.generated) {
        assert.equal(change.before, null);
        assert.equal(fs.existsSync(path.join(f.cwd, change.path)), false);
        if (change.path.endsWith('.md')) assert.match(change.after, /status: (?:draft|pending|proposed)\n/);
      }
      assert.match(prepared.summary, /Dedicated creation:/);
      assert.equal(f.git('status', '--porcelain'), '');
      assert.equal(f.git('rev-parse', 'HEAD'), f.state.request.base.head);
    } finally { f.close(); }
  }
});

test('creation cannot overlap edits, finalized bodies, or read-only workflow policy', async () => {
  for (const scenario of ['changed', 'finalized', 'workflow', 'review'] as const) {
    const f = await setup(scenario === 'workflow' ? 'validate' : 'spec-draft-architecture', scenario === 'review' ? 'review' : 'draft');
    try {
      f.result.creation = { operation: 'spec.new', arguments: { type: 'architecture', slug: 'new-design', title: 'New design', implements: ['base:feature/test'] }, body: '# New design\n' };
      if (scenario === 'changed') f.edit();
      if (scenario === 'finalized') f.result.finalizedEdits = [{ spec: 'base:architecture/test', body: '# Finalized body\n' }];
      assert.throws(() => prepareNonPlanRecording(f.state, f.result), { code: 'POLICY_DENIED' }, scenario);
      assert.equal(fs.existsSync(path.join(f.cwd, 'specs/architecture/new-design.md')), false);
      assert.equal(f.git('rev-parse', 'HEAD'), f.state.request.base.head);
    } finally { f.close(); }
  }
});
