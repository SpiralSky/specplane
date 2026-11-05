import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv } from 'ajv';
import { mechanicalRequestSchema, workflowTestRequestSchema } from './schemas.js';

test('import with arbitrary CLI arguments neither parses them nor writes to checkout', async () => {
  const checkout = mkdtempSync(path.join(tmpdir(), 'core-import-'));
  const oldCwd = process.cwd(), oldArgv = process.argv;
  try {
    process.chdir(checkout); process.argv = ['node', 'specplane', '--invalid-codex-argument'];
    const core = await import('./index.js');
    assert.equal(core.coreInfo.protocol, 1);
    assert.deepEqual(readdirSync(checkout), []);
    assert.deepEqual(process.argv, ['node', 'specplane', '--invalid-codex-argument']);
  } finally { process.chdir(oldCwd); process.argv = oldArgv; }
});
test('closed operation and test schemas reject unknown fields and invalid requests', () => {
  const ajv = new Ajv(); const operation = ajv.compile(mechanicalRequestSchema); const execute = ajv.compile(workflowTestRequestSchema);
  assert.equal(operation({ operation: 'spec.implementation', arguments: { id: 'feature/x', status: 'complete' } }), true);
  assert.equal(operation({ operation: 'spec.implementation', arguments: { id: 'feature/x', status: 'complete', extra: true } }), false);
  assert.equal(operation({ operation: 'spec.unknown', arguments: {} }), false);
  assert.equal(execute({ requestId: 'x', criterionIds: ['a'], executable: 'node', args: [], reportFormat: 'node-tap-v13' }), true);
  assert.equal(execute({ requestId: 'x', criterionIds: ['a', 'a'], executable: 'node', args: [], reportFormat: 'node-tap-v13' }), false);
  assert.equal(execute({ requestId: 'x', criterionIds: ['a'], executable: 'node', args: [], reportFormat: 'node-tap-v13', extra: 1 }), false);
});

test('public operations reject malformed inputs and explicitly refuse valid unimplemented work', async () => {
  const { executeOperation, executeWorkflowTest } = await import('./index.js');
  const ctx = { extensionId: 'manual' };
  const valid = executeOperation({ operation: 'docs.index', arguments: {} }, ctx);
  assert.equal(valid.ok, false); if (!valid.ok) assert.equal(valid.error.code, 'UNSUPPORTED_CAPABILITY');
  const invalid = executeOperation({ operation: 'docs.index', arguments: { extra: true } } as never, ctx);
  assert.equal(invalid.ok, false); if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_EVIDENCE');
  const testResult = await executeWorkflowTest({ requestId: 'x', criterionIds: ['a'], executable: 'node', args: [], reportFormat: 'node-tap-v13' }, ctx);
  assert.equal(testResult.ok, false); if (!testResult.ok) assert.equal(testResult.error.code, 'STALE_STATE');
});
test('closed receipt and confirmation schemas reject inconsistent or extra fields', async () => {
  const { testReceiptSchema, confirmationResponseSchema } = await import('./schemas.js');
  const ajv = new Ajv(); const receipt = ajv.compile(testReceiptSchema); const response = ajv.compile(confirmationResponseSchema);
  const digest = 'a'.repeat(64); const output = { path: 'out.txt', digest };
  const sample = { protocol: 1, requestId: 'request', executionId: 'execution', suiteId: null, stateDigest: digest, executable: '/bin/node', args: [], checkout: '/checkout', exitCode: 0, signal: null, stdout: output, stderr: output, assertions: [] };
  assert.equal(receipt(sample), true);
  assert.equal(receipt({ ...sample, suiteId: 'unit' }), true);
  assert.equal(receipt({ ...sample, suiteId: undefined }), false);
  assert.equal(receipt({ ...sample, signal: 'SIGTERM' }), false);
  assert.equal(receipt({ ...sample, stdout: { ...output, path: '../outside' } }), false);
  assert.equal(response({ challengeId: 'c', decision: 'confirm', interactionId: 'i' }), true);
  assert.equal(response({ challengeId: 'c', decision: 'confirm', interactionId: 'i', extra: true }), false);
});
