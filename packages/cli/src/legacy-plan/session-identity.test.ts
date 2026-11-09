import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionIdFor } from "./session-identity.js";

test("session identity: UUIDv5 is stable and distinct by plan/step", () => {
  const plan = "2026-10-30-plan-conductor";
  const id = sessionIdFor(plan, 1);
  assert.equal(sessionIdFor(plan, 1), id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(sessionIdFor(plan, 2), id);
  assert.notEqual(sessionIdFor("2026-10-30-other-plan", 1), id);
  assert.throws(() => sessionIdFor("../../bad", 1));
  assert.throws(() => sessionIdFor(plan, 0));
});
