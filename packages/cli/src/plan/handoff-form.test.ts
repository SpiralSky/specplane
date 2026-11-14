import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { parseHandoff, handoffEntryTemplate } from "./model.js";
import { docsSearch } from "../docs/operations.js";

const root = new URL("../../../../", import.meta.url);
const read = (rel: string) => fs.readFileSync(new URL(rel, root), "utf8");

test("the template parses as a complete entry for its step and outcome", () => {
  const [e] = parseHandoff(`# HANDOFF: x\n\n${handoffEntryTemplate({ step: 3, title: "Third", outcome: "partial", date: "2026-11-14" })}\n`);
  assert.equal(e.step, 3); assert.equal(e.title, "Third"); assert.equal(e.outcome, "partial"); assert.deepEqual(e.missing, []);
});

test("the contract, the architecture spec's source, the user doc and the delivered skills quote the template verbatim", () => {
  const t = handoffEntryTemplate();
  for (const f of ["packages/cli/assets/commands/plan-step.md", "docs/user/plans.md", "harnesses/claude/templates/skills/specplane-plan-step/SKILL.md"]) {
    assert.ok(read(f).includes(t), `${f} must contain the handoff entry template`);
  }
  assert.ok(read("docs/specifications/architecture/file-formats.md").includes(t.split("\n").slice(0, 4).join("\n")), "file-formats §5.5 heading and fields");
});

test("docs search for \"handoff entry\" finds the plans topic and its template", () => {
  const hit = docsSearch("handoff entry").items.find((i) => i.topic_id === "plans");
  assert.ok(hit);
  assert.ok(docsSearch("### What the next step must know").items.some((i) => i.topic_id === "plans"));
});
