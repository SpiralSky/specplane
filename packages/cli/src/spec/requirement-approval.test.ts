import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { makeRepo } from "../test-repo.js";
import { validateProject } from "../verify/validate.js";
import { approveSpecs, reopenSpec, type Ctx } from "./human.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, resolveCite } from "./project.js";
import { parseCite } from "./cites.js";
import { committedSource } from "./source.js";

const reqPath = "docs/requirements/product.md";
const reqId = "requirement/product";
const body = "# Requirements\n\n**R1: Export**\nExport the data.\n\n**R2: Import**\nImport the data.\n";
const doc = (id: string, text: string, refs = "") =>
  `---\nid: ${id}\ntitle: Example\nstatus: awaiting-review\nauthors: []\nreferences: [${refs}]\n---\n\n${text}`;
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = (root: string) => { git(root, "add", "-A"); git(root, "commit", "-qm", "fixture"); };
function setup(cite = "R1", requirement = doc(reqId, body)): Ctx {
  const root = makeRepo({
    [reqPath]: requirement,
    "docs/specifications/features/export.md": doc("feature/export", "## §1 Export\nExport data.\n", cite),
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.com");
  commit(root);
  return { root, actor: { kind: "human", role: "standard-user", name: "Test User" }, preset: DEFAULT_PRESET };
}

for (const cite of ["R1", "product.md#R1", reqId]) {
  test(`approval enforces requirement status for ${cite}`, async () => {
    const ctx = setup(cite);
    const denied = await approveSpecs(ctx, ["feature/export"]);
    assert.equal(denied.ok, false);
    assert.match(denied.reasons.join(), /requirement\/product.*awaiting-review/);
    const approved = await approveSpecs(ctx, [reqId]);
    assert.ok(approved.ok, approved.reasons.join());
    const feature = await approveSpecs(ctx, ["feature/export"]);
    assert.ok(feature.ok, feature.reasons.join());
    const reopened = reopenSpec(ctx, reqId);
    assert.ok(reopened.ok, reopened.reasons.join());
    const status = validateProject(ctx.root).statuses.find((s) => s.id === "feature/export")!;
    assert.equal(status.effective, "awaiting-review");
    assert.ok(status.reasons.includes(`unapproved-dependency: ${cite}`));
  });
}

test("plain requirements remain readable but cannot implicitly approve a dependent", async () => {
  const ctx = setup("R1", body);
  const report = validateProject(ctx.root);
  assert.equal(report.counts.errors, 0, JSON.stringify(report.findings));
  assert.equal(report.statuses.find((s) => s.id === reqId)?.effective, "awaiting-review");
  const result = await approveSpecs(ctx, ["feature/export"]);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(), /requirement\/product.*awaiting-review/);
});

test("requirement metadata is validated while local and retired IDs are not dependencies", () => {
  const ctx = setup("R1", doc(reqId, `${body}\nSee \`R1\`.\n\nRetired IDs: \`R9\`.\n`));
  assert.equal(validateProject(ctx.root).counts.errors, 0);
  fs.writeFileSync(path.join(ctx.root, reqPath), "---\nid: [\n---\n" + body);
  const report = validateProject(ctx.root);
  assert.ok(report.findings.some((f) => f.file === reqPath && f.rule === "spec-format" && f.severity === "error"));
});

test("approval checks committed requirement changes while existing citations track only their part", async () => {
  const ctx = setup();
  assert.ok((await approveSpecs(ctx, [reqId])).ok);
  assert.ok((await approveSpecs(ctx, ["feature/export"])).ok);
  const file = path.join(ctx.root, reqPath);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Import the data.", "Import only CSV."));
  commit(ctx.root);
  let report = validateProject(ctx.root);
  assert.equal(report.statuses.find((s) => s.id === reqId)?.effective, "awaiting-review");
  assert.equal(report.statuses.find((s) => s.id === "feature/export")?.effective, "approved");
  assert.equal((await approveSpecs(ctx, ["feature/export"])).ok, false);
  assert.ok((await approveSpecs(ctx, [reqId])).ok);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Export the data.", "Export only CSV."));
  commit(ctx.root);
  report = validateProject(ctx.root);
  assert.ok(report.statuses.find((s) => s.id === "feature/export")?.reasons.includes("outdated: R1"));
});

test("requirement and feature cycles use the same atomic group approval", async () => {
  const ctx = setup("R1", doc(reqId, body, "export §1"));
  const unconfirmed = await approveSpecs(ctx, ["feature/export"]);
  assert.equal(unconfirmed.ok, false);
  const confirmed = await approveSpecs(ctx, ["feature/export"], { yes: true });
  assert.ok(confirmed.ok, confirmed.reasons.join());
  assert.equal(confirmed.written.length, 2);
});

test("whole-file cites cannot approve requirements excluded from the central index", () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.root, "docs/requirements/other.md"), doc("requirement/other", body));
  fs.mkdirSync(path.join(ctx.root, ".specplane"), { recursive: true });
  fs.writeFileSync(path.join(ctx.root, ".specplane/config.yaml"), "paths:\n  requirements_index: product.md\n");
  commit(ctx.root);
  const project = loadProject(committedSource(ctx.root, "HEAD"), loadSpecPaths(ctx.root).paths);
  assert.equal(resolveCite(project, parseCite("requirement/other")!).ok, false);
});
