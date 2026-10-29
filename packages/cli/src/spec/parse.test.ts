import assert from "node:assert/strict";
import { test } from "node:test";
import { FrontmatterError, FrontmatterMissingError } from "../errors.js";
import { fixture } from "../fixtures.js";
import { isInfoFile, parseSpec } from "./parse.js";

const valid = (f: string) => fixture("specs/base", f);
const invalid = (f: string) => fixture("specs/invalid", f);

test("parses a feature spec", () => {
  const { frontmatter, body } = parseSpec(valid("features/spec-system.md"));
  assert.equal(frontmatter.id, "feature/spec-system");
  assert.equal(frontmatter.status, "approved");
  assert.match(body, /# Spec system/);
});

test("parses a feature spec with allow_architecture and based_on", () => {
  const { frontmatter } = parseSpec(valid("features/with-arch.md"));
  assert.equal(frontmatter.allow_architecture, true);
  assert.deepEqual(frontmatter.based_on, { "feature/spec-system": "a1b2c3d" });
});

test("parses an architecture spec", () => {
  const { frontmatter } = parseSpec(valid("architecture/reference-cli.md"));
  assert.deepEqual(frontmatter.implements, ["feature/spec-system"]);
  assert.equal(frontmatter.extends, "base:architecture/other");
});

test("missing required field throws FrontmatterError naming the field", () => {
  assert.throws(() => parseSpec(invalid("missing-id.md")), (e) => e instanceof FrontmatterError && /`id`/.test(e.message));
});

test("bad enum, missing reason, missing implements, bad YAML throw FrontmatterError", () => {
  for (const f of ["bad-status.md", "no-reason.md", "no-implements.md", "bad-yaml.md"]) {
    assert.throws(() => parseSpec(invalid(f)), FrontmatterError, f);
  }
});

test("file without frontmatter throws FrontmatterMissingError", () => {
  assert.throws(() => parseSpec(invalid("no-frontmatter.md")), FrontmatterMissingError);
});

test("isInfoFile is exact and case-sensitive", () => {
  assert.equal(isInfoFile("a/features/INFO.md"), true);
  assert.equal(isInfoFile("a/features/info.md"), false);
});
