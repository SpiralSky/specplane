import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo } from "../test-repo.js";

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

const adr = (number: string, status = "proposed", id = `decision/${number}`, title = "T") =>
  `---\nid: ${id}\ntitle: "${title}"\ndate: 2026-01-01\nstatus: ${status}\n---\n\n# ${title}\n`;

/** Temp git repository with the base/ext config and the given files, all committed. */
function repo(files: Record<string, string>): string {
  const root = makeRepo({ ".specplane/config.yaml": CONFIG, ...files });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

test("decision new: creates the next number with proposed status (Scenario 10)", () => {
  const root = repo({ "decisions/0003-old.md": adr("0003") });
  const r = run(root, "decision", "new", "Cache policy");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "decisions/0004-cache-policy.md\n");
  const text = read(root, "decisions/0004-cache-policy.md");
  assert.match(text, /^id: decision\/0004$/m);
  assert.match(text, /^title: "Cache policy"$/m);
  assert.match(text, /^status: proposed$/m);
  assert.match(text, /^date: \d{4}-\d{2}-\d{2}$/m);
  assert.match(text, /^# Cache policy$/m);
  for (const heading of ["Context", "Options considered", "Decision", "Consequences"]) {
    assert.match(text, new RegExp(`^## ${heading}$`, "m"));
  }
});

test("decision new starts at 0001 and numbers above any existing NNNN file", () => {
  const empty = repo({});
  const first = run(empty, "decision", "new", "First");
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out, "decisions/0001-first.md\n");

  // Numbering is the highest existing `NNNN` in `<decisions.dir>` plus one, parsed or not
  // (`feature/tooling`), so an opaque 0001 file pushes the next record to 0002.
  const opaque = repo({ "decisions/0001-cache-policy.md": "not an ADR\n" });
  const r = run(opaque, "decision", "new", "Cache policy");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "decisions/0002-cache-policy.md\n");
});

test("decision accept: sets accepted, commits, and prints the short SHA", () => {
  const root = repo({ "decisions/0001-cache-policy.md": adr("0001") });
  const before = count(root);
  const r = run(root, "decision", "accept", "decision/0001");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `accepted decision/0001 ${short(root, "HEAD")}\n`);
  assert.equal(count(root), before + 1);
  assert.equal(subject(root, "HEAD"), "docs(decisions): accept decision/0001");
  assert.match(git(root, "log", "-1", "--format=%B"), /^Specplane-Workflow: approve$/m);
  assert.match(read(root, "decisions/0001-cache-policy.md"), /^status: accepted$/m);
});

test("decision accept refuses an unknown ID and an ADR that is not proposed", () => {
  const root = repo({
    "decisions/0001-cache-policy.md": adr("0001", "accepted"),
  });
  assert.equal(run(root, "decision", "accept", "decision/0009").err, "Decision `decision/0009` not found.\n");
  assert.equal(
    run(root, "decision", "accept", "decision/0001").err,
    "Decision `decision/0001` is `accepted`; only `proposed` decisions can be accepted.\n",
  );
});

test("decision accept refuses an uncommitted ADR", () => {
  const root = repo({ "decisions/0001-cache-policy.md": adr("0001") });
  const head = git(root, "rev-parse", "HEAD");
  fs.appendFileSync(path.join(root, "decisions/0001-cache-policy.md"), "\nedit\n");
  const r = run(root, "decision", "accept", "decision/0001");
  assert.equal(r.code, 1);
  assert.equal(r.err, "Commit or stash changes to `decisions/0001-cache-policy.md` first.\n");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("decision accept refuses an ADR with validation errors", () => {
  const root = repo({
    "decisions/0001-a.md": adr("0001", "proposed", "decision/0001", "A"),
    "decisions/0001-b.md": adr("0001", "proposed", "decision/0001", "B"),
  });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "decision", "accept", "decision/0001");
  assert.equal(r.code, 1);
  assert.match(r.err, /Checking decision\/0001\.\.\. 1 error/);
  assert.match(r.err, /Duplicate ADR number `0001`/);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("decision accept --dry-run prints the plan and changes nothing", () => {
  const root = repo({ "decisions/0001-cache-policy.md": adr("0001") });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "decision", "accept", "decision/0001", "--dry-run");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /would accept decision\/0001/);
  assert.match(r.out, /would commit docs\(decisions\): accept decision\/0001/);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.match(read(root, "decisions/0001-cache-policy.md"), /^status: proposed$/m);
});
