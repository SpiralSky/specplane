import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sp = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const REQ = "---\nid: requirement/product-requirements\n---\n\n**R1: One**\nText\n\n**R2: Two**\nMore\n";
const spec = (id: string, extra: string) => `---\nid: ${id}\ntitle: T ${id}\nauthors: [{human: ann}]\n${extra}---\n\n## R1: Heading\n\nText.\n`;

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-spec-read-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "tester");
  git(root, "config", "user.email", "t@t");
  const files: Record<string, string> = {
    "docs/requirements/product-requirements.md": REQ,
    "docs/specifications/features/alpha.md": spec("feature/alpha", "covers: [R1]\nreferences: []\n"),
    "docs/specifications/features/beta.md": spec("feature/beta", "covers: [R2]\nreferences: []\n"),
    "docs/specifications/architecture/arch.md": spec("architecture/arch", "implements: [alpha R1]\nreferences: []\n"),
  };
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "c");
  return root;
}

test("spec list shows every spec with effective status, and filters by status and type", () => {
  const root = repo();
  try {
    const all = JSON.parse(sp(root, "spec", "list", "--json").out);
    assert.deepEqual(all.data.map((v: { id: string }) => v.id), ["architecture/arch", "feature/alpha", "feature/beta"]);
    assert.ok(all.data.every((v: { status: string; reasons: string[] }) => v.status === "awaiting-review" && v.reasons[0] === "never-approved"));
    assert.deepEqual(all.data[1].authors, ["human:ann"]);
    assert.equal(all.data[1].implementation, null);
    assert.equal(all.data[0].implementation.status, "unimplemented");
    const arch = JSON.parse(sp(root, "spec", "list", "--json", "--type", "architecture").out);
    assert.equal(arch.data.length, 1);
    assert.equal(JSON.parse(sp(root, "spec", "list", "--json", "--status", "approved").out).data.length, 0);
    const text = sp(root, "spec", "list");
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /feature\/alpha\s+awaiting-review \(never-approved\)/);
    assert.match(text.out, /architecture\/arch .*implementation: unimplemented/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("spec show reads approval from the notes store and notes uncommitted edits; an unknown id exits 1", () => {
  const root = repo();
  try {
    const a = sp(root, "spec", "approve", "feature/alpha", "--yes");
    assert.equal(a.code, 0, a.err + a.out);
    fs.appendFileSync(path.join(root, "docs/specifications/features/alpha.md"), "More.\n");
    const shown = sp(root, "spec", "show", "alpha");
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /status: approved/);
    assert.match(shown.out, /approved by: human:tester on \d{4}-\d{2}-\d{2}/);
    assert.match(shown.out, /note: uncommitted changes are ignored/);
    const json = JSON.parse(sp(root, "spec", "show", "feature/alpha", "--json").out);
    assert.equal(json.data.approver, "human:tester");
    assert.deepEqual(json.data.results, []);
    const missing = sp(root, "spec", "show", "feature/nope");
    assert.equal(missing.code, 1);
    assert.match(missing.err, /not found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("spec new, spec validate and the old spec flags are gone", () => {
  const root = repo();
  try {
    assert.equal(sp(root, "spec", "new", "feature", "x").code, 2);
    assert.equal(sp(root, "spec", "validate").code, 2);
    assert.equal(sp(root, "spec", "list", "--root", "base").code, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
