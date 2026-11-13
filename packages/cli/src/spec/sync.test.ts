import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInit } from "../commands/init.js";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { validateProject } from "../verify/validate.js";
import { approveSpecs, type Ctx } from "./human.js";
import { readNotes } from "./notes.js";
import { notesRefspec, notesSyncWarnings, syncNotes } from "./sync.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: ENV }).trim();
const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "specplane-sync-"));
const F = "docs/specifications/features";
const spec = (id: string) => `---\nid: feature/${id}\ntitle: ${id}\nauthors: []\n---\n\n## §1 Part\n\nText of ${id}.\n`;
let tick = 0;
const ctx = (root: string): Ctx => ({ root, actor: { kind: "human", role: "standard-user", name: "Pat" }, preset: DEFAULT_PRESET, now: new Date(Date.parse("2026-11-10T12:00:00Z") + 1000 * tick++) });

/** A bare remote and two clones of it that share a committed spec `a` and `b`. */
function setup(): { remote: string; one: string; two: string } {
  const remote = tmp();
  git(remote, "init", "-q", "--bare", "-b", "main");
  const one = tmp();
  git(one, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "Pat"], ["user.email", "pat@example.com"]]) git(one, "config", k, v);
  fs.mkdirSync(path.join(one, F), { recursive: true });
  for (const id of ["a", "b"]) fs.writeFileSync(path.join(one, F, `${id}.md`), spec(id));
  git(one, "add", "-A"); git(one, "commit", "-qm", "init");
  git(one, "remote", "add", "origin", remote);
  git(one, "push", "-q", "origin", "main");
  const two = tmp();
  git(two, "clone", "-q", remote, ".");
  for (const [k, v] of [["user.name", "Sam"], ["user.email", "sam@example.com"]]) git(two, "config", k, v);
  return { remote, one, two };
}
const rids = (root: string) => [...readNotes(root).bySpec.values()].flat().map((s) => s.rec.rid).sort();

test("init sets the notes fetch refspec once per remote; validate warns when it is missing", () => {
  const { one } = setup();
  assert.ok(notesSyncWarnings(one).some((w) => /no notes fetch refspec/.test(w)));
  const lines = runInit(one, { harness: "none" });
  assert.ok(lines.some((l) => /notes fetch refspec of remote origin/.test(l)));
  assert.ok(git(one, "config", "--get-all", "remote.origin.fetch").split("\n").includes(notesRefspec("origin")));
  assert.equal(runInit(one, { harness: "none" }).filter((l) => /refspec/.test(l)).length, 0, "idempotent");
  assert.equal(git(one, "config", "--get-all", "remote.origin.fetch").split("\n").filter((l) => /notes/.test(l)).length, 1);
});

test("sync: fetch into the remote-tracking ref, merge with cat_sort_uniq, push; two clones converge without losing records", async () => {
  const { one, two } = setup();
  git(two, "fetch", "-q", "origin");
  for (const r of [one, two]) runInit(r, { harness: "none" });
  assert.ok((await approveSpecs(ctx(one), ["feature/a"])).ok);
  assert.ok((await approveSpecs(ctx(two), ["feature/b"])).ok);
  assert.deepEqual(syncNotes(one).length > 0, true);
  const second = syncNotes(two);
  assert.ok(second.some((l) => /Merged/.test(l)));
  assert.ok(git(two, "rev-parse", "refs/notes/remotes/origin/specplane"), "the remote-tracking ref exists");
  syncNotes(one);
  assert.equal(rids(one).length, 2);
  assert.deepEqual(rids(one), rids(two));
  assert.equal(validateProject(one).statuses.find((s) => s.id === "feature/b")!.effective, "approved", "approval written elsewhere applies by content");
  assert.deepEqual(notesSyncWarnings(one), []);
});

test("validate warns about remote notes that are fetched but not merged, and about never-synced local records", async () => {
  const { one, two } = setup();
  for (const r of [one, two]) runInit(r, { harness: "none" });
  await approveSpecs(ctx(one), ["feature/a"]);
  assert.ok(notesSyncWarnings(one).some((w) => /has no notes copy here/.test(w)));
  syncNotes(one);
  await approveSpecs(ctx(two), ["feature/b"]);
  git(two, "fetch", "-q", "origin");
  assert.ok(notesSyncWarnings(two).some((w) => /not merged into/.test(w)));
  const warnings = validateProject(two).findings.filter((f) => f.rule === "notes");
  assert.ok(warnings.length > 0);
});

test("sync stops at the failing step and names it; an unknown remote is refused", async () => {
  const { one } = setup();
  assert.throws(() => syncNotes(one, "nowhere"), /no remote named nowhere/);
  git(one, "remote", "set-url", "origin", "/nonexistent/path");
  assert.match(syncNotes(one).join("\n"), /no notes yet/);
  await approveSpecs(ctx(one), ["feature/a"]);
  assert.throws(() => syncNotes(one), /Sync stopped at push/);
});

test("CLI: specplane sync pushes and approve --ref attaches the record to that branch's head", async () => {
  const { one, remote } = setup();
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: one, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  git(one, "switch", "-q", "-c", "plan/x");
  fs.writeFileSync(path.join(one, F, "a.md"), spec("a") + "More.\n");
  git(one, "commit", "-qam", "edit a on the plan branch");
  const planHead = git(one, "rev-parse", "HEAD");
  git(one, "switch", "-q", "main");
  const ok = run("spec", "approve", "feature/a", "--ref", "plan/x");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readNotes(one).bySpec.get("feature/a")![0].commit, planHead);
  assert.equal(validateProject(one).statuses.find((s) => s.id === "feature/a")!.effective, "awaiting-review", "main still has the old content");
  git(one, "switch", "-q", "plan/x");
  assert.equal(validateProject(one).statuses.find((s) => s.id === "feature/a")!.effective, "approved");
  assert.equal(run("spec", "approve", "feature/a", "--ref", "nope").status, 1);
  const s = run("sync");
  assert.equal(s.status, 0, s.stderr);
  assert.match(git(remote, "for-each-ref", "refs/notes/"), /refs\/notes\/specplane/);
});

test("init writes a default configuration when none exists, never overwrites one, and says to commit it", () => {
  const { one } = setup();
  const file = path.join(one, ".specplane", "config.yaml");
  fs.rmSync(file, { force: true });
  const lines = runInit(one, { harness: "none" });
  assert.ok(fs.existsSync(file));
  assert.ok(lines.some((l) => /Created \.specplane\/config\.yaml.*Commit it/.test(l)));
  fs.writeFileSync(file, "plans:\n  dir: mine\n");
  assert.ok(!runInit(one, { harness: "none" }).some((l) => /Created/.test(l)));
  assert.equal(fs.readFileSync(file, "utf8"), "plans:\n  dir: mine\n");
});
