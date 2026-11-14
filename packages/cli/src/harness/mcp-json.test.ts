import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeRepo } from "../test-repo.js";
import { installHarness, mergeMcpJson } from "./install.js";

const ENTRY = { command: "specplane", args: ["mcp"], env: { SPECPLANE_ADAPTER: "claude" } };
function repo(files: Record<string, string> = {}): string {
  const root = makeRepo({ ".specplane/config.yaml": "paths:\n  requirements: docs/requirements\n", ...files });
  const git = (...a: string[]): void => { assert.equal(spawnSync("git", a, { cwd: root, encoding: "utf8" }).status, 0); };
  git("init", "-q"); git("config", "user.name", "T"); git("config", "user.email", "t@example.invalid");
  git("add", ".specplane/config.yaml"); git("commit", "-qm", "config");
  return root;
}
const read = (root: string): unknown => JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));

test("a fresh Claude init registers the specplane MCP server in .mcp.json, and a repeat init changes nothing", () => {
  const root = repo();
  const first = installHarness(root, "claude");
  assert.ok(first.written.includes(".mcp.json"));
  assert.deepEqual(read(root), { mcpServers: { specplane: ENTRY } });
  const before = fs.readFileSync(path.join(root, ".mcp.json"), "utf8");
  const second = installHarness(root, "claude");
  assert.ok(second.unchanged.includes(".mcp.json"));
  assert.ok(!second.written.includes(".mcp.json"));
  assert.equal(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"), before);
});

test("an existing .mcp.json keeps its other servers and keys", () => {
  const mine = { extra: 1, mcpServers: { other: { command: "x" } } };
  const root = repo({ ".mcp.json": JSON.stringify(mine) });
  installHarness(root, "claude");
  assert.deepEqual(read(root), { extra: 1, mcpServers: { other: { command: "x" }, specplane: ENTRY } });
});

test("a differing specplane entry is kept and reported; invalid JSON is skipped with a report", () => {
  const custom = JSON.stringify({ mcpServers: { specplane: { command: "/opt/sp", args: ["mcp"] } } });
  const root = repo({ ".mcp.json": custom });
  const r = installHarness(root, "claude");
  assert.equal(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"), custom);
  assert.ok(r.lines.some((l) => /Kept the existing `specplane` server in \.mcp\.json/.test(l)));
  const bad = mergeMcpJson("{nope", { path: ".mcp.json", server: "specplane", entry: ENTRY });
  assert.equal(bad.text, null);
  assert.match(bad.lines[0], /^Skipped \.mcp\.json \(invalid JSON/);
  assert.equal(mergeMcpJson('{"mcpServers": []}', { path: ".mcp.json", server: "specplane", entry: ENTRY }).text, null);
});

test("a .mcp.json that is a symlink resolving outside the repository is refused and the target is untouched", () => {
  const root = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-outside-"));
  const target = path.join(outside, "mcp.json");
  fs.writeFileSync(target, "{}\n");
  fs.symlinkSync(target, path.join(root, ".mcp.json"));
  assert.throws(() => installHarness(root, "claude"), /symlink/);
  assert.equal(fs.readFileSync(target, "utf8"), "{}\n");
  assert.ok(!fs.existsSync(path.join(root, ".claude/settings.json")), "nothing else was written");
});

test("a dangling .mcp.json symlink pointing outside the repository is refused and the outside file is not created", () => {
  const root = repo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-outside-"));
  const target = path.join(outside, "missing.json");
  fs.symlinkSync(target, path.join(root, ".mcp.json"));
  assert.throws(() => installHarness(root, "claude"), /symlink/);
  assert.ok(!fs.existsSync(target), "the outside file was not created");
});
