import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { PreconditionError } from "../errors.js";
import { makeRepo } from "../test-repo.js";
import { codexLauncher } from "./adapter-codex.js";
import { CAPABILITIES, getAdapter } from "./adapter.js";
import "./adapters.js";
import { CODEX_CONTRACTS, CODEX_WITHHELD, contractPath, renderCodexContract, renderCodexSkill, SKILL_FILE } from "./codex-skills.js";
import { codexTemplateDir, inspectInstallation, installHarness, mergeTomlEntry, specplaneVersion } from "./install.js";

function repo(files: Record<string, string> = {}): string {
  const root = makeRepo({ ".specplane/config.yaml": "paths:\n  requirements: docs/requirements\n", ...files });
  const git = (...a: string[]): void => { assert.equal(spawnSync("git", a, { cwd: root, encoding: "utf8" }).status, 0); };
  git("init", "-q"); git("config", "user.name", "T"); git("config", "user.email", "t@example.invalid");
  git("add", ".specplane/config.yaml"); git("commit", "-qm", "config");
  return root;
}
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const PATHS = [".agents/skills/specplane/SKILL.md", ".agents/skills/specplane/contracts/validate.md", ".codex/config.toml", "AGENTS.md"];

test("T1: setup creates the skill, contracts, MCP entry and block; a second run changes nothing; text outside the block is kept", () => {
  const mine = "# Team\n\nrules  \n";
  const root = repo({ "AGENTS.md": mine });
  const first = installHarness(root, "codex");
  for (const p of PATHS) assert.ok(first.written.includes(p), p);
  assert.ok(read(root, "AGENTS.md").startsWith(mine));
  assert.match(read(root, ".codex/config.toml"), /\[mcp_servers\.specplane\]\ncommand = "specplane"\nargs = \["mcp"\]/);
  const second = installHarness(root, "codex");
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.kept, []);
  for (const p of PATHS) assert.ok(second.unchanged.includes(p), p);
});

test("T1: a symbolic link in an installation path is refused", () => {
  const root = repo();
  fs.mkdirSync(path.join(root, "elsewhere"));
  fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, ".agents"));
  assert.throws(() => installHarness(root, "codex"), /symlink/);
  assert.deepEqual(fs.readdirSync(path.join(root, "elsewhere")), []);
  const root2 = repo();
  fs.mkdirSync(path.join(root2, "elsewhere"));
  fs.symlinkSync(path.join(root2, "elsewhere"), path.join(root2, ".codex"));
  assert.throws(() => installHarness(root2, "codex"), /symlink/);
});

test("the MCP entry is added to an existing Codex configuration without touching it, and an existing entry is kept", () => {
  const mine = 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n';
  const merged = mergeTomlEntry(mine, { path: "c", table: "mcp_servers.specplane", lines: ['command = "specplane"'] });
  assert.ok(merged.text!.startsWith(mine));
  assert.match(merged.text!, /\[mcp_servers\.specplane\]/);
  const custom = '[ mcp_servers . specplane ]\ncommand = "node"\n';
  assert.equal(mergeTomlEntry(custom, { path: "c", table: "mcp_servers.specplane", lines: [] }).text, null);
  const root = repo({ ".codex/config.toml": custom });
  installHarness(root, "codex");
  assert.equal(read(root, ".codex/config.toml"), custom);
});

test("T2: an unbalanced block stops setup with no change", () => {
  const original = "x\n<!-- specplane:begin v1 — m -->\nno end\n";
  const root = repo({ "AGENTS.md": original });
  assert.throws(() => installHarness(root, "codex"), PreconditionError);
  assert.equal(read(root, "AGENTS.md"), original);
  assert.equal(fs.existsSync(path.join(root, ".agents")), false);
  assert.equal(fs.existsSync(path.join(root, ".codex")), false);
});

test("T3: every contract file carries a version header and an older copy is reported", () => {
  const root = repo();
  installHarness(root, "codex");
  for (const c of CODEX_CONTRACTS) assert.match(read(root, `.agents/skills/specplane/${contractPath(c)}`), new RegExp(`specplane:file v${specplaneVersion().replace(/\./g, "\\.")} .*sha:[0-9a-f]{16}`), c);
  assert.deepEqual(inspectInstallation(root), []);
  const f = ".agents/skills/specplane/contracts/validate.md";
  fs.writeFileSync(path.join(root, f), read(root, f).replace(`specplane:file v${specplaneVersion()}`, "specplane:file v0.0.1"));
  assert.match(inspectInstallation(root)[0].message, /written by Specplane 0\.0\.1/);
});

test("the committed templates match the generator and the skill table lists every offered contract", () => {
  const dir = codexTemplateDir();
  assert.equal(fs.readFileSync(path.join(dir, SKILL_FILE), "utf8"), renderCodexSkill());
  for (const c of CODEX_CONTRACTS) assert.equal(fs.readFileSync(path.join(dir, contractPath(c)), "utf8"), renderCodexContract(c), c);
  assert.deepEqual(fs.readdirSync(path.join(dir, "contracts")).sort(), CODEX_CONTRACTS.map((c) => `${c}.md`).sort());
  for (const c of CODEX_CONTRACTS) assert.match(renderCodexSkill(), new RegExp(`contracts/${c}\\.md`));
  for (const c of CODEX_WITHHELD) assert.doesNotMatch(renderCodexSkill(), new RegExp(`contracts/${c}\\.md`));
  assert.deepEqual(CODEX_WITHHELD, ["approve", "requests", "spec-view"]);
});

test("Codex claims only subagents, setup says so, and plan-start refuses with the manual command", () => {
  const adapter = getAdapter("codex")!;
  const caps = adapter.capabilities();
  for (const c of CAPABILITIES) assert.equal(caps[c], c === "subagents", c);
  const root = repo();
  const out = runInit(root, { harness: "codex" }).join("\n");
  assert.match(out, /codex: blocking the Specplane CLI: missing/);
  assert.match(out, /codex: session opening|codex: opening a plan session: missing/);
  assert.match(out, /\.codex\/config\.toml/);
  assert.match(out, /not offered.*approve, requests/);
  assert.throws(() => codexLauncher.open({ root } as any, "p1", { sessionId: "s", resume: false }), (e) => e instanceof PreconditionError && /codex exec/.test(e.message) && /&& codex/.test(e.message));
});

test("the old Protocol 1 runner is gone from the templates", () => {
  const dir = codexTemplateDir();
  assert.equal(fs.existsSync(path.join(dir, "skills/specplane/scripts")), false);
  assert.equal(fs.existsSync(path.join(dir, "skills/specplane/references")), false);
  assert.equal(fs.existsSync(path.join(dir, "contracts/codex-integration.md")), false);
});
