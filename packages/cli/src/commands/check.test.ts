import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hookSectionPresent, installHookSection, removeHookSection } from "../git/hooks.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sp = (root: string, args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input: "", env: { ...process.env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const REQ = "---\nid: requirement/product-requirements\n---\n\n**R1: One**\nText\n";
const blk = (yaml: string) => `\`\`\`specplane-test\n${yaml}\n\`\`\`\n`;
const feature = "---\nid: feature/alpha\ntitle: A\nauthors: [{human: ann}]\ncovers: [R1]\nreferences: []\n---\n\n## R1: One\n\nText\n";
const arch = (cmd: string) => `---\nid: architecture/beta\ntitle: B\nauthors: [{human: ann}]\ncovers: [alpha R1]\nreferences: []\n---\n\n## §1 Part\n\nTest T1 (deterministic): runs.\n\n${blk(`run: ["sh", "-c", "${cmd}"]`)}`;

function write(root: string, files: Record<string, string>): void {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
}
function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-check-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "tester");
  git(root, "config", "user.email", "t@t");
  write(root, { "docs/requirements/product-requirements.md": REQ, "docs/specifications/features/alpha.md": feature });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "c");
  return root;
}
const rm = (root: string) => fs.rmSync(root, { recursive: true, force: true });

test("check requirement-ids --staged refuses a duplicate in the index and ignores the working tree", () => {
  const root = repo();
  try {
    assert.notEqual(sp(root, ["check", "requirement-ids"]).code, 0, "needs --staged");
    assert.equal(sp(root, ["check", "requirement-ids", "--staged"]).code, 0);
    write(root, { "docs/requirements/product-requirements.md": REQ + "\n**R1: Again**\nText\n" });
    assert.equal(sp(root, ["check", "requirement-ids", "--staged"]).code, 0, "unstaged change is not checked");
    git(root, "add", "docs/requirements/product-requirements.md");
    const r = sp(root, ["check", "requirement-ids", "--staged"]);
    assert.equal(r.code, 1);
    assert.match(r.err + r.out, /duplicate requirement ID R1 \(also at docs\/requirements\/product-requirements\.md:\d+\)/);
  } finally { rm(root); }
});

test("check tests --staged runs only staged architecture specs on the index", () => {
  const root = repo();
  try {
    assert.match(sp(root, ["check", "tests", "--staged"]).out, /No architecture specs are staged/);
    // A passing test in the index; the working tree holds a failing version that must be ignored.
    write(root, { "docs/specifications/architecture/beta.md": arch("exit 0") });
    git(root, "add", "docs/specifications/architecture/beta.md");
    write(root, { "docs/specifications/architecture/beta.md": arch("exit 1") });
    const ok = sp(root, ["check", "tests", "--staged"]);
    assert.equal(ok.code, 0, ok.out + ok.err);
    assert.match(ok.out, /1 deterministic test\(s\) passed/);
    write(root, { "docs/specifications/architecture/beta.md": arch("exit 1") });
    git(root, "add", "docs/specifications/architecture/beta.md");
    const bad = sp(root, ["check", "tests", "--staged"]);
    assert.equal(bad.code, 1);
    assert.match(bad.out + bad.err, /architecture\/beta §1#T1\s+failed/);
    assert.equal(fs.readdirSync(path.join(root, ".git", "specplane", "tmp")).length, 0, "temporary checkout removed");
    assert.equal(git(root, "notes", "--ref=specplane", "list"), "", "nothing recorded");
  } finally { rm(root); }
});

test("hook sections install, are idempotent, and remove only their own lines", () => {
  const root = repo();
  try {
    const file = path.join(root, ".git", "hooks", "pre-commit");
    assert.equal(installHookSection(root, "requirement-ids"), "installed");
    assert.equal(installHookSection(root, "requirement-ids"), "already");
    assert.ok(fs.statSync(file).mode & 0o100, "created executable");
    installHookSection(root, "tests");
    assert.ok(hookSectionPresent(root, "tests"));
    assert.equal(removeHookSection(root, "requirement-ids"), "removed");
    assert.ok(!hookSectionPresent(root, "requirement-ids") && hookSectionPresent(root, "tests"));
    assert.equal(removeHookSection(root, "tests"), "removed");
    assert.ok(!fs.existsSync(file), "file deleted when only the shebang remains");
    assert.equal(removeHookSection(root, "tests"), "absent");
    // Foreign lines survive.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "#!/bin/sh\necho mine\nexit 0\n");
    installHookSection(root, "tests");
    removeHookSection(root, "tests");
    assert.equal(fs.readFileSync(file, "utf8"), "#!/bin/sh\necho mine\nexit 0\n");
  } finally { rm(root); }
});

test("config set pre_commit.* installs and removes the hook; validate warns when the section is missing; the hook blocks a commit", () => {
  const root = repo();
  try {
    const file = path.join(root, ".git", "hooks", "pre-commit");
    const set = sp(root, ["config", "set", "pre_commit.duplicate_requirement_ids", "on"]);
    assert.equal(set.code, 0, set.err);
    assert.match(set.out, /Installed the requirement-ids check/);
    assert.ok(fs.readFileSync(file, "utf8").includes("# specplane:begin requirement-ids"));
    git(root, "add", "-A");
    git(root, "commit", "-qm", "config");
    const warnFree = sp(root, ["validate"]);
    assert.doesNotMatch(warnFree.out, /pre-commit/);
    // The hook finds `specplane` on PATH; give it a shim for this checkout's built CLI.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-bin-"));
    fs.writeFileSync(path.join(bin, "specplane"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
    write(root, { "docs/requirements/product-requirements.md": REQ + "\n**R1: Again**\nText\n" });
    git(root, "add", "docs/requirements/product-requirements.md");
    const c = spawnSync("git", ["commit", "-qm", "dup"], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.notEqual(c.status, 0);
    assert.match(c.stderr + c.stdout, /duplicate requirement ID R1/);
    rm(bin);
    git(root, "reset", "-q", "--hard");
    // Delete the section by hand: validation warns.
    fs.rmSync(file);
    const missing = sp(root, ["validate"]);
    assert.match(missing.out, /\[warning\].*\(pre-commit\).*pre_commit\.duplicate_requirement_ids is on but the requirement-ids check is missing/);
    assert.equal(missing.code, 0);
    // Turning it off with the section gone is harmless; unset restores nothing.
    sp(root, ["config", "set", "pre_commit.duplicate_requirement_ids", "off"]);
    assert.ok(!fs.existsSync(file));
  } finally { rm(root); }
});
