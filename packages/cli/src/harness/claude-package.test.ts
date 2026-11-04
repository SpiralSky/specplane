import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { coreInfo } from '../core/build-info.js';
import { validateCompatibility, type ExtensionManifest, type HostSelection } from '../core/compatibility.js';
import { runInit } from '../commands/init.js';
import { makeRepo } from '../test-repo.js';
import { id, repo } from '../core/workflow-test-fixture.js';
import { CLAUDE_EXTENSION_ID, CLAUDE_HOST_SELECTION, CLAUDE_MCP_ENTRY, CLAUDE_PACKAGE_DIR, CLAUDE_REASONING_WORKFLOWS } from './claude-package.js';

const NONCE = 'nonce-0123456789abcdef';
const manifestOf = (root: string) => JSON.parse(fs.readFileSync(path.join(root, CLAUDE_PACKAGE_DIR, 'specplane-extension.json'), 'utf8')) as ExtensionManifest;
const hostFor = (root: string, workflow: string): HostSelection => ({
  packageRoot: fs.realpathSync(path.join(root, CLAUDE_PACKAGE_DIR)), extensionId: CLAUDE_EXTENSION_ID, host: 'claude-code', surface: 'cli',
  probes: { nativeCommands: false, backgroundSessions: false }, workflow,
});

test('claude init stages the Claude package with a manifest that validates for every reasoning workflow and keeps capability flags false', async () => {
  const root = makeRepo({});
  runInit(root, { harness: 'claude' });
  const dir = path.join(root, CLAUDE_PACKAGE_DIR);
  for (const rel of ['specplane-extension.json', 'core/inventory.json', CLAUDE_MCP_ENTRY, 'host-evidence/claude-code.json', 'docs/manifest.json', 'instructions/specplane.md', 'package.json', 'node_modules/ajv/package.json']) {
    assert.ok(fs.existsSync(path.join(dir, rel)), rel);
  }
  assert.equal(fs.existsSync(path.join(dir, 'dist/templates/claude')), false, 'Claude skill templates are not packaged');
  assert.equal(fs.existsSync(path.join(dir, 'dist/harness/claude-package.js')), true, 'the package builder is part of the runtime tree');
  const manifest = manifestOf(root);
  assert.equal(manifest.extension.id, CLAUDE_EXTENSION_ID);
  assert.equal(manifest.extension.host, 'claude-code');
  assert.deepEqual(manifest.capabilities, { reasoning: true, nativeCommands: false, backgroundSessions: false });
  assert.deepEqual(manifest.hostCompatibility, [], 'no host version is certified by the recorded evidence');
  assert.deepEqual([...new Set(manifest.procedures.map(p => p.workflow))].sort(), [...CLAUDE_REASONING_WORKFLOWS].sort());
  const host = JSON.parse(fs.readFileSync(path.join(dir, 'host-evidence/claude-code.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(host.host, CLAUDE_HOST_SELECTION.host);
  assert.equal(host.version, '2.1.317');
  for (const workflow of CLAUDE_REASONING_WORKFLOWS) {
    const result = await validateCompatibility(manifest, hostFor(root, workflow), coreInfo);
    assert.equal(result.ok, true, `${workflow}: ${JSON.stringify(result)}`);
    if (result.ok) assert.deepEqual(result.value, { reasoning: true, nativeCommands: false, backgroundSessions: false });
  }
});

test('the recorded host evidence exists for the packaged claude-code version and certifies no native or background capability', () => {
  const recorded = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'harnesses/claude/host-evidence/2.1.317/capabilities.json');
  if (!fs.existsSync(recorded)) return; // installed outside the repository: the package carries its own copy of the selection
  const evidence = JSON.parse(fs.readFileSync(recorded, 'utf8')) as { host: string; version: string };
  assert.equal(evidence.host, CLAUDE_HOST_SELECTION.host);
  assert.equal(evidence.version, CLAUDE_HOST_SELECTION.version);
  assert.deepEqual(CLAUDE_HOST_SELECTION.probes, { nativeCommands: false, backgroundSessions: false });
});

test('installer stages the package through its transaction, names the entry points in the installed manifest, and is idempotent; a tampered runtime file is refused', async () => {
  const root = makeRepo({});
  const first = runInit(root, { harness: 'claude' });
  assert.ok(first.some(line => /^Claude workflow package: \d+ files \(\d+ added, 0 updated, 0 current, 0 preserved\)/.test(line)), first.join('\n'));
  const installed = JSON.parse(fs.readFileSync(path.join(root, '.specplane/installed/claude.json'), 'utf8')) as { files: { path: string }[]; state: { enabled: string } };
  assert.equal(installed.state.enabled, 'unobserved');
  for (const rel of ['specplane-extension.json', 'core/inventory.json', CLAUDE_MCP_ENTRY, 'host-evidence/claude-code.json']) {
    assert.ok(installed.files.some(f => f.path === `${CLAUDE_PACKAGE_DIR}/${rel}`), rel);
  }
  const second = runInit(root, { harness: 'claude' });
  assert.ok(second.some(line => /^Claude workflow package: \d+ files \(0 added, 0 updated, \d+ current, 0 preserved\)/.test(line)), second.join('\n'));
  assert.ok(second.every(line => !line.startsWith(`Created ${CLAUDE_PACKAGE_DIR}`)));
  fs.appendFileSync(path.join(root, CLAUDE_PACKAGE_DIR, 'dist/core/index.js'), '// tampered\n');
  const result = await validateCompatibility(manifestOf(root), hostFor(root, 'plan-step'), coreInfo);
  assert.equal(result.ok, false);
});

test('a customized package file is preserved, named as a collision, and the package fails validation', async () => {
  const hostFile = `${CLAUDE_PACKAGE_DIR}/host-evidence/claude-code.json`;
  const root = makeRepo({ [hostFile]: '{"mine":true}\n' });
  const lines = runInit(root, { harness: 'claude' });
  assert.equal(fs.readFileSync(path.join(root, hostFile), 'utf8'), '{"mine":true}\n');
  assert.ok(lines.some(line => line.startsWith(`Collision ${hostFile}`)), lines.join('\n'));
  assert.ok(lines.some(line => /will refuse preparation/.test(line)));
  assert.equal((await validateCompatibility(manifestOf(root), hostFor(root, 'plan-step'), coreInfo)).ok, false);
});

// Installed MCP server, driven as the plugin host drives it: one persistent stdio process, one request awaited at a time.
interface Reply { id: number | string; result: { content: { type: string; text: string }[]; isError: boolean } }
function startServer(root: string, checkout: string) {
  const child = spawn(process.execPath, [path.join(root, CLAUDE_PACKAGE_DIR, CLAUDE_MCP_ENTRY)], { cwd: checkout, env: { ...process.env, SPECPLANE_CHECKOUT: checkout }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; let buffer = ''; const replies = new Map<number | string, Reply>(); let wake: (() => void) | undefined;
  child.stderr.on('data', b => { stderr += b; });
  child.stdout.on('data', b => {
    buffer += b;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) { const reply = JSON.parse(buffer.slice(0, i)) as Reply; buffer = buffer.slice(i + 1); replies.set(reply.id, reply); }
    wake?.();
  });
  const exited = new Promise<number | null>(resolve => child.on('close', resolve));
  // Tool results are JSON text: bind answers `{ bound }`; every other tool answers the runner's `{ protocol, ok, value | error }`.
  async function request(id: number, name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { nonce: NONCE, ...args } } }) + '\n');
    for (let i = 0; i < 1000 && !replies.has(id); i++) await new Promise<void>(r => { wake = r; setTimeout(r, 20); });
    const reply = replies.get(id);
    assert.ok(reply, `no reply to ${name}; stderr: ${stderr}`);
    assert.equal(reply.result.isError, false, reply.result.content[0].text);
    return JSON.parse(reply.result.content[0].text) as { ok: boolean; value?: any; error?: { code: string; message: string } };
  }
  const end = async () => { child.stdin.end(); return { status: await exited, stderr }; };
  return { request, end };
}

test('the installed MCP server binds, prepares a reasoning workflow past compatibility holding the writer lease, and close releases it', async () => {
  const root = makeRepo({});
  runInit(root, { harness: 'claude' });
  const fixture = repo();
  const server = startServer(root, fixture.cwd);
  try {
    assert.deepEqual(await server.request(1, 'bind', {}), { bound: true });
    const prepared = await server.request(2, 'prepare', { protocol: 1, workflow: 'plan-step', extensionId: CLAUDE_EXTENSION_ID, checkout: fixture.cwd, mode: 'attended', selection: { planId: id } });
    assert.notEqual(prepared.error?.code, 'INCOMPATIBLE', JSON.stringify(prepared));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const requestId = (prepared.value as { requestId: string }).requestId;
    const held = await server.request(3, 'inspect', { requestId });
    assert.notEqual((held.value as { lease: string }).lease, 'released', 'the lease is held between calls');
    const closed = await server.request(4, 'close', { requestId });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.equal((closed.value as { lease: string }).lease, 'released');
    const ended = await server.end();
    assert.equal(ended.status, 0, ended.stderr);
  } finally {
    await server.end().catch(() => undefined);
  }
});
