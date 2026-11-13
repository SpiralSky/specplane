import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRepo } from "../test-repo.js";
import { guardConfig } from "./guard-config.js";

test("hook settings use core defaults and normalized paths from working-tree YAML", () => {
  const root = makeRepo({ ".specplane/config.yaml": `
paths: {features: './specs/old/../features/', architecture: 'specs/architecture'}
subprojects: [{name: child, path: './child specs/'}]
strict_mode: {enabled: 'on', git_commit_guard: 'off'}
bypass_guards: {headless_block: 'off'}
` });
  const settings = guardConfig(root);
  assert.deepEqual(settings.spec_dirs, ["docs/requirements", "specs/features", "specs/architecture",
    ".specplane/decisions", ".specplane/roles", "child specs/requirements", "child specs/features", "child specs/architecture"]);
  assert.deepEqual(settings.strict, { edit_block: true, git_commit_guard: false, os_permissions: true });
  assert.equal(settings.bypass.headless_block, false);
  assert.equal(settings.bypass.marker_protect, true);
});

test("hook settings default strict mode off and all bypass guards on", () => {
  const settings = guardConfig(makeRepo({ ".specplane/config.yaml": "" }));
  assert.ok(Object.values(settings.strict).every((v) => v === false));
  assert.ok(Object.values(settings.bypass).every((v) => v === true));
});

test("hook settings refuse unreadable or malformed protection configuration instead of guessing defaults", () => {
  assert.throws(() => guardConfig(makeRepo({})));
  for (const text of ["[", "[]", "paths: {features: 123}", "subprojects: wrong",
    "strict_mode: {enabled: yes}", "bypass_guards: {hook_protect: no}"]) {
    assert.throws(() => guardConfig(makeRepo({ ".specplane/config.yaml": text })), Error, text);
  }
});
