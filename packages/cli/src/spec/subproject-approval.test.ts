import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { makeRepo } from "../test-repo.js";
import { computeCoverage } from "../verify/coverage.js";
import { recordResults } from "../verify/test-record.js";
import { validateProject } from "../verify/validate.js";
import { citeKey } from "./cites.js";
import { approveSpecs, overrideSpec, reopenSpec, type Ctx } from "./human.js";
import { readNotes } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { findDoc, loadProject } from "./project.js";
import { currentResults } from "./results.js";
import { committedSource } from "./source.js";
import { StatusCtx } from "./status.js";

/** End to end: a root project and one declared subproject `claude` (`later-releases R39`). */
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = (root: string) => { git(root, "add", "-A"); git(root, "commit", "-qm", "change"); };
const front = (id: string, extra: string) => `---\nid: ${id}\ntitle: T\nauthors: []\n${extra}\n---\n\n`;
const SUB_FEATURE = "sub/claude/features/harness.md";
const SUB_ARCH = "sub/claude/architecture/impl.md";
const FEATURE = "docs/specifications/features/export.md";
const HARNESS = "claude:feature/harness";
const IMPL = "claude:architecture/impl";

function setup(): Ctx {
  const root = makeRepo({
    ".specplane/config.yaml": "subprojects:\n  - {name: claude, path: sub/claude}\n",
    "docs/requirements/product.md": "# Requirements\n\n**R1: Harness**\nIntegrate.\n\n**R2: Export**\nExport the data.\n",
    [FEATURE]: front("feature/export", `covers: [R2]\nreferences: ["${HARNESS} R1"]`) + "## R2: Export\n\nExport. Needs `claude:feature/harness R1`.\n",
    [SUB_FEATURE]: front("feature/harness", "covers: [root:R1]\nreferences: []") + "## R1: Harness\n\nIntegrates.\n",
    [SUB_ARCH]: front("architecture/impl", "implements: [feature/harness R1]\nreferences: []") + "## R1: Check\n\nTest T1 (deterministic): passes.\n\n```specplane-test\nrun: [\"true\"]\n```\n",
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.com");
  commit(root);
  return { root, actor: { kind: "human", role: "standard-user", name: "Test User" }, preset: DEFAULT_PRESET };
}
const status = (root: string, id: string) => validateProject(root).statuses.find((s) => s.id === id)!;

test("a subproject spec is approved by its qualified ID and a dependent root spec is held until then", async () => {
  const ctx = setup();
  const early = await approveSpecs(ctx, ["feature/export"]);
  assert.equal(early.ok, false);
  assert.match(early.reasons.join(), /claude:feature\/harness/);
  assert.equal(status(ctx.root, HARNESS).effective, "awaiting-review");
  assert.ok((await approveSpecs(ctx, [HARNESS])).ok);
  assert.equal(readNotes(ctx.root).bySpec.get(HARNESS)?.[0].rec.kind, "approval");
  assert.equal(status(ctx.root, HARNESS).effective, "approved");
  assert.ok((await approveSpecs(ctx, ["feature/export"])).ok);
  assert.equal(status(ctx.root, "feature/export").effective, "approved");
  assert.equal(validateProject(ctx.root).counts.errors, 0);
});

test("a cite of a subproject spec is a dependency: its reopening holds the dependent, its edit makes it outdated", async () => {
  const ctx = setup();
  await approveSpecs(ctx, [HARNESS]);
  await approveSpecs(ctx, ["feature/export"]);
  assert.ok(reopenSpec(ctx, HARNESS).ok);
  assert.deepEqual(status(ctx.root, "feature/export").reasons, [`unapproved-dependency: ${HARNESS} R1`]);
  assert.ok((await approveSpecs(ctx, [HARNESS])).ok);
  assert.equal(status(ctx.root, "feature/export").effective, "approved");
  fs.appendFileSync(path.join(ctx.root, SUB_FEATURE), "\nChanged.\n");
  git(ctx.root, "commit", "-qam", "edit");
  assert.equal(status(ctx.root, HARNESS).effective, "awaiting-review");
  assert.deepEqual(status(ctx.root, "feature/export").reasons, [`outdated: ${HARNESS} R1`]);
});

test("override and a plain cite inside the subproject work by qualified ID", async () => {
  const ctx = setup();
  const o = overrideSpec({ ...ctx, actor: { ...ctx.actor, role: "administrator" } }, "status", IMPL, ["approved"]);
  assert.ok(o.ok, o.reasons.join());
  assert.equal(readNotes(ctx.root).bySpec.get(IMPL)?.[0].rec.kind, "override");
  // `feature/harness R1` is a plain cite in the subproject; the dependency is the subproject's own spec, still unapproved.
  assert.deepEqual(status(ctx.root, IMPL).reasons, [`unapproved-dependency: feature/harness R1`]);
});

test("coverage names subproject items and lets a subproject spec cover a root requirement", () => {
  const ctx = setup();
  const c = computeCoverage(loadProject(committedSource(ctx.root, "HEAD"), loadSpecPaths(ctx.root).paths));
  const by = (id: string) => c.items.find((i) => i.id === id)?.coveredBy;
  assert.deepEqual(by("R1"), [HARNESS]);
  assert.deepEqual(by("R2"), ["feature/export"]);
  assert.deepEqual(by(HARNESS), [IMPL]);
  assert.deepEqual(by("feature/export"), []);
  assert.equal(c.uncovered.length, 1);
});

test("test records of a subproject spec are kept per qualified ID and outdated by an edit", () => {
  const ctx = setup();
  const head = git(ctx.root, "rev-parse", "HEAD");
  const r = recordResults(ctx, head, [{ spec: IMPL, test: "R1#T1", kind: "deterministic", outcome: "passed", summary: "Ran true." }]);
  assert.deepEqual(r.recorded, ["R1#T1"]);
  const results = () => { const h = loadProject(committedSource(ctx.root, "HEAD"), loadSpecPaths(ctx.root).paths); return currentResults(new StatusCtx(ctx.root, h), findDoc(h, IMPL)!); };
  assert.equal(results().get("R1#T1")?.outcome, "passed");
  fs.appendFileSync(path.join(ctx.root, SUB_ARCH), "\nChanged.\n");
  git(ctx.root, "commit", "-qam", "edit");
  assert.equal(results().size, 0);
});

test("validation scoped to spec IDs includes subproject specs", () => {
  const ctx = setup();
  const r = validateProject(ctx.root, { ids: [HARNESS] });
  assert.deepEqual(r.checked, [HARNESS]);
  assert.deepEqual(r.statuses.map((s) => s.id), [HARNESS]);
});

test("citeKey keeps root:X and X apart inside a subproject only", () => {
  assert.equal(citeKey("root:R1"), citeKey("R1"));
  assert.notEqual(citeKey("root:R1", true), citeKey("R1", true));
});
