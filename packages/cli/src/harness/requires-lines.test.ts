import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMANDS, readContract } from "./instructions.js";

// `architecture/agent-skills` "Required permissions" (harness R71): a contract's `Requires:` line and its
// "`X` must not be deny" sentences must name the same permissions.
const EXPECTED: Readonly<Record<string, string[]>> = {
  "plan-create": ["plan.create"], "plan-abandon": ["plan.abandon"], "plan-finish": ["plan.complete"],
  validate: ["info.retrieve"], verify: ["info.retrieve"], "spec-review": ["info.retrieve"],
};

function requiresLine(text: string): string[] | null {
  const m = /^Requires: (.+)\.$/m.exec(text);
  return m ? [...m[1]!.matchAll(/`([^`]+)`/g)].map((x) => x[1]!).sort() : null;
}
function mustNotBeDeny(text: string): string[] {
  return [...text.matchAll(/`([^`]+)` must not be deny/g)].map((x) => x[1]!).sort();
}

test("R71: a contract's Requires line equals its must-not-be-deny sentence", () => {
  for (const command of COMMANDS) {
    const text = readContract(command);
    const required = requiresLine(text);
    if (required === null) continue;
    assert.deepEqual(mustNotBeDeny(text), required, `${command}: Requires line and sentence differ`);
  }
});

test("R71: exactly the listed contracts have a Requires line, with the listed permissions", () => {
  for (const command of COMMANDS) {
    assert.deepEqual(requiresLine(readContract(command)), EXPECTED[command] ?? null, command);
  }
});
