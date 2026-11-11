import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { PreconditionError } from "../errors.js";
import { makeRepo } from "../test-repo.js";
import { CAPABILITIES, getAdapter, missingCapabilities, noCapabilities, reportCapabilities, requireCapability } from "./adapter.js";
import "./adapters.js";

test("an adapter reports every capability as supported or missing", () => {
  const codex = getAdapter("codex")!;
  const lines = reportCapabilities(codex);
  assert.equal(lines.length, CAPABILITIES.length);
  assert.ok(lines.every((l) => l.endsWith(": missing")));
  assert.deepEqual(missingCapabilities(codex), [...CAPABILITIES]);
  assert.deepEqual(noCapabilities()["command-blocking"], false);
});

test("a missing capability is refused, not substituted", () => {
  assert.throws(() => requireCapability(getAdapter("codex")!, "viewing", "Viewing a spec"), (e) => e instanceof PreconditionError && /does not support/.test(e.message));
});

test("claude claims command blocking only once the hook is installed", () => {
  const root = makeRepo({});
  const claude = getAdapter("claude")!;
  assert.equal(claude.capabilities(root)["command-blocking"], false);
  assert.equal(claude.capabilities()["command-blocking"], false);
  fs.mkdirSync(path.join(root, ".claude/hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"), "#!/bin/sh\n");
  assert.equal(claude.capabilities(root)["command-blocking"], true);
  assert.equal(claude.capabilities(root)["instructions-on-demand"], true);
});
