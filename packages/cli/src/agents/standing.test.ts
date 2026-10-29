import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStanding, standingText, upsertBlock } from "./standing.js";

test("creates, then leaves unchanged", () => {
  const a = upsertBlock(null);
  assert.equal(a.action, "created");
  assert.equal(upsertBlock(a.content).action, "unchanged");
  assert.equal(checkStanding(a.content), "ok");
});

test("appends after existing text and preserves it", () => {
  const r = upsertBlock("# Mine\n");
  assert.equal(r.action, "appended");
  assert.ok(r.content.startsWith("# Mine\n\n<!-- specplane:begin v1"));
});

test("updates a changed block, preserving CRLF and surrounding text", () => {
  const base = upsertBlock("before\r\n").content.replace("one step at a time", "many steps");
  assert.equal(checkStanding(base), "outdated");
  const r = upsertBlock(base);
  assert.equal(r.action, "updated");
  assert.ok(r.content.includes("\r\n") && !/[^\r]\n/.test(r.content));
  assert.ok(r.content.startsWith("before\r\n"));
  assert.equal(checkStanding(r.content), "ok");
});

test("malformed markers are not touched", () => {
  const bad = "<!-- specplane:begin v1 — x -->\ntext\n";
  assert.equal(upsertBlock(bad).action, "malformed");
  assert.equal(checkStanding(bad), "malformed");
});

test("missing and workflow-line variants", () => {
  assert.equal(checkStanding(null), "missing");
  assert.equal(checkStanding("# nothing"), "missing");
  assert.ok(standingText("use /x.").endsWith("use /x."));
});
