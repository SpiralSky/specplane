import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { cacheStats, clearGitCache } from "./cache.js";
import { run } from "./exec.js";

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, stdio: "pipe", encoding: "utf8" });

function makeRepo(): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "specplane-gitcache-")));
  g(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a.txt"), "one");
  g(repo, "add", "a.txt");
  g(repo, "commit", "-q", "-m", "init");
  clearGitCache();
  return repo;
}

test("a show by full sha is served from the cache the second time", () => {
  const repo = makeRepo();
  const sha = g(repo, "rev-parse", "HEAD").trim();
  const before = cacheStats.hits;
  assert.equal(run("git", ["show", `${sha}:a.txt`], { cwd: repo }), "one");
  assert.equal(run("git", ["show", `${sha}:a.txt`], { cwd: repo }), "one");
  assert.equal(cacheStats.hits, before + 1);
});

test("HEAD reads see a commit made by this process or another one", () => {
  const repo = makeRepo();
  assert.equal(run("git", ["show", "HEAD:a.txt"], { cwd: repo }), "one");
  assert.equal(run("git", ["show", "HEAD:a.txt"], { cwd: repo }), "one");
  fs.writeFileSync(path.join(repo, "a.txt"), "two");
  g(repo, "commit", "-q", "-a", "-m", "two"); // external write, not through run()
  assert.equal(run("git", ["show", "HEAD:a.txt"], { cwd: repo }), "two");
  assert.deepEqual(run("git", ["ls-tree", "--name-only", "HEAD"], { cwd: repo }).trim().split("\n"), ["a.txt"]);
  fs.writeFileSync(path.join(repo, "b.txt"), "b");
  run("git", ["add", "b.txt"], { cwd: repo });
  run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "three"], { cwd: repo });
  assert.deepEqual(run("git", ["ls-tree", "--name-only", "HEAD"], { cwd: repo }).trim().split("\n"), ["a.txt", "b.txt"]);
});

test("a missing path keeps failing with the same GitError, and appears once committed", () => {
  const repo = makeRepo();
  for (let i = 0; i < 2; i++) assert.throws(() => run("git", ["show", "HEAD:nope.txt"], { cwd: repo }), /git show HEAD:nope\.txt/);
  fs.writeFileSync(path.join(repo, "nope.txt"), "x");
  g(repo, "add", "nope.txt");
  g(repo, "commit", "-q", "-m", "add");
  assert.equal(run("git", ["show", "HEAD:nope.txt"], { cwd: repo }), "x");
});

test("notes list reflects a note write made through run() and one made outside", () => {
  const repo = makeRepo();
  const sha = g(repo, "rev-parse", "HEAD").trim();
  const list = () => run("git", ["notes", "--ref=refs/notes/specplane", "list"], { cwd: repo }).trim();
  assert.equal(list(), "");
  run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "notes", "--ref=refs/notes/specplane", "add", "-f", "-F", "-", sha], { cwd: repo, input: "n1" });
  const first = list();
  assert.match(first, new RegExp(` ${sha}$`));
  assert.equal(list(), first);
  g(repo, "notes", "--ref=refs/notes/specplane", "add", "-f", "-m", "n2", sha);
  assert.notEqual(list(), first);
});
