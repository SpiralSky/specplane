import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { COEXISTING_WORKFLOWS_LINE, NEUTRAL_WORKFLOWS_LINE } from "../agents/standing.js";
import { CLAUDE_WORKFLOWS_LINE } from "../harness/claude.js";
import { CODEX_WORKFLOWS_LINE } from "../harness/codex.js";
import { runConductor } from "../core/index.js";
import type { SessionAdapter } from "../core/contracts.js";
import { makeRepo } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const agents = (root: string) => fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

test("shared standing instructions never depend on registry order or on which harness was initialised last", () => {
  const root = makeRepo({});
  runInit(root, { harness: "none" });
  assert.ok(agents(root).includes(NEUTRAL_WORKFLOWS_LINE), "no host: neutral and usable");
  runInit(root, { harness: "claude" });
  assert.ok(agents(root).includes(CLAUDE_WORKFLOWS_LINE));
  assert.ok(!agents(root).includes("Codex"));
  runInit(root, { harness: "codex" });
  assert.ok(agents(root).includes(COEXISTING_WORKFLOWS_LINE), "both installed: neutral dispatcher, not the last-initialised host");
  runInit(root, {});
  assert.ok(agents(root).includes(COEXISTING_WORKFLOWS_LINE), "plain re-init does not flip back to the first registry entry");
  assert.ok(!agents(root).includes(CLAUDE_WORKFLOWS_LINE) && !agents(root).includes(CODEX_WORKFLOWS_LINE));
});

test("a codex-only repository keeps its own line and a neutral repository stays neutral without any host", () => {
  const codexOnly = makeRepo({});
  runInit(codexOnly, { harness: "codex" });
  runInit(codexOnly, {});
  assert.ok(agents(codexOnly).includes(CODEX_WORKFLOWS_LINE));
  const none = makeRepo({});
  runInit(none, {});
  assert.ok(agents(none).includes(NEUTRAL_WORKFLOWS_LINE));
});

test("the removed standalone run surfaces refuse with a migration diagnostic and are absent from help", () => {
  const root = makeRepo({});
  const help = run(root, "plan", "--help");
  assert.doesNotMatch(help.stdout, /^\s+run\b/m);
  assert.doesNotMatch(run(root, "plan", "start", "--help").stdout, /--run/);
  for (const args of [["plan", "run", "2026-11-01-x", "--harness", "claude"], ["plan", "start", "2026-11-01-x", "--run"]]) {
    const r = run(root, ...args);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /never launches agent sessions/);
    assert.match(r.stderr, /plan start <id>/);
  }
});

test("core runConductor requires an explicit adapter and has no default, discovery or host fallback", async () => {
  const root = makeRepo({});
  const missing = await runConductor({ plans: ["2026-11-01-x"] }, { checkout: root, extensionId: "test" } as never);
  assert.equal(missing.ok, false); if (!missing.ok) assert.equal(missing.error.code, "INVALID_EVIDENCE");
  const partial = { name: "x", async probe() { throw new Error("must not run"); } } as unknown as SessionAdapter;
  const incomplete = await runConductor({ plans: ["2026-11-01-x"] }, { checkout: root, extensionId: "test", adapter: partial });
  assert.equal(incomplete.ok, false);
  const bad = await runConductor({ plans: [] } as never, { checkout: root, extensionId: "test", adapter: partial });
  assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.error.code, "INVALID_EVIDENCE");
});

test("core runConductor outside a Git checkout returns a normalised failure without touching the adapter", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-conductor-core-"));
  try {
    const calls: string[] = [];
    const adapter: SessionAdapter = {
      name: "fake",
      async probe() { calls.push("probe"); return { host: "fake", surface: "t", backends: ["worktree"], launch: true, observe: true, resume: true, cancel: true, budgetEnforcement: true }; },
      async launch() { calls.push("launch"); throw new Error("no"); }, async observe() { calls.push("observe"); throw new Error("no"); },
      async resume() { calls.push("resume"); throw new Error("no"); }, async recovery() { return { available: false }; }, async cancel() { return { stopped: false, recoveryRequired: false }; },
    };
    const outside = await runConductor({ plans: ["2026-11-01-x"], dryRun: true }, { checkout: root, extensionId: "test", adapter });
    assert.equal(outside.ok, false, "not a Git checkout: normalised failure, never an empty success");
    assert.deepEqual(calls, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
