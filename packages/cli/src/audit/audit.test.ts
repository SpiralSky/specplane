import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setClock } from "../clock.js";
import { storeDir } from "../repo/store.js";
import { makeRepo } from "../test-repo.js";
import { audit, resetAuditState } from "./log.js";
import { readAudit } from "./read.js";
import { pruneAudit } from "./retention.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const actor = { role: "standard-user", kind: "human" as const, name: "Pat Person" };
const NOW = new Date("2026-11-10T12:00:00Z");

function repo(config?: string): string {
  const root = makeRepo({ "README.md": "x\n", ...(config ? { ".specplane/config.yaml": config } : {}) });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat Person"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) {
    assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  }
  return root;
}
const entry = (root: string, command: string, daysAgo: number) =>
  audit(root, { command, args: [], permission: null, outcome: "done", actor }, new Date(NOW.getTime() - daysAgo * 86_400_000));
const log = (root: string) => path.join(storeDir(root), "audit.jsonl");
const commands = (root: string) => readAudit(root).entries.map((e) => e.command);
const sp = (root: string, ...a: string[]) => spawnSync("node", [cli, ...a], { cwd: root, encoding: "utf8" });

test("retention drops entries older than N days and records one audit prune entry", () => {
  const root = repo();
  entry(root, "old a", 40); entry(root, "old b", 31); entry(root, "recent", 5);
  const r = pruneAudit(root, 30, { now: NOW, actor });
  assert.deepEqual(r, { removed: 2, oldest: "2026-11-05" });
  assert.deepEqual(commands(root), ["recent", "audit prune"]);
  const prune = readAudit(root).entries.at(-1)!;
  assert.deepEqual(prune.new, { removed: 2, oldest: "2026-11-05" });
  assert.equal(fs.existsSync(path.join(storeDir(root), "audit.lock")), false);
});

test("retention forever keeps everything; nothing old means no prune entry", () => {
  const root = repo();
  entry(root, "ancient", 4000);
  assert.equal(pruneAudit(root, "forever", { now: NOW, actor }), null);
  assert.deepEqual(commands(root), ["ancient"]);
  const root2 = repo();
  entry(root2, "recent", 1);
  assert.equal(pruneAudit(root2, 30, { now: NOW, actor }), null);
  assert.deepEqual(commands(root2), ["recent"]);
});

test("retention keeps a line appended while the rewrite runs, and skips when the lock is held", () => {
  const root = repo();
  entry(root, "old", 40); entry(root, "recent", 1);
  pruneAudit(root, 30, { now: NOW, actor, beforeRename: () => { entry(root, "concurrent", 0); } });
  assert.deepEqual(commands(root), ["recent", "concurrent", "audit prune"]);
  entry(root, "old2", 99);
  fs.writeFileSync(path.join(storeDir(root), "audit.lock"), "");
  assert.equal(pruneAudit(root, 30, { now: NOW, actor }), null);
  assert.ok(commands(root).includes("old2"));
});

test("the reader filters, skips unparsable lines and counts them", () => {
  const root = repo();
  entry(root, "a", 10); entry(root, "b", 1);
  fs.appendFileSync(log(root), "not json\n");
  const all = readAudit(root);
  assert.equal(all.skipped, 1);
  assert.deepEqual(all.entries.map((e) => e.command), ["a", "b"]);
  assert.deepEqual(readAudit(root, { since: new Date(NOW.getTime() - 2 * 86_400_000) }).entries.map((e) => e.command), ["b"]);
  assert.equal(readAudit(root, { actor: "llm" }).entries.length, 0);
  assert.equal(readAudit(root, { branch: "main" }).entries.length, 2);
});

test("a read command writes an audit entry, and specplane audit lists it (text and JSON)", () => {
  const root = repo();
  assert.equal(sp(root, "permissions").status, 0);
  const r = sp(root, "audit");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /standard-user\/Pat Person {2}permissions {2}done/);
  const j = JSON.parse(sp(root, "audit", "--json", "--actor", "standard-user").stdout);
  assert.equal(j.ok, true);
  assert.ok(j.data.some((e: { command: string }) => e.command === "permissions"));
  assert.deepEqual(Object.keys(j), ["ok", "data", "findings", "warnings"]);
});

test("cli exit codes: usage 2, not a repository 3, refusal 1, success 0", () => {
  const root = repo();
  assert.equal(sp(root, "permissions").status, 0);
  assert.equal(sp(root, "config", "set", "tests.logs", "cloud").status, 1);
  assert.equal(sp(root, "audit", "--since", "yesterday-ish").status, 2);
  assert.equal(sp(root, "config", "get", "--bogus").status, 2);
  assert.equal(sp(root, "no-such-command").status, 2);
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "specplane-norepo-"));
  const n = sp(outside, "permissions");
  assert.equal(n.status, 3);
  assert.match(n.stderr, /Not in a git repository/);
  assert.equal(sp(outside, "--help").status, 0);
  assert.equal(sp(outside, "docs").status, 0);
});

test("an audit append failure is reported once as a warning and the command still succeeds", () => {
  const root = repo();
  fs.mkdirSync(path.join(storeDir(root)), { recursive: true });
  fs.mkdirSync(log(root)); // a directory where the file should be: appends fail
  const r = sp(root, "permissions", "--json");
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).warnings[0], /audit log could not be written/);
  resetAuditState();
});

test("the injectable clock drives audit timestamps", () => {
  const root = repo();
  setClock({ now: () => new Date("2020-01-02T03:04:05.678Z") });
  try { audit(root, { command: "x", args: [], permission: null, outcome: "done", actor }); } finally { setClock(null); }
  assert.equal(readAudit(root).entries[0].ts, "2020-01-02T03:04:05Z");
});
