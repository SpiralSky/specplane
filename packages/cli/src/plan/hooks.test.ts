import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { SetupHookError } from "../errors.js";
import { runSetupHook } from "./hooks.js";

test("runSetupHook runs through a shell in cwd", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "specplane-hook-")));
  runSetupHook("echo hi > out.txt && echo again >> out.txt", dir);
  assert.equal(fs.readFileSync(path.join(dir, "out.txt"), "utf8"), "hi\nagain\n");
  fs.rmSync(dir, { recursive: true });
});

test("runSetupHook throws SetupHookError with the spec message on non-zero exit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-hook-"));
  assert.throws(
    () => runSetupHook("exit 3", dir),
    (e: unknown) =>
      e instanceof SetupHookError &&
      e.message === "Setup hook failed: `exit 3` exited with code 3. Worktree removed." &&
      e.exitCode === 1,
  );
  fs.rmSync(dir, { recursive: true });
});
