import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireWriterLease, checkoutIdentity, type LeaseRecoveryIo } from "../core/writer-leases.js";
import { workflowListCommand, workflowRecoverCommand } from "./workflow.js";

// PROVISIONAL (D20 item 6). Every fixture is a temp repository; no real lease or .specplane state is touched.
const DEAD = 2147483647;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-recover-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
  git("init"); git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "--allow-empty", "-m", "i");
  const runtime = path.join(checkoutIdentity(root).commonDir, "specplane-runtime");
  fs.mkdirSync(path.join(root, ".specplane", "receipts"), { recursive: true });
  const receipt = path.join(root, ".specplane", "receipts", "r.json"); fs.writeFileSync(receipt, "{}");
  const edit = path.join(root, "model-edit.txt"); fs.writeFileSync(edit, "x");
  const lease = acquireWriterLease({ checkouts: [root], requestId: "req-1" });
  lease.retainHostWorker();
  const files = (n: string) => fs.readdirSync(runtime).filter((f) => f.endsWith(n)).map((f) => path.join(runtime, f));
  const setPid = (pid: number) => { for (const f of files(".json")) fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), pid })); };
  const snapshot = () => fs.readdirSync(runtime).sort().map((f) => `${f}:${fs.readFileSync(path.join(runtime, f), "utf8")}`);
  return { lease, root, runtime, receipt, edit, files, setPid, snapshot, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function io(over: Partial<LeaseRecoveryIo> & { answer?: string } = {}) {
  const lines: string[] = []; const asked: string[] = [];
  const value: LeaseRecoveryIo = { isTTY: true, print: (l) => lines.push(l), ask: async (q) => { asked.push(q); return over.answer ?? ""; }, ...over };
  return { value, lines, asked };
}
const rejects = (p: Promise<void>, re: RegExp) => assert.rejects(p, re);

test("list is read-only and reports a live owner", () => {
  const f = fixture(); try {
    const before = f.snapshot(); let out = "";
    workflowListCommand({}, f.root, (s) => { out += s; });
    assert.match(out, /req-1\towner \d+ alive/); assert.match(out, /owner-alive/);
    workflowListCommand({ json: true }, f.root, (s) => { out = s; });
    assert.equal(JSON.parse(out)[0].state, "owner-alive");
    assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("recover refuses a live owner, even with a terminal and the right id", async () => {
  const f = fixture(); try {
    const before = f.snapshot(); const t = io({ answer: "req-1" });
    await rejects(workflowRecoverCommand("req-1", {}, f.root, t.value), /not recoverable: The owner process is still alive/);
    assert.equal(t.asked.length, 0); assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("recover refuses without a terminal, and has no --yes", async () => {
  const f = fixture(); try {
    f.setPid(DEAD); const before = f.snapshot();
    await rejects(workflowRecoverCommand("req-1", {}, f.root, io({ isTTY: false, answer: "req-1" }).value), /CONFIRMATION_REQUIRED/);
    assert.deepEqual(f.snapshot(), before);
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
    const yes = spawnSync(process.execPath, [cli, "workflow", "recover", "req-1", "--yes"], { cwd: f.root, encoding: "utf8", input: "" });
    assert.notEqual(yes.status, 0); assert.match(yes.stderr, /unknown option/);
    const piped = spawnSync(process.execPath, [cli, "workflow", "recover", "req-1"], { cwd: f.root, encoding: "utf8", input: "req-1\n" });
    assert.notEqual(piped.status, 0); assert.match(piped.stderr, /CONFIRMATION_REQUIRED/);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("recover refuses a wrong typed id and an unknown id", async () => {
  const f = fixture(); try {
    f.setPid(DEAD); const before = f.snapshot();
    await rejects(workflowRecoverCommand("req-1", {}, f.root, io({ answer: "req-2" }).value), /does not match/);
    await rejects(workflowRecoverCommand("nope", {}, f.root, io({ answer: "nope" }).value), /No retained host lease/);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("recover refuses a lease it cannot identify", async () => {
  const f = fixture(); try {
    f.setPid(DEAD);
    const [record] = f.files(".json"); const saved = fs.readFileSync(record, "utf8");
    fs.writeFileSync(record, JSON.stringify({ ...JSON.parse(saved), requestId: "other" }));
    let before = f.snapshot();
    await rejects(workflowRecoverCommand("req-1", {}, f.root, io({ answer: "req-1" }).value), /not recoverable: Cannot identify the lease/);
    fs.writeFileSync(record, saved);
    const [marker] = f.files(".marker"); fs.writeFileSync(marker, "not json");
    before = f.snapshot();
    let out = ""; workflowListCommand({}, f.root, (s) => { out += s; });
    assert.match(out, /unidentifiable/);
    await rejects(workflowRecoverCommand("req-1", {}, f.root, io({ answer: "req-1" }).value), /No retained host lease/);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("recover refuses when recording had begun", async () => {
  const f = fixture(); try {
    f.lease.bindRecoveryEvidence("a".repeat(64)); f.setPid(DEAD); const before = f.snapshot();
    await rejects(workflowRecoverCommand("req-1", {}, f.root, io({ answer: "req-1" }).value), /Recording had begun/);
    assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("dry-run needs no terminal and changes nothing", async () => {
  const f = fixture(); try {
    f.setPid(DEAD); const before = f.snapshot(); const t = io({ isTTY: false });
    await workflowRecoverCommand("req-1", { dryRun: true }, f.root, t.value);
    assert.match(t.lines.join("\n"), /Dry run/); assert.equal(t.asked.length, 0); assert.deepEqual(f.snapshot(), before);
  } finally { f.cleanup(); }
});

test("confirmed recovery releases only the lease and keeps receipts, evidence and edits", async () => {
  const f = fixture(); try {
    f.setPid(DEAD);
    const t = io({ answer: " req-1 " });
    await workflowRecoverCommand("req-1", {}, f.root, t.value);
    assert.deepEqual(fs.readdirSync(f.runtime).filter((n) => n.endsWith(".json") || n.endsWith(".marker")), []);
    assert.ok(fs.existsSync(f.receipt)); assert.ok(fs.existsSync(f.edit));
    assert.match(t.lines.join("\n"), /git status/);
    const next = acquireWriterLease({ checkouts: [f.root], requestId: "after" }); next.release();
  } finally { f.cleanup(); }
});

test("a later acquire meeting the retained lease names the request id and the recover command", () => {
  const f = fixture(); try {
    f.setPid(DEAD);
    assert.throws(() => acquireWriterLease({ checkouts: [f.root], requestId: "req-2" }),
      /explicit recovery is required\. Request req-1: run `specplane workflow list`, then `specplane workflow recover req-1`\./);
  } finally { f.cleanup(); }
});
