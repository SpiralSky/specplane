import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { NEUTRAL_WORKFLOWS_LINE } from "../agents/standing.js";
import { runConductor } from "../core/index.js";
import type { SessionAdapter } from "../core/contracts.js";
import { makeRepo } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const agents = (root: string) => fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

test("shared standing instructions are the neutral text for every init order and never name a host", () => {
  const root = makeRepo({});
  runInit(root, { harness: "none" });
  const neutral = agents(root);
  assert.ok(neutral.includes(NEUTRAL_WORKFLOWS_LINE));
  for (const harness of ["claude", "codex", undefined]) {
    runInit(root, harness ? { harness } : {});
    assert.equal(agents(root), neutral, `init ${harness ?? "(plain)"} leaves the shared block unchanged`);
  }
  const codexOnly = makeRepo({});
  runInit(codexOnly, { harness: "codex" });
  assert.equal(agents(codexOnly), neutral);
});

test("the standalone CLI has no run surface: plan run and plan start --run are unknown", () => {
  const root = makeRepo({});
  assert.doesNotMatch(run(root, "plan", "--help").stdout, /^\s+run\b/m);
  assert.doesNotMatch(run(root, "plan", "start", "--help").stdout, /--run/);
  const cmd = run(root, "plan", "run", "2026-11-01-x", "--harness", "claude");
  assert.notEqual(cmd.status, 0);
  assert.match(cmd.stderr, /unknown command 'run'/);
  const opt = run(root, "plan", "start", "2026-11-01-x", "--run");
  assert.notEqual(opt.status, 0);
  assert.match(opt.stderr, /unknown option '--run'/);
  assert.equal(fs.existsSync(path.join(root, ".git", "specplane-runtime")), false);
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
      async probe() { calls.push("probe"); return { host: "fake", surface: "t", backends: ["worktree"], launch: true, observe: true, resume: true, cancel: true, limitKinds: ["usd"] }; },
      async launch() { calls.push("launch"); throw new Error("no"); }, async observe() { calls.push("observe"); throw new Error("no"); },
      async resume() { calls.push("resume"); throw new Error("no"); }, async recovery() { return { available: false }; }, async cancel() { return { stopped: false, recoveryRequired: false }; },
    };
    const outside = await runConductor({ plans: ["2026-11-01-x"], dryRun: true }, { checkout: root, extensionId: "test", adapter });
    assert.equal(outside.ok, false, "not a Git checkout: normalised failure, never an empty success");
    assert.deepEqual(calls, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
