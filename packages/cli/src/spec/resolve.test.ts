import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config.js";
import { AmbiguousIdError, SpecNotFoundError, UnknownRootError } from "../errors.js";
import { fixture } from "../fixtures.js";
import type { Config } from "../types.js";
import { resolveSpecId } from "./resolve.js";

const repo = fixture();
const baseCfg: Config = { ...DEFAULT_CONFIG, spec_roots: [{ name: "base", path: "specs/base" }] };
const overlayCfg: Config = {
  ...DEFAULT_CONFIG,
  spec_roots: [
    { name: "base", path: "overlays/base" },
    { name: "alpha", path: "overlays/alpha", extends: "base" },
    { name: "beta", path: "overlays/beta", extends: "base" },
  ],
};

test("feature ID resolves to an absolute path", () => {
  const r = resolveSpecId("feature/spec-system", baseCfg, undefined, repo);
  assert.equal(r.path, path.join(repo, "specs/base/features/spec-system.md"));
  assert.equal(r.root, "base");
  assert.equal(r.id, "feature/spec-system");
});

test("architecture IDs map to architecture/, anchors are stripped", () => {
  const r = resolveSpecId("architecture/reference-cli#Config loading", baseCfg, undefined, repo);
  assert.equal(r.path, path.join(repo, "specs/base/architecture/reference-cli.md"));
});

test("unknown ID throws SpecNotFoundError", () => {
  assert.throws(() => resolveSpecId("feature/nope", baseCfg, undefined, repo), SpecNotFoundError);
  assert.throws(() => resolveSpecId("nonsense", baseCfg, undefined, repo), SpecNotFoundError);
  assert.throws(() => resolveSpecId("feature/../x", baseCfg, undefined, repo), SpecNotFoundError);
});

test("qualified ID naming an undeclared root throws UnknownRootError", () => {
  assert.throws(() => resolveSpecId("ghost:feature/spec-system", baseCfg, undefined, repo), UnknownRootError);
});

test("qualified ID looks in that root only", () => {
  assert.equal(resolveSpecId("beta:feature/shared", overlayCfg, undefined, repo).root, "beta");
  assert.throws(() => resolveSpecId("alpha:feature/only-beta", overlayCfg, undefined, repo), SpecNotFoundError);
});

test("sibling overlays with the same ID are ambiguous without fromRoot", () => {
  assert.throws(
    () => resolveSpecId("feature/shared", overlayCfg, undefined, repo),
    (e) => e instanceof AmbiguousIdError && /alpha/.test(e.message) && /beta/.test(e.message),
  );
});

test("fromRoot resolves through the extends chain", () => {
  assert.equal(resolveSpecId("feature/shared", overlayCfg, "alpha", repo).root, "alpha");
  assert.equal(resolveSpecId("feature/shared", overlayCfg, "beta", repo).root, "beta");
  assert.equal(resolveSpecId("feature/only-base", overlayCfg, "alpha", repo).root, "base");
  assert.throws(() => resolveSpecId("feature/only-beta", overlayCfg, "alpha", repo), SpecNotFoundError);
  assert.throws(() => resolveSpecId("feature/shared", overlayCfg, "ghost", repo), UnknownRootError);
});

test("single hit without fromRoot resolves", () => {
  assert.equal(resolveSpecId("feature/only-base", overlayCfg, undefined, repo).root, "base");
});
