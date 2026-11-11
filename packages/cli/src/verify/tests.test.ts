import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSpecDoc } from "../spec/project.js";
import { checkExpect } from "./test-run.js";
import { allTests, declarations, parseBlock } from "./tests.js";

const doc = (body: string) => makeSpecDoc("feature", "alpha", "docs/specifications/features/alpha.md", `---\nid: feature/alpha\ntitle: A\nauthors: []\n---\n\n${body}`);

test("Test lines get section-labelled IDs, ignore fenced code, and the preamble ones use the spec ID", () => {
  const d = doc("Test T1 (intelligent): the spec reads well.\n\n## R1: One\n\nTest T2 (deterministic): runs.\n- Test T1 (intelligent): judged.\n\n```\nTest T9 (deterministic): fenced\n```\n\n### R1.1: Sub\n\nTest T1 (deterministic): sub.\n");
  const decl = declarations(d);
  assert.deepEqual(allTests(decl).map((t) => t.id), ["feature/alpha#T1", "R1#T2", "R1#T1", "R1.1#T1"]);
  const r1 = decl.sections.find((s) => s.id === "R1")!;
  assert.equal(r1.effective, "own");
  assert.equal(r1.needsVerdict, true);
  assert.equal(decl.sections.find((s) => s.id === "R1.1")!.needsVerdict, false);
});

test("A section without Test lines inherits the preamble; a spec that declares nothing needs a verdict per section", () => {
  const inherit = declarations(doc("Test T1 (deterministic): all.\n\n## R1: One\n\nText.\n"));
  assert.equal(inherit.sections[0].effective, "spec");
  assert.equal(inherit.sections[0].needsVerdict, false);
  const none = declarations(doc("## R1: One\n\nText.\n"));
  assert.equal(none.sections[0].effective, "none");
  assert.equal(none.sections[0].needsVerdict, true);
  assert.equal(none.sections[0].verdictId, "R1#0");
});

test("A duplicate label in one section is reported and flagged; the same label in two sections is fine", () => {
  const d = doc("## R1: One\n\nTest T1 (deterministic): a.\nTest T1 (intelligent): b.\n\n## R2: Two\n\nTest T1 (deterministic): c.\n");
  assert.deepEqual(d.index.duplicateTests.map((x) => [x.sectionId, x.label, x.first, x.second]), [["R1", "T1", 9, 10]]);
  const tests = allTests(declarations(d));
  assert.deepEqual(tests.map((t) => t.duplicate), [true, true, false]);
});

test("A specplane-test block belongs to the Test line it follows, with or without a blank line", () => {
  const d = doc("## R1: One\n\nTest T1 (deterministic): a.\n\n```specplane-test\nrun: [\"true\"]\n```\n\nTest T2 (deterministic): b.\n```specplane-test\nrun: [\"false\"]\nexpect:\n  exit: 1\n```\n\nTest T3 (deterministic): no block.\n\nOther paragraph.\n\n```specplane-test\nrun: [\"x\"]\n```\n");
  const [t1, t2, t3] = allTests(declarations(d));
  assert.deepEqual(t1.def?.run, ["true"]);
  assert.equal(t2.def?.expect.exit, 1);
  assert.equal(t3.def, undefined);
  assert.equal(t3.blockLine, undefined);
});

test("parseBlock accepts the documented keys and rejects bad ones", () => {
  const ok = parseBlock("run: [\"specplane\", \"validate\"]\ncwd: sub\nsetup: [[\"sh\", \"x.sh\"]]\nexpect:\n  exit: 1\n  stdout-contains: [\"a\"]\n  stderr-contains: [\"b\"]\n  stdout-equals: \"c\"\n");
  assert.ok("def" in ok && ok.def.cwd === "sub" && ok.def.expect.stdoutEquals === "c" && ok.def.setup.length === 1);
  for (const bad of ["run: validate", "run: []", "run: [\"a\"]\ncwd: ../x", "run: [\"a\"]\ncwd: /abs", "run: [\"a\"]\nshell: true", "run: [\"a\"]\nexpect:\n  stdout: x", "run: [\"a\"]\nexpect:\n  exit: one", "- a", "run: [\"a\"\n"]) {
    assert.ok("error" in parseBlock(bad), bad);
  }
});

test("checkExpect names the first failed expectation", () => {
  const def = { run: ["x"], cwd: ".", setup: [], expect: { exit: 0, stdoutContains: ["ok"], stderrContains: [] } };
  const cap = { code: 0, stdout: "nope\nmore", stderr: "", timedOut: false };
  assert.match(checkExpect(def, cap)!, /stdout does not contain "ok"\nstdout begins:\nnope\nmore/);
  assert.equal(checkExpect(def, { ...cap, stdout: "ok" }), null);
  assert.match(checkExpect(def, { ...cap, code: 2, stderr: "boom" })!, /expected exit 0, got 2\nboom/);
});
