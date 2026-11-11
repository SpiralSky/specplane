import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { makeRepo } from "../test-repo.js";
import { run } from "../git/exec.js";
import { appendStoreLine, readStoreJson, removeStoreJson, storeDir, writeStoreJson } from "./store.js";

function repo(): string {
  const root = makeRepo({});
  run("git", ["init", "-q"], { cwd: root });
  return root;
}

test("nested local store writes are atomic and support read/remove/append", () => {
  const root = repo();
  assert.equal(readStoreJson(root, "runs/missing.json"), null);
  writeStoreJson(root, "runs/plan.json", { n: 1 });
  writeStoreJson(root, "runs/plan.json", { n: 2 });
  assert.deepEqual(readStoreJson(root, "runs/plan.json"), { n: 2 });
  assert.deepEqual(fs.readdirSync(path.join(storeDir(root), "runs")), ["plan.json"]);
  appendStoreLine(root, "nested/log/events.jsonl", '{"n":1}');
  appendStoreLine(root, "nested/log/events.jsonl", '{"n":2}');
  assert.equal(fs.readFileSync(path.join(storeDir(root), "nested/log/events.jsonl"), "utf8"), '{"n":1}\n{"n":2}\n');
  removeStoreJson(root, "runs/plan.json");
  removeStoreJson(root, "runs/plan.json");
  assert.equal(readStoreJson(root, "runs/plan.json"), null);
});

test("local store rejects traversal, absolute paths, and symlinks for every access", () => {
  const root = repo();
  for (const name of ["../outside", "/tmp/outside", "runs/../outside", "runs//file", "./file", "runs\\file", ""]) {
    for (const action of [() => readStoreJson(root, name), () => writeStoreJson(root, name, {}), () => removeStoreJson(root, name), () => appendStoreLine(root, name, "line")]) assert.throws(action, /Invalid local store path/);
  }
  fs.mkdirSync(storeDir(root), { recursive: true });
  const outside = path.join(root, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(storeDir(root), "linked"));
  for (const action of [() => readStoreJson(root, "linked/file"), () => writeStoreJson(root, "linked/file", {}), () => removeStoreJson(root, "linked/file"), () => appendStoreLine(root, "linked/file", "line")]) assert.throws(action, /symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
