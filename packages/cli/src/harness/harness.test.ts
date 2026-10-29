import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { makeRepo } from "../test-repo.js";
import { type Harness, NO_HARNESS_HINT, templatesDir, UnknownHarnessError } from "./index.js";

function fake(calls: string[], detected: boolean): Harness {
  return {
    name: "fake",
    detect: () => detected,
    install: (_root, report) => {
      calls.push("install");
      report.add("Created .fake/x");
    },
    skillDirs: () => [],
    rulesFile: ".fake/rules.md",
  };
}

test("harness: unknown name throws with known names", () => {
  const root = makeRepo({});
  assert.throws(
    () => runInit(root, { harness: "nope", registry: [fake([], false)] }),
    (e: unknown) => e instanceof UnknownHarnessError && e.exitCode === 1 && e.message.includes("fake"),
  );
});

test("harness: --harness and detection call install; neither prints hint", () => {
  const root = makeRepo({});
  const calls: string[] = [];
  assert.ok(runInit(root, { harness: "fake", registry: [fake(calls, false)] }).includes("Created .fake/x"));
  runInit(root, { registry: [fake(calls, true)] });
  assert.equal(calls.length, 2);
  const none = runInit(root, { registry: [fake(calls, false)] });
  assert.equal(calls.length, 2);
  assert.ok(none.includes(NO_HARNESS_HINT));
});

test("harness: claude templates resolve from the compiled module", () => {
  assert.ok(fs.existsSync(path.join(templatesDir("claude"), "settings.json")));
});
