import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";
import { makeRepo } from "../test-repo.js";
import { headContext, implementationState } from "../spec/implementation.js";
import { executeOperation } from "./index.js";

const sh = (cwd: string, ...a: string[]): void => { const r = spawnSync("git", a, { cwd, encoding: "utf8" }); assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`); };
const A = "docs/specifications/architecture";
const arch = `---\nid: architecture/a\ntitle: A\nauthors:\n  - human: someone\nimplements: []\n---\n\n# A\n`;
function repo(): string {
  const root = makeRepo({ [`${A}/a.md`]: arch });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "Pat Person");
  sh(root, "config", "user.email", "pat@example.com");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "init");
  return root;
}
const state = (root: string) => { const h = headContext(root); return implementationState(h.ctx, h.project.specs.get("architecture/a")!); };
const cli = path.resolve(process.cwd(), "dist/cli.js");

test("core and CLI write the implementation record in the notes store; only complete can be recorded", () => {
  const root = repo();
  const op = (status: "incomplete" | "partial" | "complete", dryRun = false) => executeOperation({ operation: "spec.implementation", arguments: { id: "architecture/a", status, dryRun } }, { checkout: root, extensionId: "test" });
  assert.equal(op("partial").ok, false);
  assert.ok(op("complete", true).ok);
  assert.equal(state(root).status, "unimplemented");
  const cliRun = spawnSync(process.execPath, [cli, "spec", "complete", "architecture/a", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(cliRun.status, 0, cliRun.stderr);
  assert.equal(JSON.parse(cliRun.stdout).assessment_status, "current");
  assert.equal(state(root).status, "implemented");
  const again = op("complete");
  assert.ok(again.ok && again.value.changed === false);
});
