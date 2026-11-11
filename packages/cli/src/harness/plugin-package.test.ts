import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The packaged Claude Code plugin (`claude-integration` §10): `scripts/build-plugin.mjs` assembles the plugin and a
 * self-contained core, and the manifest's server and the slash-command handler's CLI must run from that folder alone.
 */
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the packaged plugin runs its MCP server and its bundled CLI without the repository", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-plugin-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-plugin-cwd-"));
  try {
    const build = spawnSync("node", [path.join(pkg, "scripts/build-plugin.mjs"), "--out", out], { cwd: pkg, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, ".claude-plugin/plugin.json"), "utf8"));
    const server = manifest.mcpServers.specplane;
    const entry = (server.args[0] as string).replace("${CLAUDE_PLUGIN_ROOT}", out);
    assert.ok(fs.existsSync(path.join(out, "hooks/hooks.json")));
    assert.ok(!fs.existsSync(path.join(out, "core/dist/fixtures.js")));

    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n";
    const mcp = spawnSync(server.command, [entry], { cwd, input: requests, encoding: "utf8", env: { ...process.env, SPECPLANE_CHECKOUT: cwd } });
    assert.equal(mcp.status, 0, mcp.stderr);
    const replies = mcp.stdout.trim().split("\n").map((l) => JSON.parse(l));
    const names = replies[1].result.tools.map((t: { name: string }) => t.name);
    assert.ok(names.includes("docs_essentials") && names.includes("plan_start"));

    // The handler runs `node <plugin root>/core/dist/cli.js` (BUNDLED_CLI).
    const cli = spawnSync("node", [path.join(out, "core/dist/cli.js"), "docs", "essentials"], { cwd, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /Specplane essentials/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
