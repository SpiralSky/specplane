import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SpecNotFoundError } from "../errors.js";
import { claudeAdapter, codexAdapter } from "../harness/adapters.js";
import { requireCapability } from "../harness/adapter.js";
import { runHarnessCommand } from "../harness/run.js";
import { highlightDiff, specViewCommand } from "./spec-view.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const REQ = "---\nid: requirement/product-requirements\n---\n\n**R1: One**\nText\n";
const ALPHA = "---\nid: feature/alpha\ntitle: Alpha\nauthors: [{human: ann}]\ncovers: [R1]\nreferences: []\n---\n\n## R1: Heading\n\nText.\n";
const alpha = "docs/specifications/features/alpha.md";

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-spec-view-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "tester");
  git(root, "config", "user.email", "t@t");
  for (const [f, text] of Object.entries({ "docs/requirements/product-requirements.md": REQ, [alpha]: ALPHA })) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), text);
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "c");
  return root;
}
const approve = (root: string) => assert.equal(spawnSync(process.execPath, [cli, "spec", "approve", "feature/alpha", "--yes"], { cwd: root, encoding: "utf8", input: "" }).status, 0);

test("a never-approved spec is shown as all new, with status and text", () => {
  const root = repo();
  try {
    const r = specViewCommand(root, "feature/alpha");
    assert.equal(r.ok, true);
    const text = (r.lines ?? []).join("\n");
    assert.match(text, /feature\/alpha {2}Alpha/);
    assert.match(text, /status: awaiting-review/);
    assert.match(text, /Never approved/);
    assert.match(text, /## R1: Heading/);
    assert.equal(r.permission, "info.retrieve");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("an approved spec with no change says so; a change since approval is shown as a diff, highlighted on a terminal", () => {
  const root = repo();
  try {
    approve(root);
    assert.match((specViewCommand(root, "alpha").lines ?? []).join("\n"), /No change since the last approval/);
    fs.appendFileSync(path.join(root, alpha), "\nAdded sentence.\n");
    const plain = specViewCommand(root, "feature/alpha");
    assert.equal((plain.data as { changed: boolean }).changed, true);
    const lines = plain.lines ?? [];
    assert.ok(lines.includes("Changed since the last approval:"));
    assert.ok(lines.includes("+Added sentence."));
    assert.ok(!lines.some((l) => l.includes("\u001b")), "no colour unless asked");
    assert.ok(!lines.some((l) => l.startsWith("+++") || l.startsWith("diff --git")), "file headers dropped");
    const coloured = specViewCommand(root, "feature/alpha", true).lines ?? [];
    assert.ok(coloured.includes("\u001b[32m+Added sentence.\u001b[0m"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a requirement file shows its change since HEAD, and an unknown id is not found", () => {
  const root = repo();
  try {
    fs.appendFileSync(path.join(root, "docs/requirements/product-requirements.md"), "\n**R2: Two**\nNew\n");
    const r = specViewCommand(root, "requirement/product-requirements");
    assert.match((r.lines ?? []).join("\n"), /Changed since HEAD:/);
    assert.ok((r.lines ?? []).includes("+**R2: Two**"));
    assert.throws(() => specViewCommand(root, "feature/nope"), SpecNotFoundError);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("highlightDiff colours additions, deletions and hunk headers", () => {
  const out = highlightDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n", true);
  assert.deepEqual(out, ["\u001b[36m@@ -1 +1 @@\u001b[0m", "\u001b[31m-old\u001b[0m", "\u001b[32m+new\u001b[0m"]);
});

test("the typed command runs with no model turn: with no id it lists specs, with an id it shows one", async () => {
  const root = repo();
  try {
    const list = await runHarnessCommand("spec-view", [], root);
    assert.equal(list.ok, true);
    assert.ok((list.lines ?? []).some((l) => /^feature\/alpha\s+awaiting-review$/.test(l)));
    assert.ok(!(list.data as { passToLlm?: unknown } | undefined)?.passToLlm);
    const one = await runHarnessCommand("spec-view", ["alpha"], root);
    assert.equal(one.ok, true);
    assert.ok(!(one.data as { passToLlm?: unknown }).passToLlm);
    assert.match((one.lines ?? []).join("\n"), /Never approved/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Claude reports the viewing capability; Codex lacks it and refuses by name (harness R35.1)", () => {
  assert.equal(claudeAdapter.capabilities().viewing, true);
  assert.doesNotThrow(() => requireCapability(claudeAdapter, "viewing", "spec-view"));
  assert.throws(() => requireCapability(codexAdapter, "viewing", "spec-view"), /viewing specifications/);
});

test("harness run spec-view for a host without the viewing capability is refused by name, and still runs for Claude (harness R35.1)", async () => {
  const root = repo();
  try {
    await assert.rejects(runHarnessCommand("spec-view", [], root, { adapter: "codex" }), /spec-view needs viewing specifications, which codex does not support; nothing was done/);
    await assert.rejects(runHarnessCommand("spec-view", ["alpha"], root, { adapter: "codex" }), /viewing specifications/);
    const ok = await runHarnessCommand("spec-view", [], root, { adapter: "claude" });
    assert.equal(ok.ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("harness run spec-view with no --adapter falls back to SPECPLANE_ADAPTER, and runs when neither is set (harness R35.1)", async () => {
  const root = repo();
  const saved = process.env.SPECPLANE_ADAPTER;
  try {
    process.env.SPECPLANE_ADAPTER = "codex";
    await assert.rejects(runHarnessCommand("spec-view", [], root), /spec-view needs viewing specifications, which codex does not support/);
    delete process.env.SPECPLANE_ADAPTER;
    const ok = await runHarnessCommand("spec-view", [], root);
    assert.equal(ok.ok, true);
  } finally {
    if (saved === undefined) delete process.env.SPECPLANE_ADAPTER; else process.env.SPECPLANE_ADAPTER = saved;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
