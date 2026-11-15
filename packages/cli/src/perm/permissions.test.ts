import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG, PRESETS, PROTECTED, guard, mode, type Actor } from "./permissions.js";

/** The permission engine against `feature/roles-and-permissions` R42, R50, R57 and `architecture/file-formats` §7. */

const llm: Actor = { role: "llm", kind: "llm", name: "claude" };
const person: Actor = { role: "standard-user", kind: "human", name: "Pat" };
const admin: Actor = { role: "administrator", kind: "human", name: "Pat" };

test("every preset states a mode for each permission the LLM role has under R57, and denies the rest", () => {
  const stated = [
    "spec.approve.requirement", "spec.approve.feature", "spec.approve.architecture", "config.change", "info.retrieve", "test.record", "meta.read", "meta.write", "plan.meta.read", "plan.meta.write", "plan.create", "plan.edit", "plan.start", "plan.resume",
    "plan.abandon", "plan.complete", "plan.delete", "plan.budget", "plan.softstop", "decision.retrieve", "decision.add", "decision.edit", "decision.delete",
    ...["requirement", "feature", "architecture"].flatMap((t) => ["create", "edit", "delete"].map((a) => `spec.${a}.${t}`)),
  ];
  for (const p of PRESETS) {
    for (const id of stated) assert.ok(id in p.llm.modes, `${p.id} states ${id}`);
    for (const id of CATALOG.filter((c) => !stated.includes(c))) assert.equal(mode(p, "llm", id), "deny", `${p.id} ${id} defaults to deny`);
  }
});

test("R57 common rules hold in all four presets", () => {
  for (const p of PRESETS) {
    for (const id of ["info.retrieve", "test.record", "meta.read", "plan.softstop"]) assert.equal(mode(p, "llm", id), "allow", `${p.id} ${id}`);
    for (const id of ["spec.approve.requirement", "spec.approve.feature", "spec.approve.architecture", "config.change", "plan.start", "plan.resume", "plan.abandon", "plan.complete", "plan.delete", "plan.budget", "decision.add", "decision.edit", "decision.delete"]) {
      assert.equal(mode(p, "llm", id), "request-user", `${p.id} ${id}`);
    }
    assert.equal(mode(p, "llm", "decision.retrieve"), "allow");
    assert.equal(mode(p, "llm", "meta.write"), "deny");
    for (const piece of ["title", "authors", "references", "covers", "approval"]) assert.equal(mode(p, "llm", `meta.write.${piece}`), "deny");
    for (const o of PROTECTED) {
      assert.equal(mode(p, "llm", o), "deny");
      assert.equal(mode(p, "standard-user", o), "deny", "protected overrides belong to the Administrator only");
      assert.equal(mode(p, "administrator", o), "allow");
    }
    for (const id of CATALOG) assert.equal(mode(p, "administrator", id), "allow");
  }
});

test("an unknown permission is deny for the LLM and for presets without a stated mode; the preset default applies last", () => {
  const p = PRESETS[0];
  assert.equal(mode(p, "llm", "no.such.permission"), "deny");
  assert.equal(mode({ ...p, defaultMode: "request-user" }, "llm", "no.such.permission"), "request-user");
  assert.equal(mode({ ...p, llm: { defaultMode: "allow", modes: {} } }, "llm", "x"), "allow");
});

test("guard: deny beats request, request beats allow, and the first deciding permission is named", () => {
  const p = PRESETS[0];
  const all = guard(p, llm, ["info.retrieve", "spec.edit.architecture"], "x");
  assert.equal(all.kind, "allow");
  const req = guard(p, llm, ["info.retrieve", "spec.edit.feature", "spec.edit.architecture"], "x");
  assert.equal(req.kind, "request");
  assert.equal(req.kind === "request" && req.permission, "spec.edit.feature");
  assert.deepEqual(req.kind === "request" && req.permissions, ["info.retrieve", "spec.edit.feature", "spec.edit.architecture"]);
  const den = guard(p, llm, ["spec.edit.feature", "meta.write"], "x");
  assert.equal(den.kind, "deny");
  assert.equal(den.kind === "deny" && den.permission, "meta.write");
  assert.match(den.kind === "deny" ? den.message : "", /does not have/);
});

test("guard: granular metadata permission or meta.write, the more permissive wins; overrides never fall back to meta.write", () => {
  const custom = { ...PRESETS[0], llm: { modes: { "meta.write": "allow", "meta.write.title": "deny" } as Record<string, "allow" | "deny"> } };
  assert.equal(guard(custom, llm, [["meta.write.title", "meta.write"]], "x").kind, "allow");
  assert.equal(guard(custom, llm, [["meta.write.authors", "meta.write"]], "x").kind, "allow");
  assert.equal(guard(custom, llm, ["override.status"], "x").kind, "deny");
  assert.equal(guard(PRESETS[0], person, ["override.status"], "x").kind, "deny");
  assert.equal(guard(PRESETS[0], admin, ["override.status"], "x").kind, "allow");
});

test("the Standard User holds everything but the protected overrides; the Administrator holds everything", () => {
  for (const p of PRESETS) for (const id of CATALOG) {
    assert.equal(guard(p, person, [id], "x").kind, PROTECTED.includes(id as never) || id === "role.map" ? "deny" : "allow", `${p.id} ${id}`);
    assert.equal(guard(p, admin, [id], "x").kind, "allow");
  }
});
