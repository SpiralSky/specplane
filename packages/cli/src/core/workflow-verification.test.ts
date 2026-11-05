import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixture, repo, stepFile, id } from './workflow-test-fixture.js';
import { prepareWorkflow, executeWorkflowTest, validateWorkflowResult, recordWorkflow } from './index.js';
import { releaseStoppedPreparation, sha256 } from './workflow-preparation.js';
import { computeTier, globMatch, recordVerificationCheck } from './verification.js';
import { workflowStateDigest } from './workflow-execution.js';
import { DEFAULT_CONFIG } from '../config.js';
import type { CoreContext, ExecutionPort, WorkflowResult, WorkflowTestRequest } from './contracts.js';

const TAP_PASS = 'TAP version 13\n# Subtest: unit\n    ok 1 - adds\n    1..1\nok 1 - unit\n1..1\n';
const TAP_FAIL = 'TAP version 13\n# Subtest: unit\n    not ok 1 - adds\n    1..1\nnot ok 1 - unit\n1..1\n';
const TAP_EMPTY = 'TAP version 13\n# Subtest: unit\n    1..0\nok 1 - unit\n1..0\n';
const SUITES = "verification:\n  suites:\n    unit:\n      command: [node, --test]\n      format: node-tap-v13\n";
const fakePort = (output: { stdout: string; exitCode: number }): ExecutionPort => ({ execute: async () => ({ executable: '/usr/bin/node', exitCode: output.exitCode, signal: null, stdout: Buffer.from(output.stdout), stderr: Buffer.alloc(0) }) });

interface Options { config?: string; mapped?: boolean; branchConfig?: string; branchEdit?: (text: string) => string; output?: { stdout: string; exitCode: number } }
async function setup(options: Options = {}) {
  const r = repo(options.config ?? '');
  if (options.branchConfig || options.branchEdit) {
    const file = path.join(r.cwd, '.specplane/config.yaml');
    fs.writeFileSync(file, options.branchEdit ? options.branchEdit(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file, 'utf8') + options.branchConfig);
    r.git('commit', '-qam', 'change verification after start');
  }
  const mapping = { schemaVersion: 1, workflow: 'plan-step', criteria: [{ sourcePath: stepFile, sourceDigest: sha256(fs.readFileSync(path.join(r.cwd, stepFile))), criterionIndex: 1, evidence: 'test', testRequirements: [{ suiteId: 'unit', format: 'node-tap-v13' }] }] };
  const p = await fixture('plan-step', options.mapped ? '# Contract\n\n## Procedure\n\n```specplane-test-requirements\n' + JSON.stringify(mapping) + '\n```\n' : undefined);
  let output = options.output ?? { stdout: TAP_PASS, exitCode: 0 };
  const context: CoreContext = { checkout: r.cwd, extensionId: p.host.extensionId, compatibility: { manifest: p.manifest, host: p.host }, execution: { execute: args => fakePort(output).execute(args) } };
  const prepared = await prepareWorkflow({ protocol: 1, workflow: 'plan-step', extensionId: context.extensionId, checkout: r.cwd, mode: 'attended', selection: { planId: id } }, context);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) throw new Error('prepare failed');
  const value = prepared.value;
  /** A step-level run of the configured suite. */
  const run = (override: Partial<WorkflowTestRequest> = {}, next?: { stdout: string; exitCode: number }) => {
    if (next) output = next;
    return executeWorkflowTest({ requestId: value.requestId, criterionIds: [], suiteId: 'unit', executable: 'node', args: ['--test'], reportFormat: 'node-tap-v13', ...override } as WorkflowTestRequest, context);
  };
  /** Creates the files and returns a result whose edit set is exactly them. */
  const result = (files: string[], overrides: Partial<WorkflowResult> = {}): WorkflowResult => {
    for (const file of files) r.put(file, `content of ${file}\n`);
    return {
      protocol: 1, requestId: value.requestId, baseDigest: value.base.digest, outcome: 'done', summary: 'change things',
      changes: files.map(file => ({ path: file, beforeDigest: 'missing' as const, afterDigest: sha256(fs.readFileSync(path.join(r.cwd, file))), purpose: 'edit' })),
      criterionEvidence: value.criteria.map(c => ({ criterionId: c.id, assessment: 'met' as const, rationale: 'Read the file against the criterion', artifacts: files.length ? [{ path: files[0], digest: sha256(fs.readFileSync(path.join(r.cwd, files[0]))), kind: 'file' as const }] : [] })),
      gaps: [], contextExpansion: [], contributionEvents: [], openIssues: '', nextKnows: '', ...overrides,
    };
  };
  const validate = (res: WorkflowResult) => validateWorkflowResult(value, res, context);
  return { ...r, p, context, prepared: value, notices: prepared.notices, run, result, validate, close: () => releaseStoppedPreparation(value.requestId) };
}
function refused(outcome: Awaited<ReturnType<typeof validateWorkflowResult>>, pattern: RegExp, code = 'INVALID_EVIDENCE') {
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  if (!outcome.ok) { assert.equal(outcome.error.code, code); assert.match(outcome.error.message, pattern); }
}
async function recordedHandoff(f: Awaited<ReturnType<typeof setup>>, res: WorkflowResult): Promise<string> {
  const proposal = await f.validate(res);
  assert.equal(proposal.ok, true, JSON.stringify(proposal));
  if (!proposal.ok) throw new Error('validate failed');
  const recorded = await recordWorkflow(proposal.value, f.context);
  assert.equal(recorded.ok, true, JSON.stringify(recorded));
  if (!recorded.ok || !('handoff' in recorded.value)) throw new Error('record failed');
  return fs.readFileSync(path.join(f.cwd, recorded.value.handoff), 'utf8');
}

test('glob matcher: segments, double star, dotfiles, braces and classes', () => {
  assert.ok(globMatch('**/*.md', 'README.md'));
  assert.ok(globMatch('**/*.md', 'a/b/c.md'));
  assert.ok(globMatch('**/*.md', '.github/notes.md'));
  assert.ok(!globMatch('*.md', 'a/b.md'));
  assert.ok(globMatch('docs/**', 'docs/a/b.txt'));
  assert.ok(!globMatch('docs/**', 'documents/a.txt'));
  assert.ok(globMatch('.claude/**', '.claude/rules/x.md'));
  assert.ok(globMatch('**/SKILL.md', 'SKILL.md'));
  assert.ok(globMatch('**/SKILL.md', 'skills/x/SKILL.md'));
  assert.ok(!globMatch('AGENTS.md', 'sub/AGENTS.md'));
  assert.ok(globMatch('src/*.{ts,js}', 'src/a.js'));
  assert.ok(!globMatch('src/*.{ts,js}', 'src/a.py'));
  assert.ok(globMatch('file?.txt', 'file1.txt'));
  assert.ok(globMatch('f[ab].txt', 'fb.txt'));
  assert.ok(!globMatch('a.b', 'aXb'));
});

test('tier: risk beats text, spec roots are risky, text needs every path, standard otherwise', () => {
  const settings = DEFAULT_CONFIG.verification;
  const roots = [{ path: 'specs' }];
  assert.equal(computeTier(['README.md', 'docs/a.txt'], settings, roots), 'text');
  assert.equal(computeTier(['README.md', 'src/a.ts'], settings, roots), 'standard');
  assert.equal(computeTier(['src/a.ts', '.claude/rules/x.md'], settings, roots), 'risk');
  assert.equal(computeTier(['.claude/rules/x.md'], settings, roots), 'risk', 'a file matching both text_paths and risk_paths is risky');
  assert.equal(computeTier(['specs/features/a.md'], settings, roots), 'risk');
  assert.equal(computeTier(['specs/features/a.md'], { ...settings, risk_paths: [] }, []), 'text');
  assert.equal(computeTier(['./AGENTS.md'], settings, roots), 'risk');
  assert.equal(computeTier([], settings, roots), 'text');
});

test('an unmapped criterion can be met with file evidence and is labelled self-assessed', async () => {
  const f = await setup();
  try {
    const notice = f.notices.find(n => n.code === 'UNCERTAIN_TEST_MAPPING');
    assert.ok(notice);
    assert.match(notice.message, /self-assessed/);
    assert.equal(f.prepared.criteria[0].testRequirements.length, 0);
    const handoff = await recordedHandoff(f, f.result(['src/new.ts']));
    assert.match(handoff, /Verification: tier standard; criteria: \S+ inspection by self; suites: none \(no tests configured\); self-assessed\./);
    assert.match(handoff, /\(self-assessed; no reviewed mapping\)/);
  } finally { f.close(); }
});

test('an unmapped criterion still needs file evidence to be met', async () => {
  const f = await setup();
  try {
    const res = f.result(['src/new.ts']);
    res.criterionEvidence[0].artifacts = [];
    refused(await f.validate(res), /file evidence/);
  } finally { f.close(); }
});

test('a failing, empty or missing suite blocks done; a passing fresh run allows it', async () => {
  const f = await setup({ config: SUITES });
  try {
    const res = f.result(['src/new.ts']);
    refused(await f.validate(res), /Missing verification check: .*suite unit.*no run recorded/);
    const failed = await f.run({}, { stdout: TAP_FAIL, exitCode: 1 });
    assert.equal(failed.ok, true, JSON.stringify(failed));
    refused(await f.validate(res), /suite unit.*(failures|did not exit successfully)/);
    const empty = await f.run({}, { stdout: TAP_EMPTY, exitCode: 0 });
    assert.equal(empty.ok, true, JSON.stringify(empty));
    refused(await f.validate(res), /suite unit.*(executed no tests|failures|did not exit)/);
    const passed = await f.run({}, { stdout: TAP_PASS, exitCode: 0 });
    assert.equal(passed.ok, true, JSON.stringify(passed));
    if (!passed.ok) return;
    const handoff = await recordedHandoff(f, res);
    assert.match(handoff, /suites: unit \(execution /);
    assert.ok(handoff.includes(passed.value.executionId));
    // The ledger and the receipt record the suite and the command.
    const dir = path.join(f.cwd, '.git/specplane-runtime/workflows', f.prepared.requestId);
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, `${passed.value.executionId}.ledger.json`), 'utf8'));
    assert.equal(ledger.suiteId, 'unit');
    assert.deepEqual(ledger.command, ['node', '--test']);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'evidence', passed.value.artifact.path), 'utf8'));
    assert.equal(receipt.suiteId, 'unit');
  } finally { f.close(); }
});

test('a stale step-level receipt does not count after a further edit', async () => {
  const f = await setup({ config: SUITES });
  try {
    assert.equal((await f.run()).ok, true);
    const res = f.result(['src/new.ts']);
    refused(await f.validate(res), /suite unit.*(state|changed)/);
  } finally { f.close(); }
});

test('step-level requests: an unknown suite, a different command or format, and empty criteria without a suite are refused', async () => {
  const f = await setup({ config: SUITES });
  try {
    for (const [override, pattern] of [
      [{ suiteId: 'other' }, /Unknown verification suite/],
      [{ executable: 'bash' }, /Command differs/],
      [{ args: ['--test', '--extra'] }, /Command differs/],
      [{ args: [] }, /Command differs/],
      [{ reportFormat: 'junit-xml' }, /Report format differs/],
      [{ suiteId: undefined }, /criterionIds may be empty only for a step-level run/],
    ] as [Partial<WorkflowTestRequest>, RegExp][]) {
      const outcome = await f.run(override);
      assert.equal(outcome.ok, false, JSON.stringify(override));
      if (!outcome.ok) { assert.equal(outcome.error.code, 'INVALID_EVIDENCE'); assert.match(outcome.error.message, pattern); }
    }
    assert.equal((await f.run()).ok, true);
  } finally { f.close(); }
});

test('text-only changes need no suite even when suites are configured', async () => {
  const f = await setup({ config: SUITES });
  try {
    const handoff = await recordedHandoff(f, f.result(['notes/a.md']));
    assert.match(handoff, /Verification: tier text; .*suites: none required \(text-only change\); self-assessed\./);
  } finally { f.close(); }
});

test('a risky path needs a separate or human check and beats a matching text path', async () => {
  const f = await setup();
  try {
    // `.claude/x.md` matches both text_paths and risk_paths.
    const res = f.result(['.claude/x.md']);
    refused(await f.validate(res), /Missing verification check: separate or human/);
    // Core, not the result, supplies the check. Stage 3 records it after validating a review artifact.
    recordVerificationCheck(f.prepared.requestId, 'separate', workflowStateDigest(f.cwd));
    const handoff = await recordedHandoff(f, res);
    assert.match(handoff, /Verification: tier risk; .* by separate; .*checked by separate\./);
    assert.doesNotMatch(handoff, /self-assessed\.$/m);
  } finally { f.close(); }
});

test('a check bound to an earlier state does not satisfy a risky change', async () => {
  const f = await setup();
  try {
    recordVerificationCheck(f.prepared.requestId, 'separate', '0'.repeat(64));
    refused(await f.validate(f.result(['.claude/x.md'])), /Missing verification check: separate or human/);
  } finally { f.close(); }
});

test('a blocked result needs no minimum', async () => {
  const f = await setup({ config: SUITES });
  try {
    const res = f.result(['.claude/x.md'], { outcome: 'blocked', openIssues: 'BLOCKED: cannot finish the review', criterionEvidence: [] });
    res.criterionEvidence = f.prepared.criteria.map(c => ({ criterionId: c.id, assessment: 'unmet' as const, rationale: 'Not done yet', artifacts: [] }));
    const proposal = await f.validate(res);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
  } finally { f.close(); }
});

test('a verification block changed after the plan started needs a human check', async () => {
  const f = await setup({ branchConfig: 'verification:\n  text_paths: ["**/*.md", "**/*.ts"]\n' });
  try {
    // The start-base rules still apply: .ts is standard, yet the changed block demands a human.
    const res = f.result(['src/new.ts']);
    refused(await f.validate(res), /Missing verification check: human.*settings changed after the plan started/);
    recordVerificationCheck(f.prepared.requestId, 'separate', workflowStateDigest(f.cwd));
    refused(await f.validate(res), /Missing verification check: human/);
    recordVerificationCheck(f.prepared.requestId, 'human', workflowStateDigest(f.cwd));
    assert.equal((await f.validate(res)).ok, true);
  } finally { f.close(); }
});

test('the committed start-base block governs, not the one at HEAD', async () => {
  const f = await setup({ config: SUITES, branchEdit: text => text.replace('command: [node, --test]', 'command: [node, --other]') });
  try {
    // The suite command comes from the start base, so the edited HEAD command is refused and the original runs.
    const edited = await f.run({ args: ['--other'] });
    assert.equal(edited.ok, false);
    assert.equal((await f.run()).ok, true);
    assert.ok(f.prepared.base.inputDigests['policy://verification']);
  } finally { f.close(); }
});

test('requestedTier may raise the minimum and a lower value is refused', async () => {
  const f = await setup({ config: SUITES });
  try {
    const text = f.result(['notes/a.md']);
    refused(await f.validate({ ...text, requestedTier: 'standard' }), /Missing verification check: .*suite unit/);
    refused(await f.validate({ ...text, requestedTier: 'risk' }), /Missing verification check: .*suite unit/);
    assert.equal((await f.run()).ok, true);
    refused(await f.validate({ ...text, requestedTier: 'risk' }), /Missing verification check: separate or human/);
    assert.equal((await f.validate({ ...text, requestedTier: 'standard' })).ok, true);
    assert.equal((await f.validate({ ...text, requestedTier: 'text' })).ok, true);
  } finally { f.close(); }
  const risky = await setup({ config: SUITES });
  try {
    const res = risky.result(['.claude/x.md']);
    refused(await risky.validate({ ...res, requestedTier: 'text' }), /below the computed tier risk/);
    refused(await risky.validate({ ...res, requestedTier: 'standard' }), /below the computed tier risk/);
  } finally { risky.close(); }
  const code = await setup({ config: SUITES });
  try {
    refused(await code.validate({ ...code.result(['src/new.ts']), requestedTier: 'text' }), /below the computed tier standard/);
  } finally { code.close(); }
});

test('manual mode sets no minimum', async () => {
  const f = await setup({ config: SUITES + '  mode: manual\n' });
  try {
    const handoff = await recordedHandoff(f, f.result(['.claude/x.md']));
    assert.match(handoff, /Verification: manual mode, no minimum; .*suites: none required \(mode manual\); self-assessed\./);
  } finally { f.close(); }
});

test('manual mode still needs a core receipt for a mapped test criterion', async () => {
  const f = await setup({ config: SUITES + '  mode: manual\n', mapped: true });
  try {
    assert.equal(f.prepared.criteria[0].testRequirements.length, 1);
    refused(await f.validate(f.result(['src/new.ts'])), /Met test criterion requires core execution evidence/);
  } finally { f.close(); }
});
