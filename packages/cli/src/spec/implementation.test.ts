import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { overrideSpec, type Ctx } from "./human.js";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { makeRepo } from "../test-repo.js";
import { implementationAssessor } from "./completion.js";
import { headContext, implementationState, recordImplementation } from "./implementation.js";
import { readNotes } from "./notes.js";

const sh = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const A = "docs/specifications/architecture";
const arch = (extra = "") => `---\nid: architecture/a\ntitle: A\nauthors:\n  - human: someone\nimplements: []\n---\n\n# A\n\n## §1 Part\n\nText.${extra}\n`;

function repo(files: Record<string, string> = { [`${A}/a.md`]: arch(), "docs/specifications/features/f.md": "---\nid: feature/f\ntitle: F\nauthors:\n  - human: someone\ncovers: []\n---\n\n# F\n" }): string {
  const root = makeRepo(files);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Pat Person");
  sh(root, "config", "user.email", "pat@example.com");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  return root;
}
const state = (root: string) => { const h = headContext(root); return implementationState(h.ctx, h.project.specs.get("architecture/a")!); };

test("an implementation record is written to the notes store, not the spec file, and applies to identical content only", () => {
  const root = repo();
  const before = fs.readFileSync(path.join(root, A, "a.md"), "utf8");
  const preview = recordImplementation(root, "architecture/a", { dryRun: true });
  assert.equal(preview.changed, true);
  assert.equal(state(root).status, "unimplemented");
  const r = recordImplementation(root, "architecture/a");
  assert.equal(fs.readFileSync(path.join(root, A, "a.md"), "utf8"), before);
  assert.equal(state(root).status, "implemented");
  const rec = readNotes(root).bySpec.get("architecture/a")!.at(-1)!.rec;
  assert.deepEqual([rec.kind, rec.status, rec.by, rec.fingerprint], ["implementation", "implemented", { human: "Pat Person" }, r.fingerprint]);
  assert.equal(recordImplementation(root, "architecture/a").changed, false, "repeat appends nothing");
  assert.equal(readNotes(root).bySpec.get("architecture/a")!.length, 1);
  // An edit makes the record outdated; the evidence is kept, not removed.
  fs.writeFileSync(path.join(root, A, "a.md"), arch(" More."));
  sh(root, "commit", "-q", "-am", "edit");
  assert.deepEqual([state(root).status, state(root).outdated], ["unimplemented", true]);
  assert.equal(implementationAssessor(root)("architecture/a").assessment_status, "reassessment_needed");
  // Changing back does not restore it: the commit of the edit lies between (`file-formats` §13.2 rule 2).
  fs.writeFileSync(path.join(root, A, "a.md"), arch());
  sh(root, "commit", "-q", "-am", "revert");
  assert.equal(state(root).status, "unimplemented");
  assert.equal(readNotes(root).bySpec.get("architecture/a")!.length, 1);
});

test("refusals: feature spec, unknown spec, uncommitted change, current failed test result", () => {
  const root = repo();
  assert.throws(() => recordImplementation(root, "feature/f"), /not an architecture spec/);
  assert.throws(() => recordImplementation(root, "architecture/zzz"), /not found/);
  fs.appendFileSync(path.join(root, A, "a.md"), "dirty\n");
  assert.throws(() => recordImplementation(root, "architecture/a"), /uncommitted changes/);
  sh(root, "checkout", "--", ".");
  const ctx: Ctx = { root, actor: { role: "administrator", kind: "human", name: "Pat Person" }, preset: DEFAULT_PRESET };
  assert.ok(overrideSpec(ctx, "test", "architecture/a", ["§1#T1", "failed"]).ok);
  assert.throws(() => recordImplementation(root, "architecture/a"), /failed test result \(§1#T1\)/);
  assert.ok(overrideSpec({ ...ctx, now: new Date(Date.now() + 5000) }, "test", "architecture/a", ["§1#T1", "passed"]).ok);
  assert.equal(recordImplementation(root, "architecture/a").changed, true);
});
