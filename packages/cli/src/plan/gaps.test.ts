import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { parseGaps, parseGapsText } from "./gaps.js";

test("text and file parsers agree on entries and diagnostics", () => {
  const text = "##  G1: Decision\r\n**Kind**: proposal\r\n**Step**: 1\r\n**Case**: c\r\n**Resolution**: r\r\n**Target spec**: `feature/a`, feature/b\r\n**Status**: open\r\n##\tG1: Duplicate\r\n**Kind**: invalid\r\n**Step**: no\r\n**Status**: unknown\r\n## Other\r\n";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaps-parity-"));
  try {
    const file = path.join(dir, "spec-gaps.md");
    fs.writeFileSync(file, text);
    const result = parseGapsText(text);
    assert.deepEqual(parseGaps(file), result);
    assert.deepEqual(result.entries[0].targets, ["feature/a", "feature/b"]);
    assert.equal(result.entries[1].line, 8);
    assert.ok(result.problems.some(p => p.message.includes("duplicated")));
    assert.ok(result.problems.some(p => p.message.includes("heading `Other`")));
    assert.ok(result.problems.some(p => p.message.includes("has Step")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
