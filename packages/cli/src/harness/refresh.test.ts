import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { validateCommand } from "../commands/validate.js";
import { makeRepo } from "../test-repo.js";
import { skillPath, SKILL_COMMANDS } from "./claude-skills.js";
import { installHarness, specplaneVersion } from "./install.js";
import { refreshInstalled } from "./refresh.js";

const V = specplaneVersion();
const RULES = ".claude/rules/specplane.md";
const SKILL = `.claude/${skillPath(SKILL_COMMANDS[0])}`;

function repo(): string {
  const root = makeRepo({ ".specplane/config.yaml": "paths:\n  requirements: docs/requirements\n" });
  const git = (...a: string[]): void => { assert.equal(spawnSync("git", a, { cwd: root, encoding: "utf8" }).status, 0); };
  git("init", "-q"); git("config", "user.name", "T"); git("config", "user.email", "t@example.invalid");
  git("add", ".specplane/config.yaml"); git("commit", "-qm", "config");
  return root;
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const age = (root: string, rel: string): void => fs.writeFileSync(path.join(root, rel), read(root, rel).replace(`v${V}`, "v0.0.1"));
const tree = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string): void => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === ".git") continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, "utf8"); } };
  walk(root);
  return out;
};

test("a stale, unedited file is refreshed to what init writes, with one line naming it", () => {
  const root = repo();
  installHarness(root, "claude");
  const fresh = tree(root);
  age(root, RULES);
  const r = refreshInstalled(root);
  assert.deepEqual(r.refreshed, [RULES]);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0], /specplane\.md/);
  assert.deepEqual(tree(root), fresh, "equal to a fresh install");
});

test("a current file is not touched and a second refresh changes nothing", () => {
  const root = repo();
  installHarness(root, "claude");
  const before = tree(root);
  assert.deepEqual(refreshInstalled(root), { refreshed: [], edited: [], lines: [] });
  assert.deepEqual(tree(root), before);
});

test("a stale file the user edited is left as it is and listed with the refresh command", () => {
  const root = repo();
  installHarness(root, "claude");
  age(root, SKILL);
  const edited = `${read(root, SKILL)}\nMy own note.\n`;
  fs.writeFileSync(path.join(root, SKILL), edited);
  const r = refreshInstalled(root);
  assert.deepEqual(r.refreshed, []);
  assert.deepEqual(r.edited, [SKILL]);
  assert.match(r.lines.join("\n"), /specplane init --harness/);
  assert.equal(read(root, SKILL), edited);
});

test("the managed AGENTS.md block is refreshed when stale and unedited, outside text untouched", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "mine\n");
  installHarness(root, "codex");
  const fresh = read(root, "AGENTS.md");
  assert.match(fresh, /<!-- specplane:begin v\S+ sha:[0-9a-f]+ /);
  age(root, "AGENTS.md");
  const r = refreshInstalled(root);
  assert.deepEqual(r.refreshed, ["AGENTS.md"]);
  assert.equal(read(root, "AGENTS.md"), fresh);
});

test("an edited stale AGENTS.md block is left alone and listed", () => {
  const root = repo();
  installHarness(root, "codex");
  age(root, "AGENTS.md");
  const edited = read(root, "AGENTS.md").replace("## Specplane", "## Specplane (mine)");
  fs.writeFileSync(path.join(root, "AGENTS.md"), edited);
  const r = refreshInstalled(root);
  assert.deepEqual(r.edited, ["AGENTS.md"]);
  assert.equal(read(root, "AGENTS.md"), edited);
});

test("an old block without a hash is refreshed only when its body is the known standing text", () => {
  const root = repo();
  installHarness(root, "codex");
  const old = read(root, "AGENTS.md").replace(/ v\S+ sha:[0-9a-f]+ /, " v0.0.1 ");
  fs.writeFileSync(path.join(root, "AGENTS.md"), old);
  assert.deepEqual(refreshInstalled(root).refreshed, ["AGENTS.md"]);
  const changed = old.replace("never assume one", "assume one");
  fs.writeFileSync(path.join(root, "AGENTS.md"), changed);
  const r = refreshInstalled(root);
  assert.deepEqual(r.edited, ["AGENTS.md"]);
  assert.equal(read(root, "AGENTS.md"), changed);
});

test("validate refreshes a stale, unedited file and reports it", () => {
  const root = repo();
  installHarness(root, "claude");
  const fresh = read(root, RULES);
  age(root, RULES);
  const r = validateCommand([], root);
  assert.match(((r as { lines?: string[] }).lines ?? []).join("\n"), /refreshed installed files/);
  assert.equal(read(root, RULES), fresh);
});

test("refresh never writes specs, requirements, config, settings or files it did not install", () => {
  const root = repo();
  installHarness(root, "claude");
  fs.mkdirSync(path.join(root, "docs/requirements"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/requirements/product-requirements.md"), "# R\n");
  fs.writeFileSync(path.join(root, ".claude/rules/other.md"), "<!-- specplane:file v0.0.1 sha:abc -->\nmine\n");
  age(root, RULES);
  const before = tree(root);
  refreshInstalled(root);
  const after = tree(root);
  for (const k of Object.keys(before)) if (k !== RULES) assert.equal(after[k], before[k], `${k} unchanged`);
});
