import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig, resolveSessionMode } from "./config.js";
import { ConfigError } from "./errors.js";
import { fixture } from "./fixtures.js";
import { mainRoot } from "./git/repo.js";

const load = (name: string) => loadConfig(fixture("configs", name));

test("absent config returns defaults with a warning", () => {
  const { config, warnings } = load("missing");
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.deepEqual(warnings.map((w) => w.message), ["No `.specplane/config.yaml` found; using defaults."]);
});

test("partial config merges with defaults", () => {
  const { config, warnings } = load("partial");
  assert.equal(config.plans.merge, "local_merge");
  assert.equal(config.plans.dir, "plans");
  assert.equal(config.specs.pin_bases, "warn");
  assert.deepEqual(config.spec_roots, DEFAULT_CONFIG.spec_roots);
  assert.deepEqual(warnings, []);
});

test("invalid enum value throws ConfigError", () => {
  assert.throws(() => load("bad-enum"), (e) => e instanceof ConfigError && /plans\.merge/.test(e.message));
});

test("llm_role review is accepted for both spec types", () => {
  const { config, warnings } = load("review-role");
  assert.equal(config.specs.feature.llm_role, "review");
  assert.equal(config.specs.architecture.llm_role, "review");
  assert.deepEqual(warnings, []);
});

test("unknown llm_role fails and lists the allowed values", () => {
  assert.throws(
    () => load("bad-llm-role"),
    (e) =>
      e instanceof ConfigError &&
      /specs\.feature\.llm_role/.test(e.message) &&
      /review, assist, draft, none/.test(e.message),
  );
});

test("unknown keys warn and are dropped", () => {
  const { config, warnings } = load("unknown-key");
  assert.deepEqual(warnings.map((w) => w.message).sort(), [
    "Unknown config key `mystery`; ignoring.",
    "Unknown config key `plans.frobnicate`; ignoring.",
  ]);
  assert.equal(config.plans.merge, "local_merge");
  assert.equal("mystery" in config, false);
  assert.equal("frobnicate" in config.plans, false);
});

test("root extends cycle throws ConfigError", () => {
  assert.throws(() => load("bad-cycle"), ConfigError);
});

test("malformed YAML throws ConfigError", () => {
  assert.throws(() => load("bad-yaml"), ConfigError);
});

test("duplicate spec root name", () => {
  assert.throws(
    () => load("duplicate-root"),
    (e) => e instanceof ConfigError && e.message === "Duplicate spec root name `base`.",
  );
});

test("missing spec root is an error", () => {
  assert.throws(
    () => load("root-missing"),
    (e) => e instanceof ConfigError && e.message === "Spec root `docs`: path `docs/missing` does not exist.",
  );
});

test("spec root outside the repository is an error", () => {
  assert.throws(
    () => load("root-outside"),
    (e) => e instanceof ConfigError && e.message === "Spec root `shared`: path `../shared-specs` is outside the repository.",
  );
});

test("spec root that is not a directory is an error", () => {
  assert.throws(
    () => load("root-not-dir"),
    (e) => e instanceof ConfigError && e.message === "Spec root `docs`: path `docs/file` is not a directory.",
  );
});

test("worktree_dir inside the repository is an error with the worktree backend", () => {
  const root = fixture("configs", "worktree-inside");
  const abs = path.resolve(mainRoot(root), ".worktrees");
  assert.throws(
    () => load("worktree-inside"),
    (e) =>
      e instanceof ConfigError &&
      e.message === `\`execution.worktree_dir\` must be outside the repository. \`.worktrees\` resolves to \`${abs}\` inside it.`,
  );
});

test("worktree_dir is not checked with the branch backend", () => {
  assert.equal(load("worktree-branch").config.execution.worktree_dir, ".worktrees");
});

test("DEFAULT_CONFIG equals the defaults table in feature/configuration", () => {
  const spec = readFileSync(new URL("../../../docs/specifications/features/configuration.md", import.meta.url), "utf8");
  const m = /## Full schema with defaults\s+```yaml\n([\s\S]*?)\n```/.exec(spec);
  assert.ok(m, "defaults block not found in feature/configuration");
  assert.deepEqual(yaml.load(m[1], { schema: yaml.JSON_SCHEMA }), DEFAULT_CONFIG);
});

// Conductor configuration is inert unless a caller explicitly runs a plan.

/** Load an isolated config without requiring a populated specification tree. */
function loadExecution(execution: unknown): ReturnType<typeof loadConfig> {
  const root = mkdtempSync(path.join(os.tmpdir(), "specplane-conductor-config-"));
  try {
    mkdirSync(path.join(root, ".specplane"));
    writeFileSync(path.join(root, ".specplane/config.yaml"), yaml.dump({ execution }));
    return loadConfig(root, { checkSpecRoots: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("conductor config: safe defaults and partial notification merge", () => {
  const defaults = loadExecution({}).config.execution;
  assert.equal(defaults.session_mode, "auto");
  assert.equal(defaults.max_parallel, 1);
  assert.equal(defaults.max_budget_usd, null);
  assert.deepEqual(defaults.notify, {
    on: ["blocked", "consideration", "finish_ready", "failed"],
    transport: "none", command: "", dedupe: true,
  });
  const { config, warnings } = loadExecution({ notify: { on: [], dedupe: false } });
  assert.deepEqual(config.execution.notify, { on: [], transport: "none", command: "", dedupe: false });
  assert.deepEqual(warnings, []);
});

test("conductor config: accepted modes, transports, limits and event selectors", () => {
  const { config, warnings } = loadExecution({
    session_mode: "unattended", max_parallel: 2, max_budget_usd: 0.25,
    notify: { on: ["done"], transport: "command", command: "printf alert", dedupe: false },
  });
  assert.equal(config.execution.session_mode, "unattended");
  assert.equal(config.execution.max_parallel, 2);
  assert.equal(config.execution.max_budget_usd, 0.25);
  assert.equal(config.execution.notify.command, "printf alert");
  assert.deepEqual(config.execution.notify.on, ["done"]);
  assert.deepEqual(warnings, []);
  assert.equal(loadExecution({ notify: { transport: "harness" } }).config.execution.notify.transport, "harness");
  assert.equal(loadExecution({ max_budget_usd: null }).config.execution.max_budget_usd, null);
});

test("conductor config: invalid enums, types and unsafe limits are rejected", () => {
  const invalid = [
    { session_mode: "attended" }, { session_mode: true },
    { notify: { transport: "email" } }, { notify: { on: ["progress"] } },
    { notify: { on: "blocked" } }, { notify: { on: ["blocked", "blocked"] } },
    { notify: { dedupe: "false" } }, { notify: { command: 123 } },
    { max_parallel: 0 }, { max_parallel: -1 }, { max_parallel: 1.5 }, { max_parallel: "2" },
    { max_budget_usd: 0 }, { max_budget_usd: -0.1 }, { max_budget_usd: "1" },
    { max_budget_usd: Infinity }, { max_budget_usd: NaN },
  ];
  for (const execution of invalid) {
    assert.throws(() => loadExecution(execution), ConfigError, JSON.stringify(execution));
  }
});

test("conductor config: command transport requires a nonblank command", () => {
  for (const notify of [{ transport: "command" }, { transport: "command", command: "  \n\t" }]) {
    assert.throws(() => loadExecution({ notify }),
      (e: unknown) => e instanceof ConfigError && e.message.includes("execution.notify.command"));
  }
});

test("conductor config: unknown nested keys still warn and are dropped", () => {
  const { config, warnings } = loadExecution({ future: true, notify: { future: "value" } });
  assert.deepEqual(warnings.map((w) => w.message).sort(), [
    "Unknown config key `execution.future`; ignoring.",
    "Unknown config key `execution.notify.future`; ignoring.",
  ]);
  assert.equal("future" in config.execution, false);
  assert.equal("future" in config.execution.notify, false);
});

test("session mode: config can force unattended but cannot force attended", () => {
  assert.equal(resolveSessionMode("auto", "attended"), "attended");
  assert.equal(resolveSessionMode("auto", "unattended"), "unattended");
  assert.equal(resolveSessionMode("unattended", "attended"), "unattended");
  assert.equal(resolveSessionMode("unattended", "unattended"), "unattended");
});


test("init emits the complete runtime defaults including conductor settings", async () => {
  const { DEFAULT_CONFIG_YAML } = await import("./commands/init.js");
  assert.deepEqual(yaml.load(DEFAULT_CONFIG_YAML), DEFAULT_CONFIG);
});

function loadVerification(verification: unknown): ReturnType<typeof loadConfig> {
  const root = mkdtempSync(path.join(os.tmpdir(), "specplane-verification-config-"));
  try {
    mkdirSync(path.join(root, ".specplane"));
    writeFileSync(path.join(root, ".specplane/config.yaml"), yaml.dump({ verification }));
    return loadConfig(root, { checkSpecRoots: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("verification config: defaults and accepted suites", () => {
  const defaults = loadVerification({}).config.verification;
  assert.deepEqual(defaults, DEFAULT_CONFIG.verification);
  assert.equal(defaults.mode, "auto");
  assert.deepEqual(defaults.suites, {});
  const { config, warnings } = loadVerification({ mode: "manual", suites: { unit: { command: ["npm", "test"], format: "node-tap-v13" } }, text_paths: ["notes/**"] });
  assert.equal(config.verification.mode, "manual");
  assert.deepEqual(config.verification.suites.unit, { command: ["npm", "test"], format: "node-tap-v13" });
  assert.deepEqual(config.verification.text_paths, ["notes/**"]);
  assert.deepEqual(config.verification.risk_paths, DEFAULT_CONFIG.verification.risk_paths);
  assert.deepEqual(warnings, []);
});

test("verification config: invalid values are rejected", () => {
  const invalid = [
    { mode: "strict" }, { suites: { unit: { command: "npm test", format: "junit-xml" } } },
    { suites: { unit: { command: [], format: "junit-xml" } } }, { suites: { unit: { command: ["npm"], format: "tap" } } },
    { suites: { unit: { command: ["npm"] } } }, { text_paths: "**/*.md" }, { risk_paths: [1] },
  ];
  for (const verification of invalid) assert.throws(() => loadVerification(verification), ConfigError, JSON.stringify(verification));
});
