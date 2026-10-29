import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";
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
