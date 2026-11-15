import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { DEFAULT_PRESET, guard, type Actor, type Preset } from "../perm/permissions.js";
import { makeRepo } from "../test-repo.js";
import { actionNeeds, InvalidRequestAction, type ActionNeeds } from "./requirements.js";

function repo(): string {
  const files: Record<string, string> = {};
  for (const layer of ["feature", "architecture"]) {
    files[`docs/specifications/${layer === "feature" ? "features" : layer}/a.md`] =
      `---\nid: ${layer}/a\ntitle: A\nstatus: awaiting-review\nauthors: []\n---\n# A\n`;
  }
  files["docs/requirements/product.md"] = "# Product\n\n## R1: Goal\n\nA goal.\n";
  const root = makeRepo(files);
  run("git", ["init", "-q"], { cwd: root });
  run("git", ["add", "."], { cwd: root });
  run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root });
  return root;
}

test("spec permissions follow the actual committed target layer", () => {
  const root = repo();
  for (const id of ["feature/a", "architecture/a", "requirement/product"]) {
    const need = [`spec.edit.${id.split("/")[0]}`];
    assert.deepEqual(actionNeeds(root, "spec edit", { spec: id, patch: "a patch" }), need);
    assert.deepEqual(actionNeeds(root, "spec reopen", { id }), need);
  }
  // A caller's layer hint and permission list cannot replace the permission derived from the spec.
  for (const permissions of [undefined, [], ["info.retrieve"], ["spec.edit.architecture"]]) {
    const needs = actionNeeds(root, "spec edit", { spec: "feature/a", patch: "a patch", layer: "architecture", permissions });
    assert.deepEqual(needs, ["spec.edit.feature"]);
    assert.equal(guard(DEFAULT_PRESET, { role: "llm", kind: "llm", name: "Agent" }, needs, "edit").kind, "request");
  }
  fs.writeFileSync(path.join(root, "docs/specifications/features/a.md"), "uncommitted text");
  assert.deepEqual(actionNeeds(root, "spec reopen", { id: "feature/a" }), ["spec.edit.feature"]);
  assert.throws(() => actionNeeds(root, "spec edit", { spec: "feature/missing", patch: "patch" }), /does not exist/);
});

test("action needs are evaluated against current permissions, including deny and granular alternatives", () => {
  const root = repo();
  const actor: Actor = { role: "standard-user", kind: "human", name: "Pat" };
  const needs = actionNeeds(root, "spec meta set", { id: "feature/a", field: "approval.date", value: "2026-11-10" });
  assert.deepEqual(needs, [["meta.write.approval", "meta.write"]]);
  const preset = (general: "allow" | "deny" | "request-user", granular: "allow" | "deny" | "request-user"): Preset => ({
    ...DEFAULT_PRESET, standardUser: { defaultMode: "deny", modes: { "meta.write": general, "meta.write.approval": granular } },
  });
  for (const [general, granular, expected] of [
    ["deny", "allow", "allow"], ["allow", "deny", "allow"],
    ["deny", "request-user", "request"], ["request-user", "deny", "request"], ["deny", "deny", "deny"],
  ] as const) assert.equal(guard(preset(general, granular), actor, needs, "set").kind, expected);
  const editNeeds = actionNeeds(root, "spec edit", { spec: "feature/a", patch: "patch" });
  const current: Preset = { ...DEFAULT_PRESET, standardUser: { defaultMode: "allow", modes: {} } };
  assert.equal(guard(current, actor, editNeeds, "edit").kind, "allow");
  current.standardUser.modes["spec.edit.feature"] = "deny";
  assert.equal(guard(current, actor, editNeeds, "edit").kind, "deny");
});

test("every supported command derives its own permission", () => {
  const root = repo();
  const cases: [string, Record<string, unknown>, ActionNeeds][] = [
    ["spec approve", { ids: ["feature/a"] }, ["spec.approve.feature"]],
    ["config set", { key: "plans.dir", arg: "work" }, ["config.change"]],
    ["config set", { key: "plans.dir", new: "work", arg: null }, ["config.change"]],
    ["config unset", { key: "plans.dir" }, ["config.change"]],
    ["plan create", { words: ["test", "plan"] }, ["plan.create"]],
    ["plan approve", { id: "p" }, ["spec.approve.feature"]],
    ["plan start", { id: "p" }, ["plan.start"]],
    ["plan stop", { id: "p" }, ["plan.softstop"]],
    ["plan resume", { id: "p" }, ["plan.resume"]],
    ["plan retarget", { id: "p", target: "main" }, ["plan.resume"]],
    ["plan budget", { id: "p", resource: "tokens", soft: 80, hard: 100 }, ["plan.budget"]],
    ["plan budget", { id: "p", resource: "tokens", remove: true }, ["plan.budget"]],
    ["plan finish", { id: "p", complete: true }, ["plan.complete"]],
    ["plan finish", { id: "p", back: "more work" }, ["plan.complete"]],
    ["plan merge", { id: "p", mode: "local" }, ["plan.complete"]],
    ["plan abandon", { id: "p" }, ["plan.abandon"]],
    ["plan delete", { id: "p" }, ["plan.delete"]],
  ];
  for (const kind of ["status", "approver", "approval-commit", "test"]) cases.push([
    `spec override ${kind}`, { id: "feature/a", args: ["value"], kind: "misleading" }, [`override.${kind}`],
  ]);
  for (const field of ["title", "authors", "references", "covers", "approval.date", "approval.commit"]) cases.push([
    "spec meta set", { id: "feature/a", field, value: "" }, [[`meta.write.${field.split(".")[0]}`, "meta.write"]],
  ]);
  for (const [command, params, expected] of cases) assert.deepEqual(actionNeeds(root, command, params), expected, command);
});

test("malformed parameters and unknown commands fail before an action can be authorized", () => {
  const root = repo();
  const cases: [string, unknown][] = [
    ["config set", null], ["config set", []], ["config set", "text"], ["config set", {}],
    ["config set", { key: "plans.dir" }], ["config set", { key: "plans.dir", arg: 4 }],
    ["config unset", { key: " " }], ["spec approve", { ids: [] }], ["spec approve", { ids: [2] }],
    ["spec approve", { ids: "feature/a" }], ["spec edit", { spec: "feature/a", patch: "" }],
    ["spec reopen", { id: 12 }], ["spec meta set", { id: "feature/a", field: "status", value: "approved" }],
    ["spec meta set", { id: "feature/a", field: "title", value: {} }],
    ["spec override arbitrary", { id: "feature/a", args: [] }],
    ["spec override status", { id: "feature/a", args: "approved" }],
    ["plan create", { words: ["one"] }], ["plan create", { words: ["a", "b"], references: "bad" }],
    ["plan start", { id: "p", forceDeps: "false" }], ["plan stop", { id: "p", kind: "other" }],
    ["plan retarget", { id: "p" }], ["plan resume", {}], ["plan approve", {}],
    ["plan finish", { id: "p" }], ["plan finish", { id: "p", complete: true, back: "reason" }],
    ["plan merge", { id: "p", mode: "other" }], ["plan abandon", { id: "p", force: "yes" }],
    ["plan step-done", { id: "p", step: 1.5, outcome: "done" }],
    ["plan step-done", { id: "p", step: 1, outcome: "skipped" }],
    ["plan budget", { id: "p", resource: "tokens", soft: 80, hard: 50 }],
    ["plan budget", { id: "p", resource: "tokens", soft: 80, hard: Infinity }],
    ["arbitrary", {}], ["toString", {}],
  ];
  for (const [command, params] of cases) assert.throws(() => actionNeeds(root, command, params), InvalidRequestAction, command);
});
