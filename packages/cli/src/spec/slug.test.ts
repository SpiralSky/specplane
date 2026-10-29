import assert from "node:assert/strict";
import { test } from "node:test";
import { findHeading, hasAnchor, slugify } from "./slug.js";

const body = "# T\n\n## 5. Config loading (`config.ts`)\n\n### Sub part\n\n```\n## not a heading\n```\n";

test("slugify is GitHub-style", () => {
  assert.equal(slugify("Config loading (`config.ts`)"), "config-loading-configts");
});

test("findHeading ignores section numbers, code markup and case; accepts prefixes", () => {
  assert.ok(findHeading(body, "Config loading"));
  assert.ok(findHeading(body, "config LOADING (`config.ts`)"));
  assert.ok(findHeading(body, "Sub part"));
  assert.equal(findHeading(body, "not a heading"), undefined);
  assert.equal(findHeading(body, "Conf"), undefined);
});

test("hasAnchor accepts slugs and heading text", () => {
  assert.ok(hasAnchor(body, "sub-part"));
  assert.ok(hasAnchor(body, "Sub part"));
  assert.ok(!hasAnchor(body, "missing"));
});
