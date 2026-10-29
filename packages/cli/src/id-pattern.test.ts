import assert from "node:assert/strict";
import { test } from "node:test";
import { ID_PATTERN } from "./schemas.js";

const re = new RegExp(ID_PATTERN);

test("ID pattern accepts valid IDs", () => {
  for (const id of ["feature/ab", "architecture/file-formats", "feature/a/b-c", "feature/x1"]) assert.ok(re.test(id), id);
});

test("ID pattern rejects invalid IDs", () => {
  for (const id of ["feature//x", "feature/x", "feature/ab//cd", "feature/-ab", "feature/ab-", "claude:feature/x", "Feature/ab", "plan/ab"]) {
    assert.ok(!re.test(id), id);
  }
});

test("qualified IDs resolve through the root prefix", async () => {
  const { DEFAULT_CONFIG } = await import("./config.js");
  const { resolveSpecId } = await import("./spec/resolve.js");
  const cfg = { ...DEFAULT_CONFIG, spec_roots: [{ name: "claude", path: "docs/specifications" }] };
  assert.throws(() => resolveSpecId("claude:feature/x", cfg, undefined, "/nonexistent"), /not found/);
  assert.throws(() => resolveSpecId("claude:feature//x", cfg, undefined, "/nonexistent"), /not found/);
});
