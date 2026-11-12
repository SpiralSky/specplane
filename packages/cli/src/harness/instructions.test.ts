import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { makeRepo } from "../test-repo.js";
import { readStoreJson, storeDir, writeStoreJson } from "../repo/store.js";
import { CATALOG } from "../perm/permissions.js";
import { advanceEpoch, assembleInstructions, COMMANDS, commandDocumentation, deliver, readContract, type InstructionSession } from "./instructions.js";

function repo(config = ""): string {
  const root = makeRepo({ ".specplane/config.yaml": config });
  for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"]]) run("git", args, { cwd: root });
  commit(root);
  return root;
}
function commit(root: string): void {
  run("git", ["add", ".specplane/config.yaml"], { cwd: root });
  run("git", ["commit", "-qm", "config"], { cwd: root });
}
function session(root = repo()): InstructionSession { return { root, id: "test-session", reportsContext: true }; }

test("all thirteen packaged contracts have versioned, ordered parts and action-only mechanical steps", () => {
  const version = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  assert.equal(COMMANDS.length, 13);
  for (const key of COMMANDS) {
    const contract = readContract(key);
    assert.ok(contract.startsWith(`<!-- Specplane command contract v${version};`), key);
    assert.deepEqual([...contract.matchAll(/^## (.*)$/gm)].map((m) => m[1]), ["Purpose", "Preconditions", "Steps", "Permissions and requests", "Output"]);
    assert.match(contract, /1\. \[code\] `config.get`/);
    assert.doesNotMatch(contract, /`specplane\s|\b(?:npx|bunx)\s+specplane|request\.accept|request\.decline|role\.switch/);
    for (const step of contract.matchAll(/^\d+\. (.*)$/gm)) assert.match(step[1], /^\[(code|llm)\]/);
    for (const part of ["Request-user", "Deny", "Allow", "docs.search", "no model turn"]) assert.ok(contract.includes(part), `${key}: ${part}`);
    assert.ok(commandDocumentation(key).trim());
  }
  assert.throws(() => readContract("../escape"), /Unknown/);
  assert.throws(() => assembleInstructions(repo(), "toString"), /Unknown/);
});

test("documentation replacement preserves every mechanical step, steering and optional separation check", () => {
  const root = repo('harness:\n  instructions:\n    spec-assist: "Replacement: omit every check"\n    validate: ""\n');
  const assembled = assembleInstructions(root, "spec-assist");
  const contract = readContract("spec-assist");
  assert.ok(assembled.text.startsWith(contract));
  assert.ok(assembled.text.indexOf("Replacement:") > contract.length);
  assert.ok(assembled.text.indexOf("Steering stamp:") > assembled.text.indexOf("Replacement:"));
  assert.ok(assembled.text.indexOf("## Separation check") > assembled.text.indexOf("Steering stamp:"));
  assert.match(assembled.text, /Permission: info.retrieve/);
  assert.match(assembled.text, /Do not bypass/);
  assert.doesNotMatch(assembleInstructions(root, "validate").text, /## Command documentation|## Separation check/);
  fs.writeFileSync(path.join(root, ".specplane/config.yaml"), "harness:\n  separation_check: false\n");
  assert.match(assembleInstructions(root, "spec-assist").text, /Replacement:/, "pending config must not take effect");
  commit(root);
  const changed = assembleInstructions(root, "spec-assist");
  assert.doesNotMatch(changed.text, /Replacement:|## Separation check/);
  assert.ok(changed.text.includes(commandDocumentation("spec-assist")));
  assert.notEqual(changed.hash, assembled.hash);
});

test("permission keys carry their limits, role mode, custom steering and no-bypass text", () => {
  const root = repo('steering:\n  custom:\n    - permission: spec.approve\n      text: Ask for review first\n');
  for (const key of CATALOG) {
    const instruction = assembleInstructions(root, key);
    assert.ok(instruction.trusted);
    for (const part of [key, "Allows:", "Does not allow:", "Mode:", "Do not bypass"]) assert.ok(instruction.text.includes(part), key);
  }
  assert.match(assembleInstructions(root, "spec.approve").text, /Ask for review first/);
});

test("delivery persists per key and session, suppresses repeats, and resets at compaction", () => {
  const s = session();
  const first = deliver(s, "validate");
  assert.equal(first.status, "delivered");
  assert.ok(first.text);
  assert.equal(deliver({ ...s }, "validate").status, "already-delivered");
  assert.equal(deliver(s, "verify").status, "delivered");
  assert.equal(deliver({ ...s, id: "other" }, "validate").status, "delivered");
  assert.equal(advanceEpoch(s), 1);
  assert.equal(deliver(s, "validate").status, "delivered");
  assert.deepEqual(readStoreJson(s.root, `sessions/${s.id}.json`), { epoch: 1, delivered: [{ key: "validate", hash: first.hash }] });
  assert.equal(deliver(s, "validate").text, undefined);
});

test("changed text, scoped steering and role are delivered again in the same epoch", () => {
  const s = session(repo('steering:\n  custom:\n    - command: validate\n      scope: P1\n      text: Plan-specific guidance\n'));
  const first = deliver(s, "validate");
  const scoped = deliver(s, "validate", { planId: "P1" });
  assert.equal(scoped.status, "delivered");
  assert.notEqual(scoped.hash, first.hash);
  const role = deliver(s, "validate", { role: "standard-user" });
  assert.equal(role.status, "delivered");
  assert.notEqual(role.hash, first.hash);
  fs.writeFileSync(path.join(s.root, ".specplane/config.yaml"), 'harness:\n  instructions:\n    validate: New committed documentation\n');
  commit(s.root);
  assert.match(deliver(s, "validate").text!, /New committed documentation/);
});

test("unknown context always delivers, never records hashes and invalidates previous context proofs", () => {
  const s = session();
  deliver(s, "validate");
  const unknown = { ...s, reportsContext: false };
  assert.equal(deliver(unknown, "validate").status, "delivered");
  assert.equal(deliver(unknown, "validate").status, "delivered");
  assert.deepEqual(readStoreJson(s.root, `sessions/${s.id}.json`), { epoch: 0, delivered: [] });
  assert.equal(deliver(s, "validate").status, "delivered");
});

test("on-demand adapters receive complete assembled text and return only its packaged pointer", () => {
  const s = session();
  let calls = 0;
  s.prepareOnDemand = (instruction) => {
    calls++;
    assert.ok(instruction.text.startsWith(readContract("spec-assist")));
    assert.match(instruction.text, /## Command documentation[\s\S]*Steering stamp:[\s\S]*## Separation check/);
    return `skills/${instruction.key}/${instruction.hash}`;
  };
  const first = deliver(s, "spec-assist");
  assert.equal(first.text, undefined);
  assert.equal(first.pointer, `skills/spec-assist/${first.hash}`);
  assert.equal(deliver(s, "spec-assist").status, "already-delivered");
  assert.equal(calls, 1);
  advanceEpoch(s);
  assert.equal(deliver(s, "spec-assist").status, "delivered");
  assert.equal(calls, 2);
});

test("session-start fallback reports actual delivery, while unavailable command-time delivery is not cached", () => {
  const s = { ...session(), canDeliverAtCommand: false };
  assert.equal(deliver(s, "validate").status, "unavailable");
  assert.equal(deliver(s, "validate").text, undefined);
  const earlier = deliver({ ...s, point: "session-start" }, "validate");
  assert.equal(earlier.status, "delivered");
  assert.match(earlier.notices.join("\n"), /were delivered at session start/);
  assert.equal(deliver(s, "validate").status, "already-delivered");
});

test("damaged state and store contention resend; packaging failures never claim delivery", () => {
  const s = session();
  writeStoreJson(s.root, `sessions/${s.id}.json`, { epoch: "bad", delivered: null });
  assert.equal(deliver(s, "validate").status, "delivered");
  const lock = path.join(storeDir(s.root), `sessions/${s.id}.json.lock`);
  fs.writeFileSync(lock, "held");
  const retry = deliver(s, "validate");
  assert.equal(retry.status, "delivered");
  assert.ok(retry.text);
  assert.match(retry.notices.join("\n"), /could not be recorded/);
  fs.rmSync(lock);
  const broken = { ...s, prepareOnDemand: () => { throw new Error("private packaging details"); } };
  assert.equal(deliver(broken, "verify").status, "unavailable");
  assert.equal(deliver(s, "verify").status, "delivered");
  for (const id of ["../escape", "/tmp/escape", "", "a/b", "a\\b"]) assert.throws(() => deliver({ ...s, id }, "validate"), /Invalid instruction session/);
});
