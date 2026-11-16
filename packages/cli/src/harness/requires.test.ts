import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PRESET, type Preset } from "../perm/permissions.js";
import { checkRequires, requiresOf } from "./requires.js";

const withLlm = (modes: Record<string, string>): Preset => ({ ...DEFAULT_PRESET, llm: { ...DEFAULT_PRESET.llm, modes: { ...DEFAULT_PRESET.llm.modes, ...modes } } } as Preset);

test("requiresOf reads the backticked permissions of the Requires line", () => {
  assert.deepEqual(requiresOf("## Preconditions\n\nRequires: `plan.abandon`.\n"), ["plan.abandon"]);
  assert.deepEqual(requiresOf("Requires: `a.b`, `c.d`.\n"), ["a.b", "c.d"]);
  assert.deepEqual(requiresOf("no line here"), []);
});

test("checkRequires reports each required permission's mode and the first deny", () => {
  const denied = checkRequires("plan-abandon", withLlm({ "plan.abandon": "deny" }));
  assert.deepEqual(denied.required, [{ permission: "plan.abandon", mode: "deny" }]);
  assert.equal(denied.denied, "plan.abandon");
  assert.match(denied.message ?? "", /^Refused: \/plan-abandon needs the `plan\.abandon` permission/);
  for (const mode of ["allow", "request-user"]) {
    const r = checkRequires("plan-abandon", withLlm({ "plan.abandon": mode }));
    assert.equal(r.denied, null, mode);
    assert.equal(r.message, null, mode);
  }
});

test("a command without a Requires line, or outside the command list, has nothing required", () => {
  assert.deepEqual(checkRequires("spec-assist", withLlm({ "spec.create.feature": "deny" })), { command: "spec-assist", required: [], denied: null, message: null });
  assert.deepEqual(checkRequires("not-a-command", DEFAULT_PRESET).required, []);
});
