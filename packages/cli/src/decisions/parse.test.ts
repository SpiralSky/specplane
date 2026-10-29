import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config.js";
import { fixture } from "../fixtures.js";
import { listAdrs } from "./parse.js";

test("listAdrs reads NNNN-*.md and keeps dates as strings", () => {
  const adrs = listAdrs(DEFAULT_CONFIG, fixture("plans-repo"));
  assert.equal(adrs.length, 1);
  assert.equal(adrs[0].number, "0001");
  assert.equal(adrs[0].frontmatter.date, "2026-10-01");
  assert.equal(adrs[0].frontmatter.status, "accepted");
});

test("absent decisions directory yields no ADRs", () => {
  assert.deepEqual(listAdrs(DEFAULT_CONFIG, fixture("configs")), []);
});
