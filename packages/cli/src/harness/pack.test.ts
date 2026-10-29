import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."); // packages/cli
const run = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, encoding: "utf8" });

function walk(dir: string, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}

test("packed tarball installs and `init --harness claude` works end to end", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-pack-"));
  try {
    const packDir = path.join(tmp, "pack");
    const prefix = path.join(tmp, "prefix");
    const repo = path.join(tmp, "repo");
    for (const d of [packDir, prefix, repo]) fs.mkdirSync(d);
    const tgz = run("npm", ["pack", "--pack-destination", packDir, "--silent", "--ignore-scripts"], pkgDir).trim().split("\n").pop()!;
    run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--prefer-offline", path.join(packDir, tgz)], tmp);
    const bin = path.join(prefix, "node_modules", ".bin", "specplane");

    run("git", ["init", "-q"], repo);
    fs.mkdirSync(path.join(repo, ".claude"));
    fs.writeFileSync(
      path.join(repo, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] }, statusLine: { type: "command", command: "echo mine" } }),
    );
    const out1 = run(bin, ["init", "--harness", "claude"], repo);
    assert.match(out1, /Created/);

    const files = walk(path.join(repo, ".claude"));
    for (const f of [
      "rules/specplane.md",
      "settings.json",
      ...["spec-assist", "spec-draft-architecture", "plan-create", "plan-step", "plan-finish", "validate"].map((s) => `skills/${s}/SKILL.md`),
      ...["pre-commit", "policy-guard", "session-context", "statusline", "handoff-check", "generate"].map((h) => `hooks/specplane-${h}.sh`),
    ]) {
      assert.ok(files.includes(f), `missing ${f}`);
    }
    for (const f of files.filter((f) => f.startsWith("hooks/"))) {
      assert.equal(fs.statSync(path.join(repo, ".claude", f)).mode & 0o777, 0o755, `${f} mode`);
    }

    const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
    assert.ok(settings.permissions.allow.includes("Bash(ls:*)"));
    assert.equal(settings.statusLine.command, "echo mine");
    assert.ok(JSON.stringify(settings.hooks).includes("specplane-pre-commit.sh"));

    const agents = fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8");
    assert.match(agents, /## Specplane/);
    assert.match(agents, /\/spec-assist/);
    assert.ok(!fs.existsSync(path.join(repo, "CLAUDE.md")));

    const out2 = run(bin, ["init", "--harness", "claude"], repo);
    assert.doesNotMatch(out2, /Updated/);
    assert.doesNotMatch(out2, /Created/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
