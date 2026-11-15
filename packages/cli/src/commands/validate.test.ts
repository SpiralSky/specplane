import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { makeRepo } from "../test-repo.js";
import { validateCommand } from "./validate.js";

function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "permissions:\n  preset: architecture-level-llm-control\n" });
  for (const a of [["init", "-q", "-b", "main"], ["config", "user.name", "Pat"], ["config", "user.email", "p@e.x"], ["add", "-A"], ["commit", "-q", "-m", "init"]]) assert.equal(spawnSync("git", a, { cwd: root }).status, 0);
  return root;
}

test("validate is refused for an LLM whose info.retrieve is deny or request-user (R50)", () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  const env = { SPECPLANE_ACTOR: process.env.SPECPLANE_ACTOR, SPECPLANE_MODEL: process.env.SPECPLANE_MODEL };
  process.env.SPECPLANE_ACTOR = "llm";
  process.env.SPECPLANE_MODEL = "opus";
  try {
    for (const mode of ["deny", "request-user"] as const) {
      DEFAULT_PRESET.llm.modes = { ...prior, "info.retrieve": mode };
      const r = validateCommand([], root);
      assert.equal(r.ok, false, mode);
      assert.equal(r.permission, "info.retrieve");
      assert.equal(r.data, undefined, "validation did not run");
    }
  } finally {
    DEFAULT_PRESET.llm.modes = prior;
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
