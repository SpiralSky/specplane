import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { makeRepo } from "../test-repo.js";
import { specApproveHuman } from "../commands/spec-human.js";
import { readNotes } from "./notes.js";
import { bestMatches, candidates, isExactId, matchListing, MAX_MATCHES, type Candidate } from "./match.js";

const spec = (id: string, title: string) =>
  `---\nid: feature/${id}\ntitle: ${title}\nauthors:\n  - human: someone\ncovers: []\n---\n\n# ${title}\n\n## R9: Part\n\nText.\n`;

function repo(): string {
  const root = makeRepo({
    "docs/specifications/features/preset-creation.md": spec("preset-creation", "Preset creation"),
    "docs/specifications/features/presets.md": spec("presets", "Permission presets"),
    "docs/specifications/features/harness.md": spec("harness", "Harness"),
  });
  const sh = (...a: string[]) => assert.equal(spawnSync("git", a, { cwd: root, encoding: "utf8" }).status, 0, a.join(" "));
  sh("init", "-q", "-b", "main"); sh("config", "user.name", "Pat Person"); sh("config", "user.email", "pat@example.com");
  sh("add", "-A"); sh("commit", "-q", "-m", "init");
  return root;
}

async function typed(root: string, ids: string[]) {
  const cwd = process.cwd();
  process.chdir(root);
  try { return await specApproveHuman(ids, { yes: true }); } finally { process.chdir(cwd); }
}

test("approve by name: an exact ID approves as before", async () => {
  const root = repo();
  const r = await typed(root, ["feature/harness"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(readNotes(root).bySpec.get("feature/harness")?.length);
});

test("approve by name: an inexact name approves nothing and lists matches by kind", async () => {
  const root = repo();
  const r = await typed(root, ["Harnes"]);
  assert.equal(r.ok, false);
  assert.match((r.lines ?? []).join("\n"), /Specifications:\n {2}feature\/harness — Harness/);
  assert.equal(readNotes(root).bySpec.get("feature/harness")?.length ?? 0, 0);
});

test("approve by name: multi-word names match words in IDs and titles, case-insensitively", async () => {
  const root = repo();
  const r = await typed(root, ["PRESET", "creation"]);
  assert.equal(r.ok, false);
  const text = (r.lines ?? []).join("\n");
  assert.match(text, /feature\/preset-creation — Preset creation/);
  assert.doesNotMatch(text, /feature\/harness/);
  assert.doesNotMatch(text, /feature\/presets —/);
});

test("approve by name: a name that matches nothing says so", async () => {
  const root = repo();
  const r = await typed(root, ["zzz-nothing"]);
  assert.equal(r.ok, false);
  assert.match((r.lines ?? []).join("\n"), /matches no specification, plan or decision\. Nothing was approved/);
});

test("matcher: at most ten matches, grouped by specification, plan and decision", () => {
  const all: Candidate[] = [
    ...Array.from({ length: 12 }, (_, i) => ({ kind: "specification" as const, id: `feature/item-${i}`, title: "Item" })),
    { kind: "plan", id: "2026-01-01-item", title: "Item plan" },
    { kind: "decision", id: "D1", title: "Item decision" },
  ];
  assert.equal(isExactId(all, "D1"), true);
  assert.equal(isExactId(all, "item"), false);
  assert.equal(bestMatches(all, "item").length, MAX_MATCHES);
  const lines = matchListing("item", [all[0], all[12], all[13]]);
  assert.deepEqual(lines.filter((l) => /^\w+:$/.test(l)), ["Specifications:", "Plans:", "Decisions:"]);
  assert.ok(candidates(repo()).every((c) => c.kind === "specification"));
});
