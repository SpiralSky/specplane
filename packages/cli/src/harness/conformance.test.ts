/** Cross-package acceptance matrix. Checks deterministic traceability and parity from built artifacts; it asserts nothing about live Claude/Codex hosts or native macOS/Windows. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { CODEX_SKILL } from './codex.js';
import { CODEX_WORKFLOWS } from './codex-package.js';
import { CLAUDE_WORKFLOWS, CODEX_WORKFLOWS_DELIVERED, CRITERIA, EXPORT_SUITES, hostRows } from './conformance-matrix.js';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliJs = path.join(dist, 'cli.js');
const suiteText = (file: string) => fs.readFileSync(path.join(dist, `${file}.test.js`), 'utf8');
const SKILL_DIR = path.posix.dirname(CODEX_SKILL);
const cli = (js: string, cwd: string, ...args: string[]) => spawnSync(process.execPath, [js, ...args], { cwd, encoding: 'utf8' });

test('every named suite exists in the built artifacts and contains the named test', () => {
  for (const c of CRITERIA) for (const s of c.suites) {
    assert.ok(fs.existsSync(path.join(dist, `${s.file}.test.js`)), `${c.id}: missing suite ${s.file}`);
    assert.ok(suiteText(s.file).includes(s.title), `${c.id}: ${s.file} has no test titled "${s.title}"`);
  }
});

test('every public runtime export of the core entry point maps to a suite that mentions it', async () => {
  const core = await import('../core/index.js');
  const names = Object.keys(core).sort();
  assert.deepEqual(names.filter(n => !(n in EXPORT_SUITES)), [], 'unmapped exports');
  assert.deepEqual(Object.keys(EXPORT_SUITES).filter(n => !names.includes(n)), [], 'stale mappings');
  const missing: string[] = [];
  for (const [name, file] of Object.entries(EXPORT_SUITES)) {
    if (!fs.existsSync(path.join(dist, `${file}.test.js`))) missing.push(`${name}: no suite ${file}`);
    else if (!new RegExp(`\\b${name}\\b`).test(suiteText(file))) missing.push(`${name} not in ${file}`);
  }
  assert.deepEqual(missing, []);
});

test('the Codex row list equals the workflows the package delivers, and each is validated by the package suite', () => {
  assert.deepEqual([...CODEX_WORKFLOWS_DELIVERED].sort(), [...CODEX_WORKFLOWS].sort());
  const text = suiteText('harness/codex-package');
  for (const w of CODEX_WORKFLOWS) assert.ok(text.includes(`'${w}'`), w);
});

test('Claude workflows report as pending, never passing, and the shipped skill templates are exactly the six reasoning fallbacks', () => {
  const all = fs.readdirSync(path.join(dist, 'templates/claude/skills')).sort();
  // Internal reasoning procedures are not public workflows; claude-handlers.test maps each to a reasoning command.
  // The five mechanical workflows are native commands only (D10), so they have no skill template.
  const fallbacks = ['decision-new', 'plan-create', 'plan-finish', 'plan-step', 'spec-assist', 'spec-draft-architecture'];
  assert.deepEqual(all.filter(name => !name.startsWith('specplane-reason-')), fallbacks);
  assert.deepEqual([...CLAUDE_WORKFLOWS].sort(), [...fallbacks, 'approve', 'plan-abandon', 'plan-start', 'plan-status', 'validate'].sort());
  for (const row of hostRows('claude')) assert.deepEqual([row.deterministic, row.liveHost], ['not-delivered', 'pending'], row.workflow);
  for (const row of hostRows('codex')) assert.deepEqual([row.deterministic, row.liveHost], ['tested', 'unverified'], row.workflow);
  assert.equal(fs.existsSync(path.join(dist, 'harness/claude-package.js')), false, 'a Claude package now exists: add its rows and suites and revisit the unmet criterion');
});

test('criteria are only met when every suite is deterministic, and the one unmet criterion carries a reason', () => {
  assert.deepEqual(CRITERIA.filter(c => c.state === 'unmet').map(c => c.id), ['exports-and-workflows']);
  for (const c of CRITERIA) assert.equal(c.state === 'unmet', c.reason !== undefined, c.id);
});

test('docs agree across CLI, core and the installed Codex package, offline and outside any repository', async () => {
  const { docsIndex, docsTopic, docsSearch } = await import('../core/index.js');
  const root = makeRepo({}); runInit(root, { harness: 'codex' });
  const installed = path.join(root, SKILL_DIR);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-docs-')));
  const index = docsIndex();
  for (const js of [cliJs, path.join(installed, 'dist/cli.js')]) {
    const out = cli(js, outside, 'docs', '--json'); assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), index);
    for (const id of ['completion', 'commands/spec-complete']) assert.deepEqual(JSON.parse(cli(js, outside, 'docs', id, '--json').stdout), docsTopic(id), id);
    assert.deepEqual(JSON.parse(cli(js, outside, 'docs', 'search', 'stale', '--json').stdout), docsSearch('stale'));
  }
  assert.deepEqual(fs.readdirSync(outside), []);
  // Harness copies: the packaged docs trees and the shipped bundle hold the same bytes.
  const bundle = path.join(dist, '..', 'assets/docs');
  const shipped = fs.existsSync(bundle) ? bundle : path.join(installed, 'assets/docs');
  for (const copy of ['docs', 'assets/docs']) {
    for (const rel of ['manifest.json', 'orientation.md']) assert.equal(fs.readFileSync(path.join(installed, copy, rel), 'utf8'), fs.readFileSync(path.join(shipped, rel), 'utf8'), `${copy}/${rel}`);
  }
});

test('agent interpretation and live-host behaviour are not asserted by deterministic suites', () => {
  const root = makeRepo({}); runInit(root, { harness: 'codex' }); runInit(root, { harness: 'claude' });
  for (const h of ['codex', 'claude']) {
    const m = JSON.parse(fs.readFileSync(path.join(root, `.specplane/installed/${h}.json`), 'utf8'));
    assert.equal(m.state.enabled, 'unobserved', `${h}: install never claims the host enabled anything`);
  }
  const ext = JSON.parse(fs.readFileSync(path.join(root, SKILL_DIR, 'specplane-extension.json'), 'utf8'));
  assert.deepEqual(ext.hostCompatibility, []);
  assert.deepEqual(ext.capabilities, { reasoning: true, nativeCommands: false, backgroundSessions: false });
});

test('exports without a dedicated suite are exercised directly: closed schemas, refusals and surface constants', async () => {
  const core = await import('../core/index.js');
  const { Ajv } = await import('ajv');
  const ajv = new Ajv({ strict: false });
  const schemas = { assertionSchema: core.assertionSchema, confirmationChallengeSchema: core.confirmationChallengeSchema, conductorRequestSchema: core.conductorRequestSchema, manifestSchema: core.manifestSchema,
    contributionEventSchema: core.contributionEventSchema, contributionProposalSchema: core.contributionProposalSchema, contributionQuerySchema: core.contributionQuerySchema, recordingProposalSchema: core.recordingProposalSchema,
    reviewedTestMappingSchema: core.reviewedTestMappingSchema, testExecutionResultSchema: core.testExecutionResultSchema, workflowCreationSchema: core.workflowCreationSchema,
    workflowInitiationSchema: core.workflowInitiationSchema, workflowResultSchema: core.workflowResultSchema };
  for (const [name, schema] of Object.entries(schemas)) {
    const validate = ajv.compile(schema as object);
    assert.equal(validate(null), false, `${name} accepts null`);
    assert.equal(validate({ unexpected: true }), false, `${name} accepts an unknown-field object`);
  }
  for (const fragment of [core.artifact, core.criterion, core.context]) assert.equal(typeof fragment, 'object');
  const incompatible = await core.checkCompatibility({}, { extensionId: 'x', host: 'codex', surface: 'cli', workflow: 'validate', probes: {} } as never); assert.equal(incompatible.ok, false);
  const refused = core.inspectRepository({ checkout: '.' }); assert.equal(refused.ok, false);
  assert.throws(() => core.validateContribution({}, (() => true) as never));
  assert.deepEqual([...core.RUNNER_METHODS], ['inspect', 'prepare', 'executeTest', 'validate', 'record', 'capture', 'cancel', 'close']);
  assert.ok(core.spawnExecutionPort);
});
