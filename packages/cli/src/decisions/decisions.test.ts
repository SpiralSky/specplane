import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { createActionRuntime } from "../harness/actions.js";
import { DEFAULT_PRESET, type Mode } from "../perm/permissions.js";
import { acceptRequest } from "../requests/ops.js";
import { actionNeeds } from "../requests/requirements.js";
import { approveSpecs, type Ctx } from "../spec/human.js";
import { makeRepo, spec } from "../test-repo.js";
import { validateProject } from "../verify/validate.js";
import { decisionStatus, DECISIONS_DIR, prepareDecision, readRecords, retrieveDecisions, writeDecision } from "./decisions.js";

const git = (root: string, ...args: string[]) => run("git", args, { cwd: root }).trim();
function repo(enabled = true): string {
  const root = makeRepo({
    ".specplane/config.yaml": `auto_warn: false\n${enabled ? "decisions:\n  enabled: true\n" : ""}`,
    "docs/specifications/features/a.md": spec({ id: "feature/a", title: "A", authors: [] }, "# A\n\n## R1: First\n\nText\n"),
  });
  for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "t@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"]]) git(root, ...args);
  return root;
}
const commit = (root: string) => { git(root, "add", "-A"); git(root, "commit", "-qm", "records"); };
const human = (root: string): Ctx => ({ root, actor: { role: "standard-user", kind: "human", name: "Test" }, preset: DEFAULT_PRESET });
const llm = (root: string): Ctx => ({ root, actor: { role: "llm", kind: "llm", name: "m", model: "m" }, preset: DEFAULT_PRESET });
const NEW = { title: "Push notifications stay off", decision: "Keep push notifications off by default.", context: "Users found them noisy in the pilot.", reasons: "Opt-in respects attention.", concerns: ["feature/a"] };
const addAs = (ctx: Ctx, input: Record<string, unknown> = NEW) => writeDecision(ctx, "add", prepareDecision(ctx, "add", input));

test("with decisions off nothing is stored or read, and validation ignores a record on disk", () => {
  const root = repo(false);
  assert.throws(() => prepareDecision(human(root), "add", NEW), /Decision records are off/);
  assert.throws(() => retrieveDecisions({ root }), /Decision records are off/);
  fs.mkdirSync(path.join(root, DECISIONS_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, DECISIONS_DIR, "D1.md"), "broken");
  assert.equal(validateProject(root).findings.filter((f) => f.rule === "decisions").length, 0);
});

test("a person adds, finds, edits and deletes records; IDs count up", () => {
  const root = repo();
  const r = addAs(human(root));
  assert.equal(r.ok, true, r.reasons.join(";"));
  assert.deepEqual(r.written, ["D1"]);
  assert.equal(addAs(human(root), { ...NEW, title: "Search stays local", decision: "Search runs locally.", context: "No server.", concerns: undefined }).written[0], "D2");
  const text = fs.readFileSync(path.join(root, DECISIONS_DIR, "D1.md"), "utf8");
  assert.match(text, /## Decision\n\nKeep push notifications off/);
  assert.equal(readRecords(root).records.length, 2);
  assert.deepEqual(retrieveDecisions({ root }, { query: "notifications noisy" }).records.map((x) => x.id), ["D1"]);
  assert.deepEqual(retrieveDecisions({ root }, { concerns: "feature/a" }).records.map((x) => x.id), ["D1"]);
  assert.equal(retrieveDecisions({ root }, { id: "D9" }).ok, false);
  const e = writeDecision(human(root), "edit", prepareDecision(human(root), "edit", { id: "D1", decision: "Keep push off until opt-in." }));
  assert.equal(e.ok, true);
  const rec = retrieveDecisions({ root }, { id: "D1" }).records[0];
  assert.equal(rec.decision, "Keep push off until opt-in.");
  assert.equal(rec.context, NEW.context);
  assert.equal(writeDecision(human(root), "delete", prepareDecision(human(root), "delete", { id: "D2" })).ok, true);
  assert.equal(readRecords(root).records.length, 1);
});

test("a record is approved by ID on committed content and an edit returns it to review", async () => {
  const root = repo();
  addAs(human(root));
  assert.equal(decisionStatus(root, "D1").reason, "not committed");
  const early = await approveSpecs(human(root), ["D1"], { yes: true });
  assert.equal(early.ok, false);
  assert.match(early.reasons.join(" "), /not committed/);
  commit(root);
  assert.equal(decisionStatus(root, "D1").reason, "never-approved");
  const mixed = await approveSpecs(human(root), ["D1", "feature/a"], { yes: true });
  assert.equal(mixed.ok, false);
  const ok = await approveSpecs(human(root), ["D1"], { yes: true });
  assert.equal(ok.ok, true, ok.reasons.join(";"));
  assert.equal(decisionStatus(root, "D1").status, "approved");
  writeDecision(human(root), "edit", prepareDecision(human(root), "edit", { id: "D1", context: "Changed context." }));
  commit(root);
  assert.deepEqual(decisionStatus(root, "D1"), { status: "awaiting-review", reason: "edited" });
  assert.equal(retrieveDecisions({ root }, { id: "D1" }).records[0].status, "awaiting-review");
});

test("the LLM must ask to add (request user); accepting writes the exact record once; the LLM cannot approve alone", async () => {
  const root = repo();
  const held = addAs(llm(root));
  assert.equal(held.ok, true);
  assert.ok(held.request);
  assert.equal(readRecords(root).records.length, 0);
  assert.equal((await acceptRequest(human(root), held.request!)).ok, true);
  const rec = readRecords(root).records[0];
  assert.equal(rec.id, "D1");
  assert.deepEqual(rec.authors, [{ llm: "m", contribution: "recorded the user's decision" }]);
  commit(root);
  const approve = await approveSpecs(llm(root), ["D1"], { yes: true });
  assert.ok(approve.request, "approval by the LLM is a request");
  assert.equal(decisionStatus(root, "D1").status, "awaiting-review");
});

test("T1: add denied for the LLM is refused and stores nothing, while retrieve allow finds records", () => {
  const root = repo();
  addAs(human(root));
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "decision.add": "deny" as Mode };
  try {
    const r = addAs(llm(root), { ...NEW, title: "Another" });
    assert.equal(r.ok, false);
    assert.match(r.reasons[0], /decision\.add/);
    assert.equal(readRecords(root).records.length, 1);
    assert.equal(retrieveDecisions({ root }, { query: "notifications" }).records.length, 1);
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("validation reports a malformed record as an error and an unknown concern as a warning", () => {
  const root = repo();
  addAs(human(root), { ...NEW, concerns: ["feature/a", "feature/gone"] });
  fs.writeFileSync(path.join(root, DECISIONS_DIR, "D2.md"), "---\nid: D3\ntitle: X\ndate: today\nauthors: []\n---\n\n## Decision\n\nOnly this.\n");
  const f = validateProject(root).findings.filter((x) => x.rule === "decisions");
  assert.ok(f.some((x) => x.severity === "warning" && /feature\/gone/.test(x.message)));
  const bad = f.find((x) => x.severity === "error")!;
  assert.match(bad.message, /frontmatter id must be `D2`/);
  assert.match(bad.message, /date must be YYYY-MM-DD/);
  assert.match(bad.message, /`## Context` section is missing/);
  assert.equal(f.filter((x) => x.severity === "warning" && x.file.endsWith("D1.md")).length, 1);
});

test("harness actions add, retrieve, edit and delete; request validation derives the permission", async () => {
  const root = repo();
  const rt = createActionRuntime({ root, id: "s", reportsContext: false, model: "m" });
  const held = await rt.call("decision.add", NEW);
  assert.ok(held.request, "request user by default");
  assert.deepEqual(actionNeeds(root, "decision add", { id: "D1", before: null, after: "x" }), ["decision.add"]);
  assert.throws(() => actionNeeds(root, "decision delete", { id: "D1", before: null, after: null }));
  await acceptRequest(human(root), held.request!);
  const found = await rt.call("decision.retrieve", { query: "notifications" });
  assert.equal(found.ok, true);
  assert.equal((found.data as { records: unknown[] }).records.length, 1);
  assert.ok((await rt.call("decision.edit", { id: "D1", title: "New title" })).request);
  assert.ok((await rt.call("decision.delete", { id: "D1" })).request);
  const bad = await rt.call("decision.add", { title: "x" });
  assert.equal(bad.ok, false);
});
