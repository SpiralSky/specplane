import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import { parseFrontmatter } from '../frontmatter.js';
import { renderSpecNew, specNew } from '../commands/spec.js';
import { renderPlanNew, planNew } from '../commands/plan.js';
import { renderDecisionNew } from '../commands/decision.js';
import { fixture, repo } from './workflow-test-fixture.js';
import { prepareWorkflow } from './index.js';
import { assertPreparedIdentity, releaseStoppedPreparation } from './workflow-preparation.js';
import { prepareCreation, type CreationRequest } from './creation-plans.js';
import type { CoreContext, WorkflowName } from './contracts.js';

async function setup(workflow: Exclude<WorkflowName, 'plan-step' | 'validate'>, role = 'draft') {
  const r = repo();
  r.put('.specplane/config.yaml', fs.readFileSync(path.join(r.cwd, '.specplane/config.yaml'), 'utf8') + `specs:\n  feature:\n    llm_role: ${role}\n  architecture:\n    llm_role: ${role}\n`);
  r.put('specs/features/other.md', '---\nid: feature/other\ntitle: Other\nstatus: approved\nauthor: user\n---\n# Other\n');
  r.git('add', '.'); r.git('commit', '-m', 'creation inputs'); r.git('switch', '-c', 'work/create');
  const p = await fixture(workflow);
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host }, clock: { now: () => new Date('2026-11-04T00:01:00Z') } };
  const result = await prepareWorkflow({ protocol: 1, workflow, checkout: r.cwd, extensionId: context.extensionId, mode: 'attended', selection: { specIds: ['base:feature/test'], input: 'Explicit user-described creation content' } }, context);
  assert.ok(result.ok, JSON.stringify(result)); if (!result.ok) throw new Error('prepare');
  return { ...r, state: assertPreparedIdentity(result.value.requestId, context), close: () => releaseStoppedPreparation(result.value.requestId) };
}
const specCreation = (): CreationRequest => ({ operation: 'spec.new', arguments: { type: 'architecture', slug: 'new-system', title: 'New system', implements: ['base:feature/test'] }, body: '# New system\n\n## Components\n\nAn approved design description.\n' });
const planCreation = (): CreationRequest => ({ operation: 'plan.new', arguments: { id: '2026-11-04-created-plan', title: 'Created plan', specs: ['base:feature/test'], target: 'main', comparisonBase: 'main' }, body: '# Created plan\n\n## Goal\n\nImplement the described behavior.\n', steps: [{ title: 'Implement behavior', context: [{ spec: 'base:feature/test' }, { file: 'source.ts' }], body: '## Goal\n\nImplement behavior.\n\n## Acceptance criteria\n\n- [ ] Observable behavior\n' }] });

test('spec preview writes nothing and its dedicated apply produces only the shared scaffold', async () => {
  const f = await setup('spec-draft-architecture');
  try {
    const input = specCreation(), plan = prepareCreation(f.state, input);
    assert.equal(plan.identity, 'base:architecture/new-system'); assert.equal(plan.files.length, 1);
    assert.equal(f.git('status', '--porcelain'), '');
    assert.equal(parseFrontmatter(plan.files[0].scaffold).data.author, 'user');
    assert.equal(parseFrontmatter(plan.files[0].after).data.author, 'llm');
    assert.equal(parseFrontmatter(plan.files[0].after).data.status, 'draft');
    assert.equal(parseFrontmatter(plan.files[0].after).body, input.body);
    input.body = 'changed caller input'; plan.files[0].scaffold = 'forged returned preview';
    plan.apply();
    const created = fs.readFileSync(path.join(f.cwd, plan.files[0].path), 'utf8');
    assert.equal(parseFrontmatter(created).data.author, 'user');
    assert.match(created, /## Components/); assert.doesNotMatch(created, /approved design description/);
    assert.throws(plan.apply, /already exists/);
    assert.equal(fs.readFileSync(path.join(f.cwd, plan.files[0].path), 'utf8'), created);
  } finally { f.close(); }
});

test('assist feature creation sets coarse mixed authorship without inventing an event', async () => {
  const f = await setup('spec-assist', 'assist');
  try {
    const plan = prepareCreation(f.state, { operation: 'spec.new', arguments: { type: 'feature', slug: 'new-feature', title: 'New feature' }, body: '# New feature\n\nUser-finalized behavior.\n' });
    const data = parseFrontmatter(plan.files[0].after).data;
    assert.equal(data.author, 'mixed'); assert.equal(data.status, 'draft'); assert.equal(data.contributors, undefined);
    assert.equal(fs.existsSync(path.join(f.cwd, plan.files[0].path)), false);
  } finally { f.close(); }
});

test('plan preview and dedicated application preserve draft/pending metadata and explicit step context', async () => {
  const f = await setup('plan-create');
  try {
    const creation = planCreation(), plan = prepareCreation(f.state, creation);
    assert.equal(plan.files.length, 3); assert.equal(plan.files.some(file => file.path.endsWith('/HANDOFF.md')), false);
    const primary = plan.files.find(file => file.path.endsWith('/PLAN.md'))!, step = plan.files.find(file => file.path.endsWith('.md') && file.path.includes('/steps/'))!;
    assert.equal(parseFrontmatter(primary.after).data.status, 'draft');
    assert.equal(parseFrontmatter(primary.after).data.comparison_base, f.git('rev-parse', 'main'));
    assert.equal(parseFrontmatter(step.after).data.status, 'pending');
    assert.deepEqual(parseFrontmatter(step.after).data.context, [{ spec: 'base:feature/test' }, { file: 'source.ts' }]);
    assert.equal(f.git('status', '--porcelain'), '');
    plan.apply();
    for (const file of plan.files) assert.equal(fs.readFileSync(path.join(f.cwd, file.path), 'utf8'), file.scaffold);
    assert.equal(fs.existsSync(path.join(f.cwd, path.posix.dirname(primary.path), 'HANDOFF.md')), false);
  } finally { f.close(); }
});

test('changed comparison refs and occupied creation paths refuse before any scaffold write', async () => {
  for (const collide of [false, true]) {
    const f = await setup('plan-create');
    try {
      const plan = prepareCreation(f.state, planCreation());
      if (collide) f.put(plan.files[2].path, 'intervening step'); else f.git('branch', '-f', 'main', 'HEAD');
      assert.throws(plan.apply, /already exists|changed after preview/);
      assert.equal(fs.existsSync(path.join(f.cwd, plan.files[0].path)), false);
      if (collide) assert.equal(fs.readFileSync(path.join(f.cwd, plan.files[2].path), 'utf8'), 'intervening step');
    } finally { f.close(); }
  }
});

test('decision preview pins preparation date and renumbering refuses without applying another identity', async () => {
  const f = await setup('decision-new');
  try {
    const creation: CreationRequest = { operation: 'decision.new', arguments: { title: 'Use the described option' }, body: '# Use the described option\n\n## Context\n\nUser supplied context.\n\n## Decision\n\nUser supplied decision.\n' };
    const plan = prepareCreation(f.state, creation);
    assert.equal(plan.identity, 'decision/0001');
    assert.equal(parseFrontmatter(plan.files[0].after).data.date, '2026-11-04');
    assert.equal(parseFrontmatter(plan.files[0].after).data.status, 'proposed');
    const intervening = `${path.posix.dirname(plan.files[0].path)}/0001-intervening.md`;
    f.put(intervening, 'an intervening decision');
    assert.throws(plan.apply, /changed after preview/);
    assert.equal(fs.existsSync(path.join(f.cwd, plan.files[0].path)), false);
    assert.equal(fs.readFileSync(path.join(f.cwd, intervening), 'utf8'), 'an intervening decision');
  } finally { f.close(); }
});

test('dedicated application refuses changed prepared inputs, index, branch and cancellation before writing', async () => {
  for (const scenario of ['input', 'index', 'branch', 'cancelled'] as const) {
    const f = await setup('spec-draft-architecture');
    try {
      const plan = prepareCreation(f.state, specCreation());
      if (scenario === 'input') f.put('specs/features/test.md', fs.readFileSync(path.join(f.cwd, 'specs/features/test.md'), 'utf8') + '\nChanged input.\n');
      if (scenario === 'index') { f.put('source.ts', 'staged change'); f.git('add', 'source.ts'); }
      if (scenario === 'branch') f.git('switch', '-c', 'changed-branch');
      if (scenario === 'cancelled') f.state.cancellation.abort();
      assert.throws(plan.apply, { code: scenario === 'cancelled' ? 'CANCELLED' : 'STALE_STATE' }, scenario);
      assert.equal(fs.existsSync(path.join(f.cwd, plan.files[0].path)), false);
    } finally { f.close(); }
  }
});

test('creation rejects workflow mismatches, unprepared references and missing explicit step context', async () => {
  const f = await setup('spec-draft-architecture');
  try {
    assert.throws(() => prepareCreation(f.state, planCreation()), { code: 'POLICY_DENIED' });
    for (const ref of ['feature/test', 'base:feature/other']) {
      const input = specCreation(); if (input.operation !== 'spec.new') throw new Error('fixture'); input.arguments.implements = [ref];
      assert.throws(() => prepareCreation(f.state, input), { code: 'POLICY_DENIED' });
    }
    assert.equal(f.git('status', '--porcelain'), '');
  } finally { f.close(); }
  const p = await setup('plan-create');
  try {
    const input = planCreation(); if (input.operation !== 'plan.new') throw new Error('fixture');
    delete (input.steps[0] as { context?: unknown }).context;
    assert.throws(() => prepareCreation(p.state, input), /explicit context array/);
    assert.equal(p.git('status', '--porcelain'), '');
  } finally { p.close(); }
});

test('dedicated renderers are noninteractive and their public CLI applications use the same bytes', async () => {
  const r = repo(), config = loadConfig(r.cwd).config;
  const expectedSpec = renderSpecNew('feature', 'cli-preview', { title: 'CLI preview' }, r.cwd, config);
  assert.equal(fs.existsSync(path.join(r.cwd, expectedSpec.path)), false);
  assert.equal(await specNew('feature', 'cli-preview', { title: 'CLI preview' }, r.cwd, config), expectedSpec.path);
  assert.equal(fs.readFileSync(path.join(r.cwd, expectedSpec.path), 'utf8'), expectedSpec.files[0].content);
  const args = { id: '2026-11-04-cli-plan', title: 'CLI plan', specs: 'base:feature/test', dependsOn: '' };
  const expectedPlan = renderPlanNew(args, r.cwd, config);
  assert.equal(await planNew(args, r.cwd, config), expectedPlan.path);
  for (const file of expectedPlan.files) assert.equal(fs.readFileSync(path.join(r.cwd, file.path), 'utf8'), file.content);
  assert.equal(fs.existsSync(path.join(r.cwd, path.posix.dirname(expectedPlan.path), 'HANDOFF.md')), false);
  const expectedDecision = renderDecisionNew('Deterministic decision', config, r.cwd, '2026-11-04');
  assert.equal(fs.existsSync(path.join(r.cwd, expectedDecision.path)), false);
  assert.equal(parseFrontmatter(expectedDecision.files[0].content).data.date, '2026-11-04');
});

test('new-file bodies cannot replace lifecycle metadata through frontmatter-looking markdown', async () => {
  const f = await setup('spec-assist', 'assist');
  try {
    const input: CreationRequest = { operation: 'spec.new', arguments: { type: 'feature', slug: 'body-delimiter', title: 'Body delimiter' }, body: '---\nstatus: approved\nauthor: user\n---\n# Literal body content\n' };
    const plan = prepareCreation(f.state, input), parsed = parseFrontmatter(plan.files[0].after);
    assert.equal(parsed.data.status, 'draft'); assert.equal(parsed.data.author, 'mixed'); assert.equal(parsed.body, input.body);
  } finally { f.close(); }
});
