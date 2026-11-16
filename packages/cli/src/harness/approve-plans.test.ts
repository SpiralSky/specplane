import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { makeRepo, spec } from "../test-repo.js";
import { DEFAULT_PRESET, type Mode } from "../perm/permissions.js";
import { acceptRequest } from "../requests/ops.js";
import { createPlan } from "../plan/create.js";
import { loadPlans } from "../plan/model.js";
import { planApproval } from "../plan/status.js";
import { loadProject } from "../spec/project.js";
import { loadSpecPaths } from "../spec/paths.js";
import { committedSource } from "../spec/source.js";
import { readNotes } from "../spec/notes.js";
import { prepareDecision, writeDecision, decisionStatus } from "../decisions/decisions.js";
import { createActionRuntime } from "./actions.js";
import { runHarnessCommand } from "./run.js";

const file = "docs/specifications/features/a.md";
const human = (root: string) => ({ root, actor: { role: "standard-user" as const, kind: "human" as const, name: "Test" }, preset: DEFAULT_PRESET });

function repo(): { root: string; plan: string } {
  const root = makeRepo({ ".specplane/config.yaml": "auto_warn: false\ndecisions:\n  enabled: true\n", [file]: spec({ id: "feature/a", title: "A", authors: [] }, "# A\n\n## R1: First\n\nText\n") });
  for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"]]) run("git", args, { cwd: root });
  const { id } = createPlan(human(root), { words: ["notes", "plan"] });
  assert.equal(writeDecision(human(root), "add", prepareDecision(human(root), "add", { title: "Keep A", decision: "Keep it", context: "Chosen" })).ok, true);
  run("git", ["add", "."], { cwd: root });
  run("git", ["commit", "-qm", "decision"], { cwd: root });
  return { root, plan: id };
}

const planStatus = (root: string, id: string) => {
  const src = committedSource(root, "HEAD");
  return planApproval(root, loadProject(src, loadSpecPaths(root).paths), loadPlans(src, "docs/plans").find((p) => p.id === id)!).status;
};

test("spec.approve approves a plan under allow, sends a plan approve request under request-user, refuses under deny", async () => {
  for (const mode of ["allow", "request-user", "deny"] as Mode[]) {
    const { root, plan } = repo();
    const prior = DEFAULT_PRESET.llm.modes;
    DEFAULT_PRESET.llm.modes = { ...prior, "spec.approve.feature": mode };
    try {
      const rt = createActionRuntime({ root, id: "s", reportsContext: false, command: "approve", model: "m", delegatedBy: "Pat" });
      const r = await rt.call("spec.approve", { ids: [plan] });
      assert.equal(r.ok, mode !== "deny", r.findings.join());
      assert.equal(!!r.request, mode === "request-user");
      if (mode === "allow") {
        assert.equal(planStatus(root, plan), "approved");
        assert.deepEqual(readNotes(root).bySpec.get(`plan/${plan}`)!.at(-1)!.rec.by, { llm: "m", "delegated-by": "Pat" });
      } else assert.equal(planStatus(root, plan), "awaiting-review");
      if (r.request) {
        const { readRequest } = await import("../requests/store.js");
        const req = readRequest(root, r.request)!;
        assert.equal(req.action.command, "plan approve");
        assert.deepEqual(req.action.params, { id: plan });
        assert.equal((await acceptRequest(human(root), r.request)).ok, true);
        assert.equal(planStatus(root, plan), "approved");
      }
    } finally { DEFAULT_PRESET.llm.modes = prior; }
  }
});

test("spec.approve approves a decision record and refuses mixing kinds", async () => {
  const { root, plan } = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "spec.approve.feature": "allow" };
  try {
    const rt = createActionRuntime({ root, id: "s", reportsContext: false, command: "approve", model: "m", delegatedBy: "Pat" });
    for (const ids of [[plan, "feature/a"], [plan, "D1"], ["D1", "feature/a"]]) assert.equal((await rt.call("spec.approve", { ids })).ok, false, ids.join());
    assert.equal(planStatus(root, plan), "awaiting-review");
    const r = await rt.call("spec.approve", { ids: ["D1"] });
    assert.equal(r.ok, true, r.findings.join());
    assert.equal(decisionStatus(root, "D1").status, "approved");
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("the typed approve command approves a plan and a decision by exact ID and lists inexact names", async () => {
  const { root, plan } = repo();
  const cwd = process.cwd();
  // The typed command runs as the person at the terminal, whatever session runs the tests.
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("SPECPLANE_")) delete process.env[k];
  process.chdir(root);
  try {
    const bad = await runHarnessCommand("approve", ["notes"], root);
    assert.equal(bad.ok, false);
    assert.match((bad.lines ?? []).join("\n"), new RegExp(`Plans:\\n  ${plan}`));
    assert.equal(planStatus(root, plan), "awaiting-review");
    const p = await runHarnessCommand("approve", [plan], root);
    assert.equal(p.ok, true, (p.findings ?? []).join());
    assert.equal(planStatus(root, plan), "approved");
    const d = await runHarnessCommand("approve", ["D1"], root);
    assert.equal(d.ok, true, (d.findings ?? []).join());
    assert.equal(decisionStatus(root, "D1").status, "approved");
  } finally { process.chdir(cwd); Object.assign(process.env, saved); }
});
