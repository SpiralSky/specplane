import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/cli/dist
const repoRoot = path.resolve(here, "..", "..", "..");
const cli = path.join(here, "cli.js");
const sp = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: "utf8" });

// The only cite errors left are example cites written in backticks inside approved specs
// (docs/work-records/2026-11-09-cli-step1-notes.md); they are not edited here.
const KNOWN_EXAMPLE_CITES = new Set(["file:docs/x.md", "architecture/cli R16", "b R7", "b R9", "root:R7"]);

test("validate on the specs-framework repository reports no format or requirement errors and only the known example-cite errors", () => {
  let out: string;
  try { out = sp("validate", "--json"); } catch (e) { out = (e as { stdout: string }).stdout; }
  const report = (JSON.parse(out) as { data: { findings: { severity: string; rule: string; message: string }[]; checked: string[] } }).data;
  // Every spec file and requirement file in the repository is checked; INFO.md is not a spec.
  // The registered subprojects (claude and codex) keep their specs under harnesses/<name>/specifications.
  const specFiles = ["docs/specifications/architecture", "docs/specifications/features", "docs/requirements",
    "harnesses/claude/specifications/architecture", "harnesses/claude/specifications/features",
    "harnesses/codex/specifications/architecture", "harnesses/codex/specifications/features"]
    .flatMap((dir) => fs.readdirSync(path.join(repoRoot, dir)).filter((n) => n.endsWith(".md") && n !== "INFO.md"));
  assert.equal(report.checked.length, specFiles.length, "one entry per spec or requirement file");
  const errors = report.findings.filter((f) => f.severity === "error");
  assert.deepEqual(errors.filter((f) => f.rule !== "cites"), []);
  for (const f of errors) {
    const cite = /`([^`]+)`/.exec(f.message)?.[1] ?? "";
    assert.ok(KNOWN_EXAMPLE_CITES.has(cite), `unexpected cite error: ${f.message}`);
  }
});

test("plan index is gone: PLANS.md is not part of the new plan system", () => {
  assert.throws(() => sp("plan", "index", "--print"));
});

test("spec pin is gone: base pins are not part of the new format", () => {
  assert.throws(() => sp("spec", "pin", "--check"));
});
