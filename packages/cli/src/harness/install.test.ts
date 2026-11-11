import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { PreconditionError, UsageError } from "../errors.js";
import { runInit } from "../commands/init.js";
import { makeRepo } from "../test-repo.js";
import { inspectInstallation, installHarness, splitBlock } from "./install.js";

function repo(files: Record<string, string> = {}): string {
  const root = makeRepo({ ".specplane/config.yaml": "paths:\n  requirements: docs/requirements\n", ...files });
  const git = (...a: string[]): void => { assert.equal(spawnSync("git", a, { cwd: root, encoding: "utf8" }).status, 0); };
  git("init", "-q"); git("config", "user.name", "T"); git("config", "user.email", "t@example.invalid");
  git("add", ".specplane/config.yaml"); git("commit", "-qm", "config");
  return root;
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

test("installing twice changes nothing and text outside the block is byte-identical", () => {
  const mine = "# Team rules\n\nBe kind.  \n\n\nTrailing text without newline";
  const root = repo({ "AGENTS.md": mine });
  const first = installHarness(root, "codex");
  assert.deepEqual(first.written, ["AGENTS.md"]);
  const afterFirst = read(root, "AGENTS.md");
  assert.ok(afterFirst.startsWith(mine));
  assert.match(afterFirst, /<!-- specplane:begin v0\.1\.0 /);
  const second = installHarness(root, "codex");
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.unchanged, ["AGENTS.md"]);
  assert.equal(read(root, "AGENTS.md"), afterFirst);
});

test("an update replaces only the text between the markers", () => {
  const root = repo({ "AGENTS.md": "before\n<!-- specplane:begin v0.0.1 — old -->\nstale\n<!-- specplane:end -->\nafter\n" });
  installHarness(root, "codex");
  const text = read(root, "AGENTS.md");
  assert.ok(text.startsWith("before\n<!-- specplane:begin v0.1.0 "));
  assert.ok(text.endsWith("<!-- specplane:end -->\nafter\n"));
  assert.ok(!text.includes("stale"));
});

test("a begin marker without an end marker is refused and nothing changes", () => {
  const original = "x\n<!-- specplane:begin v1 — m -->\nno end\n";
  const root = repo({ "AGENTS.md": original });
  assert.throws(() => installHarness(root, "codex"), (e) => e instanceof PreconditionError && /AGENTS\.md/.test(e.message));
  assert.equal(read(root, "AGENTS.md"), original);
  assert.throws(() => splitBlock("f", "<!-- specplane:end -->\n<!-- specplane:begin v1 -->\n"), PreconditionError);
  const twice = "<!-- specplane:begin v1 -->\n<!-- specplane:end -->\n<!-- specplane:begin v1 -->\n<!-- specplane:end -->\n";
  assert.throws(() => splitBlock("f", twice), PreconditionError);
});

test("harness.install_block off installs no block", () => {
  const root = repo({ ".specplane/config.yaml": "harness:\n  install_block: false\n" });
  const r = installHarness(root, "codex");
  assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), false);
  assert.match(r.lines.join("\n"), /install_block is off/);
});

test("an owned file gets a version header; an edited or foreign file is kept and reported", () => {
  const root = repo();
  installHarness(root, "claude");
  const rules = ".claude/rules/specplane.md";
  assert.match(read(root, rules), /^<!-- specplane:file v0\.1\.0 stamp:[0-9a-f]{64} sha:[0-9a-f]{16} -->\n/);
  assert.deepEqual(installHarness(root, "claude").unchanged, [rules]);
  fs.appendFileSync(path.join(root, rules), "my edit\n");
  const kept = installHarness(root, "claude");
  assert.deepEqual(kept.kept, [rules]);
  assert.match(kept.lines.join("\n"), /edited after Specplane wrote it/);
  assert.match(read(root, rules), /my edit/);
  const foreign = repo({ [rules]: "mine\n" });
  assert.deepEqual(installHarness(foreign, "claude").kept, [rules]);
  assert.equal(read(foreign, rules), "mine\n");
});

test("setup refuses to write through a symlink and changes nothing", () => {
  const root = repo();
  fs.mkdirSync(path.join(root, "elsewhere"));
  fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, ".claude"));
  assert.throws(() => installHarness(root, "claude"), /symlink/);
  assert.deepEqual(fs.readdirSync(path.join(root, "elsewhere")), []);
  const root2 = repo();
  fs.writeFileSync(path.join(root2, "target.md"), "t\n");
  fs.symlinkSync(path.join(root2, "target.md"), path.join(root2, "AGENTS.md"));
  assert.throws(() => installHarness(root2, "codex"), /symlink/);
});

test("validation reports a missing file, an older version, a stamp mismatch and marker problems", () => {
  const root = repo();
  installHarness(root, "claude");
  installHarness(root, "codex");
  assert.deepEqual(inspectInstallation(root), []);
  const rules = path.join(root, ".claude/rules/specplane.md");
  fs.writeFileSync(rules, read(root, ".claude/rules/specplane.md").replace("v0.1.0", "v0.0.1"));
  assert.match(inspectInstallation(root)[0].message, /written by Specplane 0\.0\.1/);
  fs.writeFileSync(rules, read(root, ".claude/rules/specplane.md").replace("v0.0.1", "v0.1.0").replace(/stamp:[0-9a-f]{64}/, `stamp:${"0".repeat(64)}`));
  assert.match(inspectInstallation(root)[0].message, /steering stamp/);
  fs.rmSync(rules);
  assert.match(inspectInstallation(root)[0].message, /is missing/);
  fs.appendFileSync(path.join(root, "AGENTS.md"), "<!-- specplane:begin v1 -->\n");
  assert.ok(inspectInstallation(root).some((f) => f.severity === "error" && f.file === "AGENTS.md"));
});

test("init --harness installs, reports capabilities and rejects unknown names", () => {
  const root = repo();
  const lines = runInit(root, { harness: "claude" });
  assert.ok(lines.includes("Installed .claude/rules/specplane.md"));
  assert.ok(lines.includes("claude: blocking the Specplane CLI: missing"));
  assert.ok(lines.includes("claude: instructions on demand: supported"));
  assert.throws(() => runInit(root, { harness: "vim" }), UsageError);
  assert.deepEqual(runInit(root, {}), ["Nothing to do: every remote already fetches the notes."]);
  assert.match(runInit(root, { harness: "codex" }).join("\n"), /codex: viewing specifications: missing/);
});
