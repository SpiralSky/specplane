#!/usr/bin/env node
// Persistent protocol-1 NDJSON runner: `node <skill>/scripts/workflow.mjs serve --checkout <absolute-checkout>`.
// One JSON object per line on stdin/stdout; diagnostics go to stderr. No host launcher or prompt dispatcher.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRunner, parseServeArgs } from '../dist/core/index.js';

const parsed = parseServeArgs(process.argv.slice(2));
if (!parsed.ok) { process.stderr.write(parsed.message + '\n'); process.exit(2); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'specplane-extension.json'), 'utf8'));
// Host identity and probes are reported by the embedding session, never guessed here; absent evidence means preparation is refused.
const hostEvidence = process.env.SPECPLANE_HOST_EVIDENCE ? JSON.parse(process.env.SPECPLANE_HOST_EVIDENCE) : undefined;
const runner = createWorkflowRunner({
  checkout: parsed.checkout,
  extensionId: manifest.extension.id,
  compatibilityFor: workflow => hostEvidence ? { manifest, host: { packageRoot: root, extensionId: manifest.extension.id, host: 'codex', workflow, ...hostEvidence } } : undefined,
});
process.exitCode = await runner.serve({
  input: process.stdin,
  write: line => process.stdout.write(line),
  diagnostic: text => process.stderr.write(text),
});
