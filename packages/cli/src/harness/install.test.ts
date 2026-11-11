import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { PreconditionError, UsageError } from "../errors.js";
import { runInit } from "../commands/init.js";
import { makeRepo } from "../test-repo.js";
import { renderSkill, SKILL_COMMANDS, skillPath } from "./claude-skills.js";
import { claudeTemplateDir, inspectInstallation, installHarness, mergeSettings, splitBlock } from "./install.js";

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
  assert.ok(first.written.includes("AGENTS.md"));
  const afterFirst = read(root, "AGENTS.md");
  assert.ok(afterFirst.startsWith(mine));
  assert.match(afterFirst, /<!-- specplane:begin v0\.1\.0 /);
  const second = installHarness(root, "codex");
  assert.deepEqual(second.written, []);
  assert.ok(second.unchanged.includes("AGENTS.md"));
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
  assert.ok(installHarness(root, "claude").unchanged.includes(rules));
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
  assert.ok(lines.includes("claude: blocking the Specplane CLI: supported"));
  assert.ok(lines.includes("claude: instructions on demand: supported"));
  assert.throws(() => runInit(root, { harness: "vim" }), UsageError);
  assert.deepEqual(runInit(root, {}), ["Nothing to do: every remote already fetches the notes."]);
  assert.match(runInit(root, { harness: "codex" }).join("\n"), /codex: viewing specifications: missing/);
});

test("the Claude install writes skills with the header after the frontmatter, executable hooks and merged settings", () => {
  const root = repo();
  const report = installHarness(root, "claude");
  assert.ok(report.written.includes(".claude/skills/specplane-plan-step/SKILL.md"));
  const skill = read(root, ".claude/skills/specplane-plan-step/SKILL.md");
  assert.match(skill, /^---\nname: specplane-plan-step\n[\s\S]*?\n---\n<!-- specplane:file v0\.1\.0 sha:[0-9a-f]{16} -->\n<!-- Specplane command contract/);
  assert.equal(fs.statSync(path.join(root, ".claude/hooks/specplane-cli-block.sh")).mode & 0o111, 0o111);
  assert.match(read(root, ".claude/hooks/specplane-cli-block.sh"), /^#!\/bin\/sh\n# specplane:file v0\.1\.0 sha:/);
  const settings = JSON.parse(read(root, ".claude/settings.json"));
  assert.deepEqual(settings.permissions, undefined);
  assert.equal(settings.hooks.SessionStart.length, 2);
  assert.deepEqual(installHarness(root, "claude").written, []);
  fs.appendFileSync(path.join(root, ".claude/skills/specplane-plan-step/SKILL.md"), "mine\n");
  assert.deepEqual(installHarness(root, "claude").kept, [".claude/skills/specplane-plan-step/SKILL.md"]);
  assert.deepEqual(inspectInstallation(root), []);
});

test("T2: every committed skill is the rendering of its packaged contract", () => {
  for (const command of SKILL_COMMANDS) {
    const committed = fs.readFileSync(path.join(claudeTemplateDir(), skillPath(command)), "utf8");
    assert.equal(committed, renderSkill(command), `${command}: run scripts/build-claude-skills.mjs`);
    assert.match(committed, /<!-- Specplane command contract v0\.1\.0;/);
  }
  assert.match(renderSkill("approve"), /disable-model-invocation: true/);
  assert.match(renderSkill("validate"), /disable-model-invocation: false/);
});

test("settings merge: absent, invalid, registered, partial and an existing statusLine", () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(claudeTemplateDir(), "settings.json"), "utf8"));
  assert.equal(JSON.parse(mergeSettings(null, tpl).text!).statusLine.type, "command");
  assert.match(mergeSettings(null, tpl).text!, /\n$/);
  const bad = mergeSettings("{nope", tpl);
  assert.equal(bad.text, null);
  assert.deepEqual(bad.lines, ["Skipped .claude/settings.json (invalid JSON; add the Specplane registration by hand)"]);
  const full = mergeSettings(null, tpl).text!;
  assert.equal(mergeSettings(full, tpl).text, null);
  const partial = JSON.parse(full);
  partial.hooks.PreToolUse = partial.hooks.PreToolUse.slice(0, 1);
  partial.theme = "dark";
  const merged = mergeSettings(JSON.stringify(partial), tpl);
  const out = JSON.parse(merged.text!);
  assert.equal(out.hooks.PreToolUse.length, 2);
  assert.equal(out.theme, "dark");
  const own = { statusLine: { type: "command", command: "mine.sh" }, permissions: { allow: ["Bash(ls:*)"] } };
  const kept = mergeSettings(JSON.stringify(own), tpl);
  assert.deepEqual(kept.lines, ["Kept existing statusLine"]);
  assert.deepEqual(JSON.parse(kept.text!).statusLine, own.statusLine);
  assert.deepEqual(JSON.parse(kept.text!).permissions.allow, ["Bash(ls:*)"]);
});
