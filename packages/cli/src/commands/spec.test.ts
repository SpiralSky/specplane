import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const fm = (id: string, extra: Record<string, unknown> = {}) => spec({ id, title: `T ${id}`, status: "draft", author: "user", ...extra });

/** Temp git repository with roots base (`specs`) and ext (`ext-specs`, extends base). */
function repo(): string {
  const root = makeRepo({
    ".specplane/config.yaml": CONFIG,
    "specs/features/alpha.md": fm("feature/alpha"),
    "specs/features/shared.md": fm("feature/shared"),
    "ext-specs/features/shared.md": fm("feature/shared", { extends: "feature/shared" }),
    "ext-specs/features/beta.md": fm("feature/beta", { status: "approved" }),
  });
  spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}
const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test("spec new feature writes a draft that validates (base and overlay roots)", () => {
  const root = repo();
  const a = run(root, "spec", "new", "feature", "My-Thing", "--title", "My thing");
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /^Created specs\/features\/my-thing\.md$/m);
  const text = fs.readFileSync(path.join(root, "specs/features/my-thing.md"), "utf8");
  assert.match(text, /id: feature\/my-thing\ntitle: "My thing"\nstatus: draft\nauthor: user\n/);
  const b = run(root, "spec", "new", "feature", "gamma", "--root", "ext", "--extends", "feature/alpha");
  assert.equal(b.code, 0, b.err);
  assert.match(fs.readFileSync(path.join(root, "ext-specs/features/gamma.md"), "utf8"), /title: "Gamma"/);
  const v = run(root, "spec", "validate", "feature/my-thing", "ext:feature/gamma");
  assert.equal(v.code, 0, v.err);
});

test("spec new architecture needs --implements without a TTY", () => {
  const root = repo();
  const r = run(root, "spec", "new", "architecture", "arch");
  assert.equal(r.code, 1);
  assert.equal(r.err, "Architecture spec needs `--implements`.\n");
  const ok = run(root, "spec", "new", "architecture", "arch", "--implements", "feature/alpha");
  assert.equal(ok.code, 0, ok.err);
  assert.match(fs.readFileSync(path.join(root, "specs/architecture/arch.md"), "utf8"), /implements: \["feature\/alpha"\]/);
  assert.equal(run(root, "spec", "validate", "architecture/arch").code, 0);
});

test("spec new error texts", () => {
  const root = repo();
  assert.equal(run(root, "spec", "new", "feature", "alpha").err, "Spec `feature/alpha` already exists.\n");
  // exists in the extends chain of the target root
  assert.equal(run(root, "spec", "new", "feature", "alpha", "--root", "ext").err, "Spec `feature/alpha` already exists.\n");
  assert.equal(run(root, "spec", "new", "feature", "x", "--root", "nope").err, "Unknown root `nope`.\n");
  const t = run(root, "spec", "new", "plan", "x");
  assert.equal(t.code, 1);
  assert.equal(t.err, "Unknown spec type `plan`: expected `feature` or `architecture`.\n");
});

test("spec list filters and JSON output", () => {
  const root = repo();
  const all = JSON.parse(run(root, "spec", "list", "--json").out) as Array<Record<string, string>>;
  assert.deepEqual(all.map((r) => `${r.root}:${r.id}`), ["base:feature/alpha", "ext:feature/beta", "base:feature/shared", "ext:feature/shared"]);
  assert.deepEqual(Object.keys(all[0]), ["id", "title", "status", "author", "root"]);
  const ext = JSON.parse(run(root, "spec", "list", "--json", "--root", "ext", "--status", "approved").out);
  assert.deepEqual(ext.map((r: { id: string }) => r.id), ["feature/beta"]);
  assert.equal(JSON.parse(run(root, "spec", "list", "--json", "--type", "architecture").out).length, 0);
  const human = run(root, "spec", "list", "--root", "base").out;
  assert.match(human, /^feature\/alpha +T feature\/alpha +draft$/m);
  assert.equal(run(root, "spec", "list", "--root", "zzz").code, 1);
});

test("spec show prints the file; ambiguity and --root", () => {
  const root = repo();
  assert.equal(run(root, "spec", "show", "feature/alpha").out, fs.readFileSync(path.join(root, "specs/features/alpha.md"), "utf8"));
  const amb = run(root, "spec", "show", "feature/shared");
  assert.equal(amb.code, 1);
  assert.equal(amb.err, "Ambiguous ID `feature/shared`: found in roots `base`, `ext`. Use `<root>:feature/shared`.\n");
  assert.match(run(root, "spec", "show", "feature/shared", "--root", "ext").out, /extends: "feature\/shared"/);
  assert.equal(run(root, "spec", "show", "ext:feature/shared").code, 0);
  assert.equal(run(root, "spec", "show", "feature/missing").err, "Spec `feature/missing` not found.\n");
});

test("spec validate: all, named, and JSON", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "specs/features/bad.md"), fm("feature/other"));
  const all = run(root, "spec", "validate", "--json");
  assert.equal(all.code, 1);
  const report = JSON.parse(all.out);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((e: { spec?: string }) => e.spec === "feature/bad" || e.spec === "feature/other"));
  // named validation only reports the named spec
  const named = run(root, "spec", "validate", "feature/alpha", "--json");
  assert.equal(named.code, 0);
  assert.deepEqual(JSON.parse(named.out).errors, []);
  assert.equal(run(root, "spec", "validate", "feature/bad").code, 1);
  // the human report goes to stderr
  assert.match(run(root, "spec", "validate", "feature/alpha").err, /Checking feature\/alpha\.\.\. OK/);
  assert.equal(run(root, "spec", "validate", "feature/nope").err, "Spec `feature/nope` not found.\n");
});

test("spec new scaffold carries the section headings of the file-formats templates and validates", () => {
  const root = repo();
  assert.equal(run(root, "spec", "new", "feature", "scaf").code, 0);
  assert.equal(run(root, "spec", "new", "architecture", "scaf-arch", "--implements", "feature/scaf").code, 0);
  const headings = (f: string) => [...fs.readFileSync(path.join(root, f), "utf8").matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings("specs/features/scaf.md"), ["Rules", "Acceptance scenarios", "Edge cases"]);
  assert.deepEqual(headings("specs/architecture/scaf-arch.md"), ["Components", "Data structures", "Error handling"]);
  const dup = run(root, "spec", "new", "feature", "scaf");
  assert.equal(dup.code, 1);
  assert.equal(dup.err, "Spec `feature/scaf` already exists.\n");
  assert.equal(run(root, "spec", "validate", "feature/scaf", "architecture/scaf-arch").code, 0);
});
