import assert from "node:assert/strict";
import { test } from "node:test";
import { AlreadyExistsError } from "./errors.js";

test("AlreadyExistsError texts and exit code", () => {
  assert.equal(new AlreadyExistsError("Spec", "feature/x").message, "Spec `feature/x` already exists.");
  assert.equal(new AlreadyExistsError("Plan", "p").message, "Plan `p` already exists. Choose a different slug.");
  assert.equal(new AlreadyExistsError("Spec", "a/b").exitCode, 1);
});
