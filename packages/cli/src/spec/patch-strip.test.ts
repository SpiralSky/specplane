import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { applyPatch, makePatch, patchApplies, patchStrip } from "./edit.js";

const REL = "docs/specifications/features/greeting.md";
const OLD = "# Greeting\n\nThe tool prints a greeting.\n\nHello by name.\n";
const NEW = "# Greeting\n\nThe tool prints a greeting.\n\nHello by name and time of day.\n";
const ORDINARY = `--- a/${REL}\n+++ b/${REL}\n@@ -3,3 +3,3 @@\n The tool prints a greeting.\n \n-Hello by name.\n+Hello by name and time of day.\n`;

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-strip-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  fs.mkdirSync(path.dirname(path.join(dir, REL)), { recursive: true });
  fs.writeFileSync(path.join(dir, REL), OLD);
  return dir;
}

test("a patch made by makePatch uses -p2 and an ordinary git diff uses -p1", () => {
  assert.equal(patchStrip(makePatch(REL, OLD, NEW)), "-p2");
  assert.equal(patchStrip(ORDINARY), "-p1");
});

test("both patch forms apply to the working tree", () => {
  for (const patch of [makePatch(REL, OLD, NEW), ORDINARY]) {
    const dir = repo();
    try {
      assert.equal(patchApplies(dir, patch), true);
      applyPatch(dir, patch);
      assert.equal(fs.readFileSync(path.join(dir, REL), "utf8"), NEW);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test("a patch whose context does not match is reported as not applying", () => {
  const dir = repo();
  try { assert.equal(patchApplies(dir, ORDINARY.replace("-Hello by name.", "-Something else.")), false); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
