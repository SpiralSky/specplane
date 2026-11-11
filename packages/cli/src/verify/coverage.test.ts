import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadProject } from "../spec/project.js";
import { loadSpecPaths } from "../spec/paths.js";
import { worktreeSource } from "../spec/source.js";
import { computeCoverage, formatCoverage } from "./coverage.js";
import { collectWarnings, narrowWarnings } from "./warnings.js";
import { RULES } from "./rules/index.js";

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-coverage-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "c");
  return root;
}
const REQ = "---\nid: requirement/product-requirements\n---\n\n**R1: One**\nText\n\n*R1.1: Sub*\nSub\n\n**R2: Two**\nMore\n\n**R3: Three**\nMore\n";
const spec = (id: string, extra: string, body = "Text.\n") => `---\nid: ${id}\ntitle: T ${id}\nauthors: []\n${extra}---\n\n## R1: Heading\n\n${body}`;
const coverage = (root: string, only: string[] = []) => computeCoverage(loadProject(worktreeSource(root), loadSpecPaths(root).paths), only);
const item = (c: ReturnType<typeof coverage>, id: string) => c.items.find((i) => i.id === id)!;

test("an uncovered requirement and feature spec are reported; a cite of a parent covers its sub-requirements", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec("feature/alpha", "covers: [R1]\nreferences: []\n"),
    "docs/specifications/features/beta.md": spec("feature/beta", "covers: [R2]\nreferences: []\n"),
    "docs/specifications/architecture/arch.md": spec("architecture/arch", "implements: [alpha R1]\nreferences: []\n"),
  });
  const c = coverage(root);
  assert.deepEqual(c.uncovered.map((i) => i.id).sort(), ["R3", "feature/beta"]);
  assert.deepEqual(item(c, "R1.1").coveredBy, ["feature/alpha"]);
  assert.deepEqual(item(c, "feature/alpha").coveredBy, ["architecture/arch"]);
  assert.deepEqual(c.covers.find((x) => x.spec === "feature/alpha")!.items, ["R1", "R1.1"]);
  assert.ok(formatCoverage(c, true).some((l) => l.startsWith("R3 ") && l.includes("uncovered")));
});

test("requirement_only annotates an item but it stays uncovered and counted", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec("feature/alpha", "covers: [R1, R2]\nreferences: []\n"),
    "docs/specifications/architecture/arch.md": spec("architecture/arch", "implements: [alpha R1]\nreferences: []\n"),
  });
  const c = coverage(root, ["R3"]);
  assert.equal(item(c, "R3").requirementOnly, true);
  assert.ok(c.uncovered.some((i) => i.id === "R3"));
  assert.ok(formatCoverage(c, true).some((l) => l.includes("requirement-only by configuration")));
});

test("an absent layer is skipped; several coverers are all shown", () => {
  const featuresOnly = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec("feature/alpha", "covers: [R1]\nreferences: [R2]\n", "See `R2`.\n"),
    "docs/specifications/features/beta.md": spec("feature/beta", "covers: [R1]\nreferences: []\n"),
  });
  const c = coverage(featuresOnly);
  assert.deepEqual(c.skipped, ["architecture"]);
  assert.ok(!c.items.some((i) => i.kind === "feature"));
  assert.deepEqual(item(c, "R1").coveredBy, ["feature/alpha", "feature/beta"]);

  const noRequirements = repo({
    "docs/specifications/features/alpha.md": spec("feature/alpha", "references: []\n"),
    "docs/specifications/architecture/arch.md": spec("architecture/arch", "implements: [alpha R1]\nreferences: []\n"),
  });
  const n = coverage(noRequirements);
  assert.deepEqual(n.items.map((i) => i.id), ["feature/alpha"]);
  assert.deepEqual(n.uncovered, []);
});

test("warnings include uncovered items, narrow by ID and carry subject and why", () => {
  const root = repo({
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec("feature/alpha", "covers: [R1]\nreferences: []\n"),
    "docs/specifications/architecture/arch.md": spec("architecture/arch", "implements: [alpha R1]\nreferences: []\n"),
  });
  const all = collectWarnings(root, { auditUnwritable: true });
  assert.ok(all.every((w) => w.text && w.why && ["spec", "plan", "permission", "installation"].includes(w.subject)));
  assert.deepEqual(narrowWarnings(all, "R3").map((w) => w.subject), ["spec"]);
  assert.ok(all.some((w) => w.subject === "installation" && /audit log/.test(w.text)));
});

test("the registry has one rule per family, status before notes", () => {
  const ids = RULES.map((r) => r.id);
  assert.deepEqual(ids, ["config", "requirements", "spec-format", "cites", "plans", "status", "notes", "tests", "permissions", "harness"]);
  assert.ok(RULES.every((r) => typeof r.run === "function" && r.severity && r.source));
});

const run = (root: string, ...args: string[]): { out: string; code: number } => {
  try { return { out: execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 }; }
  catch (e) { const x = e as { stdout: string; status: number }; return { out: x.stdout, code: x.status }; }
};

test("auto warn: last text line carries the count, JSON carries warning_count, auto_warn off removes both", () => {
  const files = {
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec("feature/alpha", "covers: [R1]\nreferences: []\n"),
  };
  const root = repo(files);
  const text = run(root, "config", "get", "auto_warn");
  assert.match(text.out.trimEnd().split("\n").pop()!, /^\d+ warnings?; run `specplane warnings`$/);
  const json = JSON.parse(run(root, "config", "get", "auto_warn", "--json").out) as { warning_count: number };
  assert.ok(json.warning_count >= 2, "R2 and R3 are uncovered");
  assert.match(run(root, "coverage", "--uncovered").out, /R2 .*uncovered/);
  const off = repo({ ...files, ".specplane/config.yaml": "auto_warn: off\n" });
  assert.ok(!/^\d+ warnings?/m.test(run(off, "config", "get", "auto_warn").out));
  assert.equal("warning_count" in JSON.parse(run(off, "config", "get", "auto_warn", "--json").out), false);
});

test("auto warn: a collector failure prints `warnings unavailable` and keeps the status", async () => {
  const { runCommand } = await import("../commands/runner.js");
  const root = repo({ "docs/requirements/product-requirements.md": REQ });
  const cwd = process.cwd();
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => { chunks.push(String(s)); return true; }) as typeof process.stdout.write;
  const prev = process.exitCode;
  try {
    process.chdir(root);
    await runCommand({ command: "validate", collect: () => { throw new Error("boom"); } }, () => ({ ok: true, lines: ["done"] }));
    assert.equal(process.exitCode ?? 0, 0);
  } finally { process.stdout.write = write; process.chdir(cwd); process.exitCode = prev; }
  assert.equal(chunks.join(""), "done\nwarnings unavailable\n");
});
