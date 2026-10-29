import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph, detectCycle } from "./graph.js";

test("no cycle", () => {
  assert.equal(detectCycle(buildGraph([{ id: "a", depends_on: ["b"] }, { id: "b" }, { id: "c", depends_on: ["a", "b"] }])), null);
});

test("simple cycle", () => {
  const c = detectCycle(buildGraph([{ id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] }]));
  assert.deepEqual(c, ["a", "b", "a"]);
});

test("multi-node cycle reachable from outside", () => {
  const c = detectCycle(
    buildGraph([{ id: "x", depends_on: ["a"] }, { id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["c"] }, { id: "c", depends_on: ["a"] }]),
  );
  assert.deepEqual(c, ["a", "b", "c", "a"]);
});

test("dangling edges are ignored by cycle detection", () => {
  assert.equal(detectCycle(buildGraph([{ id: "a", depends_on: ["ghost"] }])), null);
});
