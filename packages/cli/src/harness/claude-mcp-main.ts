#!/usr/bin/env node
// Entry for the Claude plugin's MCP server: `node <plugin>/core/dist/harness/claude-mcp-main.js`.
// Speaks MCP over stdio (see claude-mcp.ts). The checkout is SPECPLANE_CHECKOUT, else the working directory.
// Host evidence comes only from SPECPLANE_HOST_EVIDENCE (JSON); without it every prepare is refused as incompatible.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRunner } from '../core/workflow-runner.js';
import { createClaudeMcpServer } from './claude-mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkout = process.env.SPECPLANE_CHECKOUT ?? process.cwd();
if (!path.isAbsolute(checkout)) {
  process.stderr.write('SPECPLANE_CHECKOUT or the working directory must be an absolute path.\n');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'specplane-extension.json'), 'utf8'));
const hostEvidence = process.env.SPECPLANE_HOST_EVIDENCE ? JSON.parse(process.env.SPECPLANE_HOST_EVIDENCE) : undefined;
const runner = createWorkflowRunner({
  checkout,
  extensionId: manifest.extension.id,
  compatibilityFor: workflow => hostEvidence ? { manifest, host: { packageRoot: root, extensionId: manifest.extension.id, host: 'claude-code', workflow, ...hostEvidence } } : undefined,
});
const server = createClaudeMcpServer(runner);
await server.serve({ input: process.stdin, write: line => process.stdout.write(line) });
// Disconnect (session exit or a killed host) is a runner EOF: pending work is cancelled and every lease this process holds is released.
const ended = (async function* () { /* no input: the runner only closes */ })();
process.exitCode = await runner.serve({ input: ended, write: () => undefined, diagnostic: text => process.stderr.write(text) });
