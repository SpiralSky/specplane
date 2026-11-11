import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sp = (root: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input: "", env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const REQ = "---\nid: requirement/product-requirements\n---\n\n**R1: One**\nText\n";
const blk = (yaml: string) => `\`\`\`specplane-test\n${yaml}\n\`\`\`\n`;
const BODY = [
  "## R1: One", "",
  "Test T1 (deterministic): passes.", "", blk('run: ["sh", "-c", "echo hello; test \\"$SPECPLANE_TEST\\" = 1"]\nexpect:\n  stdout-contains: ["hello"]'),
  "Test T2 (deterministic): fails.", "", blk('run: ["sh", "-c", "echo nope"]\nexpect:\n  stdout-contains: ["yes"]'),
  "Test T3 (deterministic): no definition.", "",
  "Test T4 (intelligent): judged elsewhere.", "",
  "Test T5 (deterministic): environment is clean.", "", blk('run: ["sh", "-c", "echo [$LEAKED]"]\nexpect:\n  stdout-equals: "[]"'),
].join("\n");
const spec = (body: string) => `---\nid: feature/alpha\ntitle: A\nauthors: [{human: ann}]\ncovers: [R1]\nreferences: []\n---\n\n${body}\n`;

function repo(body = BODY, config = ""): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-test-run-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "tester");
  git(root, "config", "user.email", "t@t");
  const files: Record<string, string> = { "docs/requirements/product-requirements.md": REQ, "docs/specifications/features/alpha.md": spec(body) };
  if (config) files[".specplane/config.yaml"] = config;
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "c");
  return root;
}
const store = (root: string) => path.join(root, ".git", "specplane");
const rm = (root: string) => fs.rmSync(root, { recursive: true, force: true });

test("test run reports passed, failed, no-definition and intelligent tests; failure exits 1", () => {
  const root = repo();
  try {
    const r = sp(root, ["test", "run", "alpha", "--json"], { LEAKED: "secret" });
    assert.equal(r.code, 1, r.err);
    const out = JSON.parse(r.out).data.results as { test: string; outcome: string; summary: string; log?: string }[];
    assert.deepEqual(out.map((x) => [x.test, x.outcome]), [["R1#T1", "passed"], ["R1#T2", "failed"], ["R1#T3", "not-run"], ["R1#T4", "not-run"], ["R1#T5", "passed"]]);
    assert.match(out[1].summary, /stdout does not contain "yes"\nstdout begins:\nnope/);
    assert.match(out[2].summary, /no runnable definition/);
    assert.match(out[3].summary, /needs a harness/);
    const text = sp(root, ["test", "run", "feature/alpha#R1"]);
    assert.match(text.out, /2 passed, 1 failed, 2 not run/);
    assert.equal(text.code, 1);
  } finally { rm(root); }
});

test("a temporary worktree is removed, the dirty tree is noted, and the committed content is what runs", () => {
  const root = repo();
  try {
    fs.appendFileSync(path.join(root, "docs/specifications/features/alpha.md"), "\nEdited.\n");
    const r = sp(root, ["test", "run", "alpha#R1"]);
    assert.match(r.out, /note: the working tree has uncommitted changes; the committed state \(\w{8}\) was tested/);
    assert.equal(git(root, "worktree", "list").split("\n").length, 1);
    assert.deepEqual(fs.readdirSync(path.join(store(root), "tmp")), []);
  } finally { rm(root); }
});

test("setup, cwd, timeout and exit expectations", () => {
  const body = [
    "## R1: One", "",
    "Test T1 (deterministic): setup makes a file.", "", blk('setup: [["sh", "-c", "echo data > made.txt"]]\nrun: ["cat", "made.txt"]\nexpect:\n  stdout-equals: "data"'),
    "Test T2 (deterministic): setup failure.", "", blk('setup: [["sh", "-c", "exit 4"]]\nrun: ["true"]'),
    "Test T3 (deterministic): timeout.", "", blk('run: ["sleep", "5"]'),
    "Test T4 (deterministic): expected non-zero exit.", "", blk('run: ["sh", "-c", "exit 2"]\nexpect:\n  exit: 2'),
    "Test T5 (deterministic): missing program.", "", blk('run: ["no-such-program-xyz"]'),
    "Test T6 (deterministic): cwd.", "", blk('cwd: docs\nrun: ["ls", "requirements"]\nexpect:\n  stdout-contains: ["product-requirements.md"]'),
  ].join("\n");
  const root = repo(body);
  try {
    const r = JSON.parse(sp(root, ["test", "run", "alpha", "--timeout", "0.5", "--json"]).out).data.results as { test: string; outcome: string; summary: string }[];
    const by = Object.fromEntries(r.map((x) => [x.test, x]));
    assert.equal(by["R1#T1"].outcome, "passed");
    assert.match(by["R1#T2"].summary, /setup `sh -c exit 4` failed: exit 4/);
    assert.match(by["R1#T3"].summary, /timed out after 0.5s/);
    assert.equal(by["R1#T4"].outcome, "passed");
    assert.match(by["R1#T5"].summary, /could not start/);
    assert.equal(by["R1#T6"].outcome, "passed");
    assert.deepEqual(fs.readdirSync(path.join(store(root), "tmp")), []);
  } finally { rm(root); }
});

test("selection: --all, a preamble test, and a missing target", () => {
  const body = `Test T1 (deterministic): preamble.\n\n${blk('run: ["true"]')}\n${BODY}`;
  const root = repo(body);
  try {
    assert.equal(sp(root, ["test", "run", "alpha#T1", "--json"]).code, 0);
    const one = JSON.parse(sp(root, ["test", "run", "alpha#T1", "--json"]).out).data.results;
    assert.deepEqual(one.map((x: { test: string }) => x.test), ["feature/alpha#T1"]);
    const all = JSON.parse(sp(root, ["test", "run", "--all", "--json"]).out).data.results;
    assert.equal(all.length, 6);
    const none = sp(root, ["test", "run"]);
    assert.equal(none.code, 1);
    assert.match(none.err, /--all/);
    assert.equal(sp(root, ["test", "run", "nope"]).code, 1);
  } finally { rm(root); }
});

test("logs follow tests.logs: local writes to the store, off writes nothing, git writes into the project with a warning", () => {
  const body = ["## R1: One", "", "Test T1 (deterministic): ok.", "", blk('run: ["echo", "visible"]')].join("\n");
  const root = repo(body);
  try {
    const out = JSON.parse(sp(root, ["test", "run", "alpha", "--json"]).out).data.results[0];
    assert.match(out.log, /^\d{8}T\d{6}Z-[0-9a-f]{4}$/);
    const text = fs.readFileSync(path.join(store(root), "logs", `${out.log}.log`), "utf8");
    assert.match(text, /spec: feature\/alpha\ntest: R1#T1\ncommit: \w{40}\nactor: human:tester/);
    assert.match(text, /--- stdout ---\nvisible/);
  } finally { rm(root); }
  const off = repo(body, "tests:\n  logs: off\n");
  try {
    assert.equal(JSON.parse(sp(off, ["test", "run", "alpha", "--json"]).out).data.results[0].log, undefined);
    assert.equal(fs.existsSync(path.join(store(off), "logs")), false);
  } finally { rm(off); }
  const g = repo(body, "tests:\n  logs: git\n");
  try {
    const r = JSON.parse(sp(g, ["test", "run", "alpha", "--json"]).out);
    assert.match(r.warnings.join("\n"), /tests.logs is git/);
    assert.equal(fs.readdirSync(path.join(g, "docs/test-logs")).length, 1);
    assert.match(sp(g, ["validate"]).out + sp(g, ["warnings"]).out, /tests.logs is git/);
  } finally { rm(g); }
});

test("old local logs are pruned at the next command and the prune is audited; git logs stay", () => {
  const root = repo();
  try {
    const dir = path.join(store(root), "logs");
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, "20200101T000000Z-aaaa.log");
    const fresh = path.join(dir, "20991231T000000Z-bbbb.log");
    fs.writeFileSync(old, "x"); fs.writeFileSync(fresh, "y");
    const past = new Date(Date.now() - 40 * 86_400_000);
    fs.utimesSync(old, past, past);
    sp(root, ["validate"]);
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.match(fs.readFileSync(path.join(store(root), "audit.jsonl"), "utf8"), /"command":"logs prune".*"removed":1/);
  } finally { rm(root); }
});

test("validate reports a duplicate label and an invalid block as errors", () => {
  const body = ["## R1: One", "", "Test T1 (deterministic): a.", "Test T1 (deterministic): b.", "", "Test T2 (deterministic): c.", "", blk("run: validate"), "Test T3 (intelligent): d.", "", blk('run: ["x"]')].join("\n");
  const root = repo(body);
  try {
    const r = sp(root, ["validate", "--json"]);
    assert.equal(r.code, 1);
    const f = JSON.parse(r.out).data.findings.filter((x: { rule: string }) => x.rule === "tests").map((x: { severity: string; message: string }) => `${x.severity}: ${x.message}`);
    assert.ok(f.some((m: string) => /error: test label T1 is declared twice in R1/.test(m)), f.join("\n"));
    assert.ok(f.some((m: string) => /error: R1#T2: `run` must be a non-empty list/.test(m)), f.join("\n"));
    assert.ok(f.some((m: string) => /warning: R1#T3 is intelligent/.test(m)), f.join("\n"));
    const run = JSON.parse(sp(root, ["test", "run", "alpha", "--json"]).out).data.results;
    assert.match(run[0].summary, /declared twice/);
  } finally { rm(root); }
});
