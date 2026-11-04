import assert from "node:assert/strict";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { makeRepo } from "../test-repo.js";
import { type Harness, NO_HARNESS_HINT, templatesDir, UnknownHarnessError } from "./index.js";

function fake(calls: string[], detected: boolean): Harness {
  return {
    name: "fake",
    detect: () => detected,
    install: (_root, report) => {
      calls.push("install");
      report.add("Created .fake/x");
    },
    skillDirs: () => [],
    rulesFile: ".fake/rules.md",
  };
}

test("harness: unknown name throws with known names", () => {
  const root = makeRepo({});
  assert.throws(
    () => runInit(root, { harness: "nope", registry: [fake([], false)] }),
    (e: unknown) => e instanceof UnknownHarnessError && e.exitCode === 1 && e.message.includes("fake"),
  );
});

test("harness: --harness and detection call install; neither prints hint", () => {
  const root = makeRepo({});
  const calls: string[] = [];
  assert.ok(runInit(root, { harness: "fake", registry: [fake(calls, false)] }).includes("Created .fake/x"));
  runInit(root, { registry: [fake(calls, true)] });
  assert.equal(calls.length, 2);
  const none = runInit(root, { registry: [fake(calls, false)] });
  assert.equal(calls.length, 2);
  assert.ok(none.includes(NO_HARNESS_HINT));
});

test("harness: claude templates resolve from the compiled module", () => {
  assert.ok(fs.existsSync(path.join(templatesDir("claude"), "settings.json")));
});

test("claude plan-step: blocked-step recovery uses the current CLI flag", () => {
  const root = makeRepo({});
  runInit(root, { harness: "claude" });
  const skill = fs.readFileSync(path.join(root, ".claude/skills/plan-step/SKILL.md"), "utf8");
  assert.match(skill, /Re-running a `blocked` step adds `--force`/);
  assert.doesNotMatch(skill, /`--resume`/);
});

// --- Claude installer and settings merge ---
import { mergeSettings } from "./claude.js";
import { claude } from "./claude.js";

const tpl = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(templatesDir("claude"), "settings.json"), "utf8"));
const merged = (existing: string | null) => mergeSettings(existing, tpl());

test("claude merge: absent file writes the template", () => {
  const r = merged(null);
  assert.deepEqual(JSON.parse(r.content!), tpl());
  assert.ok(r.content!.endsWith("}\n"));
});

test("claude merge: invalid JSON is reported and not clobbered", () => {
  const root = makeRepo({ ".claude/settings.json": "{ nope" });
  const lines = runInit(root, { harness: "claude" });
  assert.ok(lines.includes("Skipped .claude/settings.json (invalid JSON; add the Specplane registration by hand)"));
  assert.equal(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"), "{ nope");
});

test("claude merge: already registered adds nothing, no duplicates", () => {
  const first = merged("{}");
  assert.equal(first.added, 5);
  const again = merged(first.content);
  assert.equal(again.added, 0);
  assert.equal(again.content, null);
});

test("claude merge: partial registration adds only the missing entries and keeps other keys", () => {
  const existing = JSON.stringify({
    model: "x",
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/a/specplane-pre-commit.sh" }] }],
      Stop: [{ hooks: [{ type: "command", command: "other.sh" }] }],
    },
  });
  const r = merged(existing);
  const out = JSON.parse(r.content!);
  assert.equal(out.model, "x");
  assert.deepEqual(out.permissions.allow, ["Bash(ls:*)", "Bash(specplane:*)"]);
  assert.equal(out.hooks.PreToolUse.length, 2);
  assert.equal(out.hooks.SessionStart.length, 1);
  assert.equal(out.hooks.Stop.length, 1);
  assert.deepEqual(Object.keys(out).slice(0, 2), ["model", "permissions"]);
  assert.equal(r.added, 4);
});

test("claude merge: existing statusLine is kept", () => {
  const sl = { type: "command", command: "mine.sh" };
  const r = merged(JSON.stringify({ statusLine: sl }));
  assert.deepEqual(JSON.parse(r.content!).statusLine, sl);
  assert.ok(r.notes[0].startsWith("Kept existing statusLine"));
  assert.equal(r.added, 4);
});

test("claude install: the host-written tsconfig is git-ignored once, existing .gitignore lines are kept", () => {
  const root = makeRepo({ ".gitignore": "node_modules/" });
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-q");
  const first = runInit(root, { harness: "claude" });
  assert.ok(first.includes("Updated .gitignore (ignores .claude/specplane/tsconfig.json)"));
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), "node_modules/\n.claude/specplane/tsconfig.json\n");
  const second = runInit(root, { harness: "claude" });
  assert.ok(second.includes("Skipped .gitignore (already ignores the host-written tsconfig)"));
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), "node_modules/\n.claude/specplane/tsconfig.json\n");
  // The host writes the file at plugin load; the clean-baseline check (git status, ignored files excluded) must not see it.
  fs.mkdirSync(path.join(root, ".claude/specplane"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/specplane/tsconfig.json"), "{}\n");
  assert.doesNotMatch(git("status", "--porcelain=v1", "--untracked-files=all"), /tsconfig\.json/);
});

test("claude install: files created, hooks executable, idempotent, CLAUDE.md untouched", () => {
  const root = makeRepo({ "CLAUDE.md": "mine\n", ".claude/settings.local.json": "{}" });
  const first = runInit(root, { harness: "claude" });
  assert.ok(first.includes("Created .claude/skills/plan-step/SKILL.md"));
  assert.ok(first.includes("Created .claude/rules/specplane.md"));
  assert.ok(first.includes("Created .claude/settings.json"));
  assert.equal(first.at(-1), "Claude Code integration files written to `.claude/`.");
  const hook = path.join(root, ".claude/hooks/specplane-pre-commit.sh");
  assert.equal(fs.statSync(hook).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "mine\n");
  assert.equal(fs.readFileSync(path.join(root, ".claude/settings.local.json"), "utf8"), "{}");
  assert.match(fs.readFileSync(path.join(root, ".claude/rules/specplane.md"), "utf8"), /`\/spec-assist`/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /`\/spec-assist`/, "the shared block names no host");

  fs.writeFileSync(path.join(root, ".claude/rules/specplane.md"), "changed");
  fs.chmodSync(hook, 0o644);
  const second = runInit(root, { harness: "claude" });
  assert.ok(second.some(line => line.startsWith("Skipped .claude/rules/specplane.md (customized or unrecognized file preserved")));
  assert.equal(fs.readFileSync(path.join(root, ".claude/rules/specplane.md"), "utf8"), "changed");
  assert.ok(second.includes("Skipped .claude/skills/plan-step/SKILL.md (up to date)"));
  assert.ok(second.includes("Skipped .claude/settings.json (already registered)"));
  assert.equal(fs.statSync(hook).mode & 0o777, 0o755);
  const third = runInit(root, { harness: "claude" });
  assert.ok(!third.some((l) => l.startsWith("Created") || l.startsWith("Updated")));
});

test("claude install: detection by .claude/ directory", () => {
  const root = makeRepo({ ".claude/keep": "" });
  assert.ok(claude.detect(root));
  assert.ok(runInit(root).includes("Created .claude/hooks/specplane-statusline.sh"));
});
