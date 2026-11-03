import assert from "node:assert/strict";

import * as fs from "node:fs";

import * as path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { finishPlan } from "./flows.js";
import { createFinishFixture } from "./finish-fixture.js";

const { git, gitOk, A, repo, fin, finConfirmed, finWithCallback, sha } = createFinishFixture();

test("finish uses recorded nondefault target and requires fresh acceptance after finalization", () => {
  const r = repo({ target: "release" });
  const main = sha(r.root, "main");
  const first = fin(r, "--yes");
  assert.equal(first.code, 0, first.err);
  assert.equal(sha(r.root, "release"), main);
  assert.match(first.err, /ready to merge/);
  const reviewed = sha(r.co, "HEAD");
  const second = finConfirmed(r);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /Finished and merged/);
  assert.equal(sha(r.root, "main"), main);
  assert.ok(gitOk(r.root, "merge-base", "--is-ancestor", reviewed, "release"));
});

test("target movement invalidates earlier acceptance and requires another invocation", () => {
  const r = repo();
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const prior = sha(r.co, "HEAD");
  fs.writeFileSync(path.join(r.root, "advanced.txt"), "advance\n");
  git(r.root, "add", "advanced.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  const target = sha(r.root, "HEAD");
  const rebased = fin(r, "--yes");
  assert.equal(rebased.code, 0, rebased.err);
  assert.match(rebased.err, /ready to merge/);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.notEqual(sha(r.co, "HEAD"), prior);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  assert.match(merged.out, /Finished and merged/);
});

test("confirmation refuses when target moves during the human challenge", async () => {
  const r = repo();
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const reviewed = sha(r.co, "HEAD");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async question => {
    assert.match(question, new RegExp(reviewed));
    fs.writeFileSync(path.join(r.root, "raced.txt"), "race\n");
    git(r.root, "add", "raced.txt");
    git(r.root, "commit", "-q", "-m", "target race");
    return true;
  } }), /changed during operation/);
  assert.equal(sha(r.co, "HEAD"), reviewed);
  assert.equal(gitOk(r.root, "merge-base", "--is-ancestor", reviewed, "main"), false);
});

test("finalization confirmation preserves callback-time target file and index edits", async () => {
  const r = repo();
  const before = sha(r.co, "HEAD");
  const file = path.join(r.root, "base.txt");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
    fs.writeFileSync(file, "human staged change\n");
    git(r.root, "add", "base.txt");
    fs.writeFileSync(file, "human unstaged change\n");
    return true;
  } }), /clean checkout of target/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(fs.readFileSync(file, "utf8"), "human unstaged change\n");
  assert.equal(git(r.root, "show", ":base.txt"), "human staged change");
  assert.equal(git(r.co, "log", "-1", "--format=%s").includes("finish"), false);
});

test("finish rejects a draft target lifecycle record", () => {
  const r = repo();
  const file = path.join(r.root, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: draft"));
  git(r.root, "commit", "-qam", "move target back to draft");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /target status draft/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("unattended finalization reports readiness without claiming finish", () => {
  const r = repo();
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Ready for finalization/);
  assert.doesNotMatch(result.out, /Finished/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("publication refuses a refreshed remote plan tracking ref after confirmation", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const remoteSeed = sha(r.root, "main");
  const action = `if (count === 2) { execFileSync("git", ["update-ref", "refs/remotes/origin/plan/${A}", ${JSON.stringify(remoteSeed)}]); }`;
  const result = finWithCallback(r, action);
  assert.equal(result.code, 1);
  assert.match(result.err, /refs\/remotes\/origin\/plan.*changed during operation/);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
});

test("publication refuses a plan head moved during confirmation", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const action = `if (count === 2) { execFileSync("git", ["commit", "--allow-empty", "-m", "concurrent change"]); }`;
  const result = finWithCallback(r, action);
  assert.equal(result.code, 1);
  assert.match(result.err, /Plan changed during publication confirmation/);
  assert.equal(git(r.co, "log", "-1", "--format=%s"), "concurrent change");
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
});

test("finish rejects a draft branch lifecycle status", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: draft"));
  git(r.co, "commit", "-qam", "invalid branch status");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /plan status draft is not executable for git mode/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("finish reaches approval gate for a migrated active Git-mode plan", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: review"));
  git(r.co, "commit", "-qam", "migrated status");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 0, result.err);
  assert.match(result.err, /ready to merge/);
  assert.equal(sha(r.co, "HEAD"), before);
});
