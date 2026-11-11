import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { editConfig } from "./config-edit.js";
import { editKeys } from "./spec/fm-edit.js";
import { specFingerprint } from "./spec/fingerprint.js";
import { splitFrontmatter } from "./spec/frontmatter.js";
import { dumpYaml, parseYaml } from "./yaml.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("parsing is JSON-compatible: string keys, no duplicates, dates and words stay strings", () => {
  assert.deepEqual(parseYaml("date: 2026-11-11\nmode: off\nlist: [a, b]\nn: 3\nflag: true\nnone: ~\n"), { date: "2026-11-11", mode: "off", list: ["a", "b"], n: 3, flag: true, none: null });
  assert.throws(() => parseYaml("a: 1\na: 2\n"), /unique/i);
  assert.throws(() => parseYaml("1: a\n"), /keys must be strings/);
  assert.throws(() => parseYaml("? [a]\n: b\n"), /keys must be strings/);
  assert.equal(parseYaml(""), null);
  assert.equal(splitFrontmatter("---\nid: x\nid: y\n---\n").data, null);
});

test("dumping writes block style, single quotes, no folding, and flow lists on request", () => {
  assert.equal(dumpYaml({ k: ["a", "b"] }, { flowScalarLists: true }), "k: [a, b]\n");
  assert.equal(dumpYaml({ k: ["a", "b"] }), "k:\n  - a\n  - b\n");
  assert.equal(dumpYaml({ k: "on: x" }), "k: 'on: x'\n");
  assert.equal(dumpYaml({ k: "word ".repeat(40).trim() }).trim().split("\n").length, 1);
  assert.equal(dumpYaml({ mode: "off", d: "2026-11-11" }), "mode: off\nd: 2026-11-11\n");
  assert.deepEqual(parseYaml(dumpYaml({ a: { b: [1, "x y", null, true] }, s: "it's: odd" })), { a: { b: [1, "x y", null, true] }, s: "it's: odd" });
});

test("round-trip edits keep comments and untouched text byte for byte", () => {
  const config = "# top comment\nspecs:\n  # why\n  review:   [a,   b]   # keep spacing\n\n  other: 1\nplans:\n  dir: plans # inline\n";
  const set = editConfig(config, "plans.dir", "work");
  assert.equal(set, config.replace("  dir: plans # inline\n", "  dir: work\n"));
  assert.equal(editConfig(set, "plans.dir", undefined), config.replace("plans:\n  dir: plans # inline\n", ""));
  assert.equal(editConfig(config, "specs.other", 2), config.replace("other: 1", "other: 2"));
  const fm = "---\nid: a\n# note\ntitle: A   # trailing\ncovers:   [x,    y]\nauthors: []\n---\n# Body\n";
  const edited = editKeys(fm, { title: "B" });
  assert.equal(edited, fm.replace("title: A   # trailing\n", "title: B\n"));
  assert.equal(editKeys(edited, { title: undefined }), fm.replace("title: A   # trailing\n", ""));
  assert.equal(editKeys(fm, { covers: ["x", "y"] }), fm.replace("covers:   [x,    y]", "covers: [x, y]"));
});

test("every spec and plan file of this repository keeps its fingerprint and parsed data through a no-op key rewrite", () => {
  let checked = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".md")) {
        const text = fs.readFileSync(p, "utf8");
        const fm = splitFrontmatter(text);
        if (!fm.data || typeof fm.data.id !== "string") continue;
        const out = editKeys(text, { id: fm.data.id });
        assert.equal(out, text, p);
        assert.equal(specFingerprint(out), specFingerprint(text), p);
        checked++;
      }
    }
  };
  walk(path.join(repoRoot, "docs"));
  assert.ok(checked > 10);
});
