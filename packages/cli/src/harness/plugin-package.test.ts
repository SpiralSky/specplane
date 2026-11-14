import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The packaged Claude Code plugin (`claude-integration` §10): `scripts/build-plugin.mjs` assembles the plugin and a
 * self-contained core, and the manifest declares no MCP server, and the session server entry and the slash-command handler's CLI must exist in that folder alone.
 */
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the packaged plugin declares no MCP server and runs its bundled CLI without the repository", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-plugin-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-plugin-cwd-"));
  try {
    const build = spawnSync("node", [path.join(pkg, "scripts/build-plugin.mjs"), "--out", out], { cwd: pkg, encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, ".claude-plugin/plugin.json"), "utf8"));
    assert.equal(manifest.mcpServers, undefined, "the mod serves the actions, so the manifest declares no MCP server");
    const checked = JSON.parse(fs.readFileSync(path.join(out, ".claude-plugin/host-version.json"), "utf8"));
    assert.equal(checked.checkedHostVersion, "2.1.322");
    assert.ok(fs.existsSync(path.join(out, "hooks/hooks.json")));
    assert.ok(fs.existsSync(path.join(out, "hooks/channel.ts")) && fs.existsSync(path.join(out, "hooks/core-channel.ts")));
    assert.ok(fs.existsSync(path.join(out, "core/dist/harness/session-server-main.js")));
    assert.ok(!fs.existsSync(path.join(out, "core/dist/fixtures.js")));

    // The handler runs `node <plugin root>/core/dist/cli.js` (BUNDLED_CLI).
    const cli = spawnSync("node", [path.join(out, "core/dist/cli.js"), "docs", "essentials"], { cwd, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /Specplane essentials/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
