import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/cli/dist
const repoRoot = path.resolve(here, "..", "..", "..");
const cli = path.join(here, "cli.js");
const sp = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: "utf8" });

test("validate exits 0 on the specs-framework repository", () => {
  sp("validate"); // throws on non-zero exit
});

test("generate --print emits Active plans and a Mermaid block, deterministically", () => {
  const out = sp("generate", "--print");
  assert.match(out, /## Active plans/);
  assert.match(out, /```mermaid\ngraph TD/);
  assert.equal(sp("generate", "--print"), out);
});
