import assert from "node:assert/strict";
import { test } from "node:test";
import { citeKey, extractBodyCites, parseCite } from "./cites.js";
import { canonicalJson, partFingerprint, planFingerprint, specFingerprint } from "./fingerprint.js";
import { splitFrontmatter } from "./frontmatter.js";
import { checkRequirementIds, nextRequirementId, parseRequirementFile } from "./requirements.js";
import { indexSections } from "./sections.js";

const SPEC = `---
id: feature/demo
title: Demo
status: awaiting-review
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
covers: [R1]
references: [plans R28]
---

# Demo

## R1: First

Text citing \`plans R28\`.

### R1.1: Sub

Sub text.

## §1 Terms

\`\`\`
## R9: not a heading
\`\`\`
`;

test("frontmatter: split, dates stay strings, body starts after the closing fence", () => {
  const fm = splitFrontmatter("---\nid: x\ndate: 2026-11-09\n---\nbody\n");
  assert.equal(fm.data?.date, "2026-11-09");
  assert.equal(fm.body, "body\n");
  assert.equal(fm.bodyStartLine, 4);
});

test("frontmatter: missing, unclosed, invalid and duplicate keys are reported", () => {
  assert.equal(splitFrontmatter("# no frontmatter\n").missing, true);
  assert.match(splitFrontmatter("---\nid: x\n").error!, /not closed/);
  assert.match(splitFrontmatter("---\n: : :\n  bad: [\n---\n").error!, /invalid YAML/);
  assert.match(splitFrontmatter("---\nid: a\nid: b\n---\n").error!, /invalid YAML/);
  assert.match(splitFrontmatter("---\n- a\n---\n").error!, /not a mapping/);
});

test("sections: ids, ranges include subsections, fenced code ignored, wrong parent reported", () => {
  const lines = SPEC.split("\n");
  const fm = splitFrontmatter(SPEC);
  const idx = indexSections(lines, fm.bodyStartLine);
  assert.deepEqual([...idx.byId.keys()], ["R1", "R1.1", "§1"]);
  const r1 = idx.byId.get("R1")!;
  const sub = idx.byId.get("R1.1")!;
  assert.ok(r1.endLine >= sub.endLine, "R1 includes its subsection");
  assert.equal(lines[r1.endLine], "## §1 Terms");
  assert.deepEqual(idx.duplicates, []);
  const bad = indexSections(["## R2: A", "### R3.1: B", "## R2: A again"], 0);
  assert.equal(bad.duplicates.length, 1);
  assert.equal(bad.wrongParent[0].id, "R3.1");
});

test("cites: grammar shapes", () => {
  assert.deepEqual(parseCite("R11.2"), { kind: "req", raw: "R11.2", project: null, reqId: "R11.2" });
  const s = parseCite("plans R28");
  assert.ok(s && s.kind === "section" && s.slug === "plans" && s.layer === "feature" && s.sectionId === "R28");
  const p = parseCite("plans §2.1");
  assert.ok(p && p.kind === "section" && p.sectionId === "§2.1");
  const a = parseCite("architecture/file-formats §4");
  assert.ok(a && a.kind === "section" && a.layer === "architecture" && a.slug === "file-formats");
  const sub = parseCite("claude:harness R14");
  assert.ok(sub && sub.kind === "section" && sub.project === "claude");
  const sub2 = parseCite("claude:R7");
  assert.ok(sub2 && sub2.kind === "req" && sub2.project === "claude");
  assert.equal(parseCite("file:docs/x.md")?.kind, "file");
  assert.equal(parseCite("plan/2026-11-09-first-plan")?.kind, "plan");
  assert.equal(parseCite("requirement/product-requirements")?.kind, "req-file");
  assert.equal(parseCite("plans")?.kind, "spec");
  assert.equal(parseCite("outdated: plans R28"), null, "a space after the colon is not a project prefix");
  assert.equal(parseCite("file:<path>"), null);
  assert.equal(parseCite("R<n>"), null);
  assert.equal(citeKey("root:R7"), "R7");
});

test("cites: extraction skips fenced code, non-cite spans and self-cites", () => {
  const fm = splitFrontmatter(SPEC);
  const lines = SPEC.split("\n");
  const idx = indexSections(lines, fm.bodyStartLine);
  const found = extractBodyCites(lines, fm.bodyStartLine, idx, { layer: "feature", slug: "demo" }, (l, s) => l === "feature" && s === "plans");
  assert.deepEqual(found.map((f) => f.raw), ["plans R28"]);
  const text = ["## R1: A", "`R1` is itself, `R2` is not, `plans`, `approved`, `R<n>`", "```", "`R3`", "```"];
  const got = extractBodyCites(text, 0, indexSections(text, 0), { layer: "feature", slug: "demo" }, (l, s) => s === "plans");
  assert.deepEqual(got.map((f) => f.raw), ["R2", "plans"]);
});

test("requirements: markers, ranges include sub-requirements, retired list", () => {
  const text = "# Page\n\n**R1: One**\nText\n\n*R1.1: Sub*\nSub text\n\n**R2: Two**\nMore\n\n## Heading\nafter\n\nRetired IDs: `R3`, `R4`.\n";
  const f = parseRequirementFile("req.md", text);
  assert.deepEqual(f.requirements.map((r) => r.id), ["R1", "R1.1", "R2"]);
  const r1 = f.requirements[0];
  assert.equal(r1.startLine, 3);
  assert.equal(r1.endLine, 8, "R1 runs through R1.1 to the next marker");
  assert.match(r1.text, /Sub text/);
  assert.equal(f.requirements[2].endLine, 11, "R2 ends before the next heading");
  assert.deepEqual(f.retired?.ids, ["R3", "R4"]);
  assert.equal(nextRequirementId([f]), "R5");
});

test("requirements: duplicate, retired-in-use and orphan IDs are reported", () => {
  const f = parseRequirementFile("req.md", "**R1: A**\n\n**R1: B**\n\n*R5.1: C*\n\n**R2: D**\n\nRetired IDs: `R2`.\n");
  const msgs = checkRequirementIds([f], "req.md").map((p) => p.message);
  assert.ok(msgs.some((m) => /duplicate requirement ID R1/.test(m)));
  assert.ok(msgs.some((m) => /R2 is on the retired list/.test(m)));
  assert.ok(msgs.some((m) => /R5.1 has no parent R5/.test(m)));
});

test("fingerprints: spec-v2 ignores status, approval, authors, review-reason; counts body and dependencies", () => {
  const base = specFingerprint(SPEC)!;
  assert.match(base, /^spec-v2:sha256:[0-9a-f]{64}$/);
  const approved = SPEC.replace("status: awaiting-review", "status: approved\napproval:\n  commit: abc").replace("authors:\n  - llm: claude-sonnet-5-5\n    contribution: drafted", "authors: []\nreview-reason: edited");
  assert.equal(specFingerprint(approved), base);
  assert.notEqual(specFingerprint(SPEC.replace("Sub text.", "Sub text!")), base);
  assert.notEqual(specFingerprint(SPEC.replace("covers: [R1]", "covers: [R1, R2]")), base);
  assert.equal(specFingerprint(SPEC.replace(/\n/g, "\r\n")), base, "CRLF is normalised to LF");
  assert.equal(specFingerprint("no frontmatter"), null);
});

test("fingerprints: canonical JSON sorts keys by code point; sec-v1 trims trailing blank lines", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, "é"], "\u{1F600}": 2, "～": 3 }), '{"a":[true,null,"é"],"b":1,"～":3,"\u{1F600}":2}');
  assert.equal(partFingerprint("a\nb\n\n\n"), partFingerprint("a\r\nb"));
  assert.notEqual(partFingerprint("a\nb"), partFingerprint("a\nc"));
  assert.match(partFingerprint("x"), /^sec-v1:sha256:/);
});

test("fingerprints: plan-v1 ignores the commit of each implements entry", () => {
  const plan = (c: string) => `---\nid: plan/x\nstatus: approved\nimplements:\n  - {spec: feature/a, commit: ${c}, mode: writes}\n---\nBody\n`;
  assert.equal(planFingerprint(plan("1")), planFingerprint(plan("2")));
  assert.match(planFingerprint(plan("1"))!, /^plan-v1:sha256:/);
});
