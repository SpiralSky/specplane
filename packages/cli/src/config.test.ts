import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import { fixture } from "./fixtures.js";

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
