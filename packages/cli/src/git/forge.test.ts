import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { ForgeError } from "../errors.js";
import { createPR, getOpenPR, hasOpenPR, mergedPRCommit } from "./forge.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "specplane-forge-"));

/** Temp repo with the given origin URL (raw config; no network is ever contacted). */
function repo(url?: string): string {
  const d = tmp();
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: d });
  if (url) spawnSync("git", ["remote", "add", "origin", url], { cwd: d });
  return d;
}

/** Stub `gh` placed first on PATH: logs argv (one arg per line, `--` between calls) and prints `out`. */
function stubGh(out: string, exit = 0): { dir: string; log: string } {
  const dir = tmp();
  const log = path.join(dir, "calls.log");
  fs.writeFileSync(path.join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\nprintf '%s\\n' -- >> '${log}'\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf '%s\\n' '${out}'\nexit ${exit}\n`, { mode: 0o755 });
  return { dir, log };
}

function withPath<T>(front: string | null, fn: () => T): T {
  const saved = process.env.PATH;
  // No gh on PATH: a directory holding only a symlink to git (sh is not needed by run()).
  const only = tmp();
  fs.symlinkSync(spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim(), path.join(only, "git"));
  process.env.PATH = front ? `${front}${path.delimiter}${only}` : only;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

const GH = "https://github.com/o/r.git";

test("forge: PR queries bind the requested target and merged evidence binds exact head", () => {
  const cwd = repo(GH); const head = "a".repeat(40), merge = "b".repeat(40);
  const open = stubGh('[{"url":"https://github.com/o/r/pull/9"}]');
  assert.ok(withPath(open.dir, () => hasOpenPR("plan/a", {cwd, forge:"auto", base:"candidate"})));
  assert.match(fs.readFileSync(open.log, "utf8"), /--base\ncandidate\n/);
  const merged = stubGh(JSON.stringify([{headRefOid:head,baseRefName:"candidate",mergeCommit:{oid:merge}}]));
  assert.equal(withPath(merged.dir, () => mergedPRCommit("plan/a", "candidate", head, {cwd,forge:"auto"})), merge);
  assert.equal(withPath(merged.dir, () => mergedPRCommit("plan/a", "candidate", "c".repeat(40), {cwd,forge:"auto"})), null);
  assert.equal(withPath(merged.dir, () => mergedPRCommit("plan/a", "other", head, {cwd,forge:"auto"})), null);
});

test("forge: createPR uses gh with an argument array (no shell)", () => {
  const cwd = repo(GH);
  const { dir, log } = stubGh("https://github.com/o/r/pull/7");
  const title = 'T "quoted" $(touch pwned); `x`';
  const url = withPath(dir, () => createPR("plan/a", "main", title, "line1\nline2", { cwd, forge: "auto" }));
  assert.equal(url, "https://github.com/o/r/pull/7");
  const args = fs.readFileSync(log, "utf8").split("\n--\n").filter(Boolean).at(-1)!.split("\n");
  assert.deepEqual(args.slice(0, 9), ["pr", "create", "--head", "plan/a", "--base", "main", "--title", title, "--body"]);
  assert.equal(args.slice(9).join("\n").trim(), "line1\nline2");
  assert.ok(!fs.existsSync(path.join(cwd, "pwned")));
});

test("forge: getOpenPR parses --json url output", () => {
  const cwd = repo("git@github.com:o/r.git");
  const { dir, log } = stubGh('[{"url":"https://github.com/o/r/pull/9"}]');
  assert.equal(withPath(dir, () => getOpenPR("plan/a", { cwd, forge: "auto" })), "https://github.com/o/r/pull/9");
  assert.match(fs.readFileSync(log, "utf8"), /pr\nlist\n--head\nplan\/a\n--state\nopen\n--json\nurl\n/);
  const none = stubGh("[]");
  assert.equal(withPath(none.dir, () => getOpenPR("plan/a", { cwd, forge: "github" })), null);
  assert.equal(withPath(none.dir, () => hasOpenPR("plan/a", { cwd, forge: "github" })), false);
});

test("forge: auto returns null for non-GitHub remote, no remote, or missing gh", () => {
  const { dir } = stubGh("https://x/pull/1");
  const other = repo("https://gitlab.com/o/r.git");
  assert.equal(withPath(dir, () => createPR("b", "main", "t", "b", { cwd: other, forge: "auto" })), null);
  assert.equal(withPath(dir, () => getOpenPR("b", { cwd: repo(), forge: "auto" })), null);
  assert.equal(withPath(null, () => getOpenPR("b", { cwd: repo(GH), forge: "auto" })), null);
});

test("forge: github mode throws ForgeError (exit 2) when unavailable", () => {
  const { dir } = stubGh("x");
  assert.throws(() => withPath(dir, () => createPR("b", "main", "t", "b", { cwd: repo("https://gitlab.com/o/r"), forge: "github" })), ForgeError);
  try {
    withPath(null, () => getOpenPR("b", { cwd: repo(GH), forge: "github" }));
    assert.fail("expected ForgeError");
  } catch (e) {
    assert.ok(e instanceof ForgeError);
    assert.equal(e.exitCode, 2);
  }
});

test("forge: none returns null without calling gh; gh failure becomes ForgeError", () => {
  const cwd = repo(GH);
  const { dir, log } = stubGh("boom", 1);
  assert.equal(withPath(dir, () => createPR("b", "main", "t", "b", { cwd, forge: "none" })), null);
  assert.equal(fs.existsSync(log), false);
  assert.throws(() => withPath(dir, () => createPR("b", "main", "t", "b", { cwd, forge: "auto" })), ForgeError);
  assert.equal(withPath(dir, () => hasOpenPR("b", { cwd, forge: "auto" })), false);
});
