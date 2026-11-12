import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { AmbiguousSpecError } from "../errors.js";
import { findSpecId } from "../verify/implementation.js";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { makeRepo } from "../test-repo.js";
import { specLayer, splitSpecWriteId, prepareSpecChange, writeSpecification } from "./write.js";
import type { Ctx } from "./human.js";

/** Harness spec writes by qualified ID (`later-releases R39.1`, `R39.3`). */
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const text = (id: string) => `---\nid: ${id}\ntitle: T\nauthors: []\nreferences: []\n---\n\n## R1: X\n\nBody.\n`;

function setup(): Ctx {
  const root = makeRepo({
    ".specplane/config.yaml": "subprojects:\n  - {name: claude, path: sub/claude}\n",
    "docs/requirements/product.md": "# Requirements\n\n**R1: X**\nX.\n",
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "-c", "user.name=T", "-c", "user.email=t@e.x", "commit", "-qm", "init");
  return { root, actor: { kind: "human", role: "standard-user", name: "Test User" }, preset: DEFAULT_PRESET };
}

test("a qualified ID names the layer and the subproject folder", () => {
  assert.equal(specLayer("claude:feature/harness"), "feature");
  assert.deepEqual(splitSpecWriteId("root:feature/a"), { project: null, local: "feature/a", layer: "feature" });
  assert.throws(() => specLayer("claude:harness"), /must be/);
});

test("spec create and delete work in a subproject folder; the frontmatter id stays local", () => {
  const ctx = setup();
  const id = "claude:feature/harness";
  const made = writeSpecification(ctx, "create", prepareSpecChange(ctx, "create", { spec: id, text: text("feature/harness") }));
  assert.equal(made.ok, true, made.reasons.join(";"));
  assert.ok(fs.existsSync(path.join(ctx.root, "sub/claude/features/harness.md")));
  assert.ok(!fs.existsSync(path.join(ctx.root, "docs/specifications/features/harness.md")));
  const arch = writeSpecification(ctx, "create", prepareSpecChange(ctx, "create", { spec: "claude:architecture/impl", text: text("architecture/impl") }));
  assert.equal(arch.ok, true);
  assert.ok(fs.existsSync(path.join(ctx.root, "sub/claude/architecture/impl.md")));
  assert.throws(() => prepareSpecChange(ctx, "create", { spec: id, text: text("feature/harness") }), /already exists/);
  assert.throws(() => prepareSpecChange(ctx, "create", { spec: "claude:feature/other", text: text("claude:feature/other") }), /must match|ID/);
  const del = writeSpecification(ctx, "delete", prepareSpecChange(ctx, "delete", { spec: id }));
  assert.equal(del.ok, true);
  assert.ok(!fs.existsSync(path.join(ctx.root, "sub/claude/features/harness.md")));
});

test("an undeclared subproject is refused and a section edit works by qualified ID", () => {
  const ctx = setup();
  assert.throws(() => prepareSpecChange(ctx, "create", { spec: "nope:feature/a", text: text("feature/a") }), /Unknown subproject/);
  const id = "claude:feature/harness";
  writeSpecification(ctx, "create", prepareSpecChange(ctx, "create", { spec: id, text: text("feature/harness") }));
  git(ctx.root, "add", "-A"); git(ctx.root, "-c", "user.name=T", "-c", "user.email=t@e.x", "commit", "-qm", "x");
  const edit = prepareSpecChange(ctx, "edit", { spec: id, section: "R1", text: "## R1: X\n\nChanged." });
  assert.match(edit.after!, /Changed\./);
});

test("a bare slug that names a root and a subproject spec is ambiguous, not missing", () => {
  const ids = ["feature/harness", "claude:feature/harness", "feature/other"];
  assert.throws(() => findSpecId(ids, "harness"), AmbiguousSpecError);
  assert.equal(findSpecId(ids, "other"), "feature/other");
  assert.equal(findSpecId(ids, "claude:feature/harness"), "claude:feature/harness");
  assert.throws(() => findSpecId(ids, "harness"), /Use the qualified ID/);
});
