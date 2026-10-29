import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SPECPLANE_AGENT: "", SPECPLANE_SESSION: "",
};

const git = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const count = (root: string) => Number(git(root, "rev-list", "--count", "HEAD"));
const short = (root: string, ref: string) => git(root, "rev-parse", "--short=7", ref);
const subject = (root: string, ref: string) => git(root, "log", "-1", "--format=%s", ref);
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** Temp git repository with the base/ext config and the given files, all committed. */
function repo(files: Record<string, string>): string {
  const root = makeRepo({ ".specplane/config.yaml": CONFIG, ...files });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const fm = (id: string, status = "draft", extra: Record<string, unknown> = {}) =>
  spec({ id, title: `T ${id}`, status, author: "user", ...extra });

test("spec approve: base and overlay in one command, one commit each (Scenario 7)", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base", "review"),
    "ext-specs/features/overlay.md": fm("feature/overlay", "review", { extends: "feature/base" }),
  });
  const before = count(root);
  const r = run(root, "spec", "approve", "feature/base", "ext:feature/overlay");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `approved feature/base ${short(root, "HEAD~1")}\napproved ext:feature/overlay ${short(root, "HEAD")}\n`);
  assert.equal(count(root), before + 2);
  assert.equal(subject(root, "HEAD~1"), "docs(specs): approve feature/base");
  assert.equal(subject(root, "HEAD"), "docs(specs): approve ext:feature/overlay");

  const overlay = read(root, "ext-specs/features/overlay.md");
  assert.match(overlay, /^status: approved$/m);
  const pin = /based_on: \{ feature\/base: "([0-9a-f]{7,40})" \}/.exec(overlay);
  assert.ok(pin, overlay);
  const baseBlob = git(root, "rev-parse", "HEAD:specs/features/base.md");
  assert.ok(baseBlob.startsWith(pin[1]), "pin is the approved base blob");

  const body = git(root, "log", "-1", "--format=%B");
  assert.match(body, /^Specplane-Workflow: approve$/m);
  assert.doesNotMatch(body, /^Specplane-Plan:/m);
});

test("spec approve: architecture spec implementing an unapproved feature is refused (Scenario 8)", () => {
  const root = repo({
    "specs/features/search.md": fm("feature/search", "review"),
    "specs/architecture/search.md": fm("architecture/search", "review", { implements: ["feature/search"] }),
  });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "spec", "approve", "architecture/search");
  assert.equal(r.code, 1);
  assert.equal(r.err, "Cannot approve `architecture/search`: `feature/search` is `review`, not `approved`.\n");
  assert.equal(git(root, "rev-parse", "HEAD"), head, "nothing committed");
  assert.match(read(root, "specs/architecture/search.md"), /^status: "?review"?$/m);
});

test("spec reopen: reports the direct dependants and leaves them unchanged (Scenario 9)", () => {
  const root = repo({
    "specs/features/configuration.md": fm("feature/configuration", "approved"),
    "specs/architecture/reference-cli.md": fm("architecture/reference-cli", "approved", { implements: ["feature/configuration"] }),
  });
  const r = run(root, "spec", "reopen", "feature/configuration");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.split("\n")[0], `reopened feature/configuration ${short(root, "HEAD")}`);
  assert.match(r.out, /^architecture\/reference-cli approved — reopen with: specplane spec reopen architecture\/reference-cli$/m);
  assert.match(read(root, "specs/features/configuration.md"), /^status: review$/m);
  assert.match(read(root, "specs/architecture/reference-cli.md"), /^status: "?approved"?$/m);
  assert.equal(subject(root, "HEAD"), "docs(specs): reopen feature/configuration");
  assert.match(git(root, "log", "-1", "--format=%B"), /^Specplane-Workflow: approve$/m);
});

test("spec approve refuses an unknown id, a wrong status, and uncommitted changes", () => {
  const root = repo({
    "specs/features/alpha.md": fm("feature/alpha", "draft"),
    "specs/features/done.md": fm("feature/done", "approved"),
  });
  const head = git(root, "rev-parse", "HEAD");
  assert.equal(run(root, "spec", "approve", "feature/missing").err, "Spec `feature/missing` not found.\n");
  assert.equal(run(root, "spec", "approve", "feature/done").err, "Spec `feature/done` is `approved`; only `draft` or `review` specs can be approved.\n");

  fs.appendFileSync(path.join(root, "specs/features/alpha.md"), "\nedit\n");
  const dirty = run(root, "spec", "approve", "feature/alpha");
  assert.equal(dirty.code, 1);
  assert.equal(dirty.err, "Commit or stash changes to `specs/features/alpha.md` first.\n");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("spec approve stops at the first refusal and keeps earlier approvals", () => {
  const root = repo({
    "specs/features/alpha.md": fm("feature/alpha", "draft"),
    "specs/features/beta.md": fm("feature/beta", "draft"),
  });
  const before = count(root);
  const r = run(root, "spec", "approve", "feature/alpha", "feature/missing", "feature/beta");
  assert.equal(r.code, 1);
  assert.match(r.out, /^approved feature\/alpha [0-9a-f]+$/m);
  assert.equal(count(root), before + 1);
  assert.match(read(root, "specs/features/alpha.md"), /^status: approved$/m);
  assert.match(read(root, "specs/features/beta.md"), /^status: "?draft"?$/m);
});

test("spec approve refuses an overlay whose base is not approved", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base", "review"),
    "ext-specs/features/overlay.md": fm("feature/overlay", "review", { extends: "feature/base" }),
  });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "spec", "approve", "ext:feature/overlay");
  assert.equal(r.code, 1);
  assert.equal(r.err, "Cannot approve `ext:feature/overlay`: base `feature/base` is `review`.\n");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("spec approve refuses an overlay with a stale pin whose base is uncommitted", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base", "approved") });
  const pin = git(root, "rev-parse", "HEAD:specs/features/base.md").slice(0, 7);
  fs.mkdirSync(path.join(root, "ext-specs/features"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "ext-specs/features/overlay.md"),
    fm("feature/overlay", "review", { extends: "feature/base", based_on: { "feature/base": pin } }),
  );
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "overlay");
  fs.appendFileSync(path.join(root, "specs/features/base.md"), "\nuncommitted base edit\n");

  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "spec", "approve", "ext:feature/overlay");
  assert.equal(r.code, 1);
  assert.equal(r.err, "Cannot approve `ext:feature/overlay`: base `feature/base` changed since it was pinned.\n");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("spec approve reports validation errors and restores the file", () => {
  const root = repo({ "specs/features/bad.md": fm("feature/other", "draft") });
  const original = read(root, "specs/features/bad.md");
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "spec", "approve", "feature/bad");
  assert.equal(r.code, 1);
  assert.match(r.err, /Checking feature\/bad\.\.\. 1 error/);
  assert.match(r.err, /ID `feature\/other` does not match path-derived ID `feature\/bad`/);
  assert.equal(read(root, "specs/features/bad.md"), original);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("spec approve records the agent and session trailers when set", () => {
  const root = repo({ "specs/features/alpha.md": fm("feature/alpha", "review") });
  const r = spawnSync(process.execPath, [cli, "spec", "approve", "feature/alpha"], {
    cwd: root,
    encoding: "utf8",
    env: { ...ENV, SPECPLANE_AGENT: "ci", SPECPLANE_SESSION: "run-1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(r.status, 0, r.stderr);
  const body = git(root, "log", "-1", "--format=%B");
  assert.match(body, /^Specplane-Agent: ci$/m);
  assert.match(body, /^Specplane-Session: run-1$/m);
});

test("spec approve and reopen --dry-run print the plan and commit nothing", () => {
  const root = repo({
    "specs/features/alpha.md": fm("feature/alpha", "review"),
    "specs/features/done.md": fm("feature/done", "approved"),
  });
  const head = git(root, "rev-parse", "HEAD");
  const approve = run(root, "spec", "approve", "feature/alpha", "--dry-run");
  assert.equal(approve.code, 0, approve.err);
  assert.match(approve.out, /would approve feature\/alpha/);
  assert.match(approve.out, /would commit docs\(specs\): approve feature\/alpha/);
  const reopen = run(root, "spec", "reopen", "feature/done", "--dry-run");
  assert.equal(reopen.code, 0, reopen.err);
  assert.match(reopen.out, /would reopen feature\/done/);
  assert.match(reopen.out, /would commit docs\(specs\): reopen feature\/done/);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.match(read(root, "specs/features/alpha.md"), /^status: "?review"?$/m);
  assert.match(read(root, "specs/features/done.md"), /^status: "?approved"?$/m);
});
