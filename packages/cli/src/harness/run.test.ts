import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { UsageError } from "../errors.js";
import { makeRepo } from "../test-repo.js";
import { COMMANDS } from "./instructions.js";
import { runHarnessCommand } from "./run.js";

function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "paths:\n  requirements: docs/requirements\n" });
  const git = (...a: string[]): void => { assert.equal(spawnSync("git", a, { cwd: root, encoding: "utf8" }).status, 0); };
  git("init", "-q"); git("config", "user.name", "T"); git("config", "user.email", "t@example.invalid");
  git("add", "."); git("commit", "-qm", "c");
  return root;
}

test("the runner refuses a command outside the harness command list", async () => {
  const root = repo();
  for (const bad of ["audit", "config", "spec", "plan", "rm", "init", "harness"]) {
    await assert.rejects(runHarnessCommand(bad, [], root), UsageError, bad);
  }
});

test("a command typed without arguments shows its own result and never passes to the model", async () => {
  const root = repo();
  for (const command of COMMANDS) {
    const r = await runHarnessCommand(command, [], root);
    assert.equal(r.ok, true, command);
    assert.ok(!(r.data as { passToLlm?: unknown } | undefined)?.passToLlm, command);
    assert.ok((r.lines ?? []).length > 0, command);
  }
});

test("plan-step with no argument shows the next step state", async () => {
  const r = await runHarnessCommand("plan-step", [], repo());
  assert.deepEqual(r.lines, ["No plan has a next step."]);
});

test("a model command with arguments passes them with its instruction key", async () => {
  const r = await runHarnessCommand("spec-assist", ["add", "a", "feature"], repo());
  assert.deepEqual((r.data as { passToLlm: unknown }).passToLlm, { command: "spec-assist", args: ["add", "a", "feature"], instructionKey: "spec-assist" });
});

test("requests with an unknown subcommand is a usage error", async () => {
  await assert.rejects(runHarnessCommand("requests", ["bogus", "x"], repo()), UsageError);
});
