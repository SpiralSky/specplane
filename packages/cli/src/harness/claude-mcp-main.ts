#!/usr/bin/env node
// Entry for the Claude plugin's MCP server: `node <plugin>/core/dist/harness/claude-mcp-main.js`.
// Speaks MCP over stdio (see claude-mcp.ts). The package root is the directory two levels above this file; the checkout
// is SPECPLANE_CHECKOUT, else the working directory. Compatibility comes only from the installed package: its manifest
// and its host selection (claude-package.ts). If either is missing or unreadable, every prepare is refused as incompatible.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowRunner } from '../core/workflow-runner.js';
import { createClaudeMcpServer, createConfirmationBridge } from './claude-mcp.js';

const packageRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const checkout = process.env.SPECPLANE_CHECKOUT ?? process.cwd();
if (!path.isAbsolute(checkout)) {
  process.stderr.write('SPECPLANE_CHECKOUT or the working directory must be an absolute path.\n');
  process.exit(2);
}
const readJson = (rel: string): Record<string, any> | undefined => {
  try { return JSON.parse(fs.readFileSync(path.join(packageRoot, rel), 'utf8')) as Record<string, any>; }
  catch { return undefined; }
};
// Same paths as CLAUDE_PACKAGE_DIR's contents in claude-package.ts (CLAUDE_HOST_EVIDENCE_PATH).
const manifest = readJson('specplane-extension.json');
const hostSelection = readJson('host-evidence/claude-code.json');
// D17 A (spec: Confirming finalised content): the bridge parks the core's confirmation challenge until the mod answers through `record`.
const confirmations = createConfirmationBridge();
const runner = createWorkflowRunner({
  checkout,
  context: { interaction: confirmations.port },
  extensionId: manifest?.extension?.id ?? '',
  compatibilityFor: workflow => manifest && hostSelection ? {
    manifest,
    host: {
      packageRoot,
      extensionId: manifest.extension.id,
      host: hostSelection.host,
      surface: hostSelection.surface,
      probes: hostSelection.probes,
      workflow,
    },
  } : undefined,
});
// D16 A is NOT wired here yet: the applied spec keeps the D16 C refusal until the reviewed suite path is live-checked (S4).
// To enable it after the user reviews BUNDLED_SUITES and a live check passes, pass `suites: BUNDLED_SUITES` (import from ./claude-suites.js).
const server = createClaudeMcpServer(runner, { confirmations });
await server.serve({ input: process.stdin, write: line => process.stdout.write(line) });
// Disconnect (session exit or a killed host) is a runner EOF: pending work is cancelled and every lease this process holds is released.
const ended = (async function* () { /* no input: the runner only closes */ })();
process.exitCode = await runner.serve({ input: ended, write: () => undefined, diagnostic: text => process.stderr.write(text) });
