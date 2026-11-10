import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { storeDir } from "../repo/store.js";
import { answerRequest, claimAnswer, listRequests, newRequestId, readRequest, saveNew, type RequestRecord } from "./store.js";

const answer = { by: "Pat Person", date: "2026-11-10T12:00:00Z" };

function request(): { root: string; id: string; lock: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-request-store-"));
  run("git", ["init", "-q"], { cwd: root });
  const id = newRequestId(new Date(answer.date));
  const rec: RequestRecord = {
    id, state: "pending", created: answer.date, from: { role: "llm" },
    permissions: ["config.change"], action: { command: "config set", params: { key: "plans.dir", new: "work" } },
    reason: "Move plans", base: { branch: null, commit: null }, diff: null, plan: null, blocking: false, answer: null,
  };
  saveNew(root, rec);
  return { root, id, lock: path.join(storeDir(root), "requests", `${id}.json.lock`) };
}

test("an accepting action excludes decline and a second accept until it finalizes", async () => {
  const { root, id, lock } = request();
  let finishAction!: () => void;
  const action = new Promise<void>((resolve) => { finishAction = resolve; });
  let effects = 0;
  const accept = async () => {
    const claim = claimAnswer(root, id);
    try {
      await action;
      effects++;
      return claim.answer("accepted", answer);
    } finally { claim.release(); }
  };
  const accepting = accept();
  try {
    assert.ok(fs.existsSync(lock));
    assert.throws(() => answerRequest(root, id, "declined", answer), /being answered/);
    await assert.rejects(accept(), /being answered/);
    assert.equal(readRequest(root, id)!.state, "pending");
  } finally { finishAction(); }
  assert.equal((await accepting).state, "accepted");
  assert.equal(effects, 1);
  assert.equal(fs.existsSync(lock), false);
  assert.throws(() => claimAnswer(root, id), /already accepted/);
  assert.throws(() => answerRequest(root, id, "declined", answer), /already accepted/);
  assert.equal(fs.existsSync(lock), false);
});

test("declining first prevents a later accepting action", () => {
  const { root, id, lock } = request();
  answerRequest(root, id, "declined", answer);
  assert.throws(() => claimAnswer(root, id), /already declined/);
  assert.equal(readRequest(root, id)!.state, "declined");
  assert.equal(fs.existsSync(lock), false);
});

test("an action failure can be finalized without reacquiring its claim and cannot be retried", async () => {
  const { root, id, lock } = request();
  const claim = claimAnswer(root, id);
  try {
    try { await Promise.reject(new Error("patch no longer applies")); }
    catch (e) { claim.answer("failed", { ...answer, error: (e as Error).message }); }
  } finally { claim.release(); }
  assert.equal(fs.existsSync(lock), false);
  assert.equal(readRequest(root, id)!.state, "failed");
  assert.equal(readRequest(root, id)!.answer!.error, "patch no longer applies");
  assert.throws(() => claimAnswer(root, id), /already failed/);
  assert.equal(fs.existsSync(lock), false);
});

test("an abandoned claim releases safely and cannot overwrite a later answer", () => {
  const { root, id, lock } = request();
  const claim = claimAnswer(root, id);
  claim.release();
  const next = claimAnswer(root, id);
  try {
    claim.release();
    assert.ok(fs.existsSync(lock), "a repeated release must not remove the next owner's lock");
    assert.throws(() => claim.answer("accepted", answer), /released/);
    next.answer("declined", answer);
    assert.throws(() => next.answer("accepted", answer), /already answered/);
  } finally { next.release(); }
  assert.equal(readRequest(root, id)!.state, "declined");
});

test("missing and malformed records release their answer locks", () => {
  const { root, id, lock } = request();
  const file = lock.slice(0, -".lock".length);
  fs.writeFileSync(file, "{broken");
  assert.throws(() => claimAnswer(root, id), /not found/);
  assert.equal(fs.existsSync(lock), false);
  fs.rmSync(file);
  assert.throws(() => answerRequest(root, id, "declined", answer), /not found/);
  assert.equal(fs.existsSync(lock), false);
});

test("a failed answer write releases the lock and preserves the pending record", () => {
  const { root, id, lock } = request();
  const tmp = `${lock.slice(0, -".lock".length)}.${process.pid}.tmp`;
  fs.mkdirSync(tmp); // Force the atomic writer to fail before replacing the record.
  assert.throws(() => answerRequest(root, id, "accepted", answer));
  assert.equal(fs.existsSync(lock), false);
  assert.equal(readRequest(root, id)!.state, "pending");
  fs.rmdirSync(tmp);
  assert.equal(answerRequest(root, id, "declined", answer).state, "declined");
});

test("requests persist their context and list pending before answered", () => {
  const { root, id } = request();
  const rec = readRequest(root, id)!;
  const later = { ...rec, id: newRequestId(new Date("2026-11-11T12:00:00Z")) };
  saveNew(root, later);
  answerRequest(root, id, "declined", answer);
  assert.deepEqual(listRequests(root).map((r) => r.id), [later.id, id]);
  assert.deepEqual(readRequest(root, later.id), later);
});
