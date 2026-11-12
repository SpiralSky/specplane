import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyEffects } from "../config-effects.js";
import { hookSectionPresent } from "../git/hooks.js";
import { permissionForStaged } from "./check.js";
import { strictFindings, strictMeasureIn, strictSettings, strictMeasureOn, STRICT_MEASURES } from "../perm/strict.js";
import { applyOsSafeguards, openFiles, relaxOsSafeguards } from "../perm/strict-os.js";
import { writeStoreJson, storeDir } from "../repo/store.js";
import { loadSettings } from "../config.js";
import { getAdapter } from "../harness/adapter.js";
import "../harness/adapters.js";
import { validateProject } from "../verify/validate.js";

/** Strict mode (`roles-and-permissions` R55.1): settings, commit guard, file permissions, validation and capability. */

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sp = (root: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input: "", env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
};
const LLM = { SPECPLANE_ACTOR: "llm", SPECPLANE_MODEL: "opus" };
const REQ = "---\nid: requirement/product-requirements\n---\n\n**R1: One**\nText\n";
const feature = (extra = "") => `---\nid: feature/alpha\ntitle: A\nauthors: [{human: ann}]\ncovers: [R1]\nreferences: []\n---\n\n## R1: One\n\nText${extra}\n`;

function write(root: string, files: Record<string, string>): void {
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); }
}
function repo(config: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-strict-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "tester");
  git(root, "config", "user.email", "t@t");
  write(root, { ".specplane/config.yaml": config, "docs/requirements/product-requirements.md": REQ, "docs/specifications/features/alpha.md": feature() });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "c");
  return root;
}
const rm = (root: string) => fs.rmSync(root, { recursive: true, force: true });
const ON = "strict_mode:\n  enabled: on\n";

test("strict mode is off by default; measures follow the master switch and can be turned off one by one", () => {
  assert.equal(strictMeasureIn(strictSettings(null), "edit_block"), false);
  assert.equal(strictMeasureIn(strictSettings("strict_mode:\n  edit_block: on\n"), "edit_block"), false, "a measure alone does not switch strict mode on");
  const s = strictSettings("strict_mode:\n  enabled: on\n  os_permissions: off\n");
  assert.deepEqual(STRICT_MEASURES.map((m) => strictMeasureIn(s, m)), [true, true, false]);
  assert.deepEqual(strictSettings("strict_mode: {enabled: true, edit_block: false}\n"), { enabled: true, measures: { edit_block: false } });
  assert.deepEqual(strictSettings("strict_mode: nonsense\n"), { enabled: false, measures: {} });
});

test("findings name a measure that does not exist and a measure on while strict mode is off", () => {
  assert.deepEqual(strictFindings(true, { edit_block: false }), []);
  assert.match(strictFindings(true, { nonsense: true })[0], /names no strict mode measure/);
  assert.match(strictFindings(false, { edit_block: true })[0], /has no effect/);
  const root = repo("strict_mode:\n  enabled: off\n  git_commit_guard: on\n  nonsense: on\n");
  try { assert.equal(loadSettings(root).findings.filter((f) => f.key === "strict_mode").length, 2); } finally { rm(root); }
});

test("the committed configuration decides what the core enforces", () => {
  const root = repo(ON);
  try {
    assert.ok(strictMeasureOn(root, "git_commit_guard"));
    write(root, { ".specplane/config.yaml": "" });
    assert.ok(strictMeasureOn(root, "git_commit_guard"), "an uncommitted change is ignored");
  } finally { rm(root); }
});

test("permissionForStaged names the permission a direct change would have needed", () => {
  const dirs: Array<[string, "requirement" | "feature" | "architecture"]> = [["docs/requirements", "requirement"], ["docs/specifications/features", "feature"], ["docs/specifications/architecture", "architecture"], ["lib/sub/features", "feature"]];
  assert.equal(permissionForStaged("M", "docs/specifications/features/a.md", dirs), "spec.edit.feature");
  assert.equal(permissionForStaged("A", "docs/specifications/architecture/a.md", dirs), "spec.create.architecture");
  assert.equal(permissionForStaged("D", "docs/requirements/r.md", dirs), "spec.delete.requirement");
  assert.equal(permissionForStaged("A", "lib/sub/features/a.md", dirs), "spec.create.feature");
  assert.equal(permissionForStaged("M", ".specplane/config.yaml", dirs), "config.change");
  assert.equal(permissionForStaged("A", ".specplane/decisions/D1.md", dirs), "decision.add");
  assert.equal(permissionForStaged("M", ".specplane/roles/roles/r.yaml", dirs), "role.manage");
  assert.equal(permissionForStaged("M", "src/a.ts", dirs), null);
});

test("check strict refuses an LLM process that stages a change its role may not make, and nobody else", () => {
  const root = repo(ON);
  try {
    assert.notEqual(sp(root, ["check", "strict"]).code, 0, "needs --staged");
    write(root, { "docs/specifications/features/alpha.md": feature("\nMore") });
    git(root, "add", "docs/specifications/features/alpha.md");
    const llm = sp(root, ["check", "strict", "--staged"], LLM);
    assert.equal(llm.code, 1, llm.out);
    assert.match(llm.out, /alpha\.md: needs `spec\.edit\.feature`, which is set to request user for the llm role/);
    assert.equal(sp(root, ["check", "strict", "--staged"]).code, 0, "a person commits freely");
    git(root, "reset", "-q");
    git(root, "checkout", "--", "docs/specifications/features/alpha.md");
    write(root, { "docs/specifications/architecture/beta.md": "---\nid: architecture/beta\n---\n\nText\n", "src/a.ts": "x\n" });
    git(root, "add", "-A");
    const ok = sp(root, ["check", "strict", "--staged"], LLM);
    assert.equal(ok.code, 0, ok.out);
  } finally { rm(root); }
});

test("check strict does nothing while strict mode or the commit guard is off", () => {
  for (const config of ["", "strict_mode:\n  enabled: on\n  git_commit_guard: off\n"]) {
    const root = repo(config);
    try {
      write(root, { "docs/specifications/features/alpha.md": feature("\nMore") });
      git(root, "add", "docs/specifications/features/alpha.md");
      const r = sp(root, ["check", "strict", "--staged"], LLM);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /git_commit_guard is off/);
    } finally { rm(root); }
  }
});

test("the pre-commit hook of the commit guard refuses an LLM commit and lets a person commit", () => {
  const root = repo(ON);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-bin-"));
  try {
    fs.writeFileSync(path.join(bin, "specplane"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
    const lines = applyEffects(root, "strict_mode.enabled", false, true);
    assert.match(lines.join("\n"), /Installed the strict commit guard/);
    assert.ok(hookSectionPresent(root, "strict"));
    write(root, { "docs/specifications/features/alpha.md": feature("\nMore") });
    git(root, "add", "docs/specifications/features/alpha.md");
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const llm = spawnSync("git", ["commit", "-qm", "x"], { cwd: root, encoding: "utf8", env: { ...env, ...LLM } });
    assert.notEqual(llm.status, 0, llm.stdout + llm.stderr);
    assert.match(llm.stdout + llm.stderr, /Strict mode refuses this commit/);
    const person = spawnSync("git", ["commit", "-qm", "x"], { cwd: root, encoding: "utf8", env });
    assert.equal(person.status, 0, person.stdout + person.stderr);
    write(root, { ".specplane/config.yaml": "" });
    assert.match(applyEffects(root, "strict_mode.enabled", true, false).join("\n"), /Removed the strict commit guard/);
    assert.ok(!hookSectionPresent(root, "strict"));
  } finally { rm(root); rm(bin); }
});

test("os_permissions makes hooks, settings and the pre-commit hook read-only and the store private, and relaxing undoes the read-only bit", () => {
  const root = repo(ON);
  try {
    write(root, { ".claude/hooks/specplane-x.sh": "#!/bin/sh\n", ".claude/settings.json": "{}\n", ".git/hooks/pre-commit": "#!/bin/sh\n" });
    fs.chmodSync(path.join(root, ".claude/hooks/specplane-x.sh"), 0o755);
    fs.chmodSync(path.join(root, ".git/hooks/pre-commit"), 0o755);
    writeStoreJson(root, "role.json", { role: "standard-user" });
    const roleFile = path.join(storeDir(root), "role.json");
    assert.equal(fs.statSync(roleFile).mode & 0o777, 0o600, "the store is written private");
    fs.chmodSync(roleFile, 0o644);
    assert.ok(openFiles(root).length >= 3);
    applyOsSafeguards(root);
    assert.deepEqual(openFiles(root), []);
    assert.equal(fs.statSync(path.join(root, ".claude/hooks/specplane-x.sh")).mode & 0o777, 0o555, "execute bit kept");
    assert.equal(fs.statSync(storeDir(root)).mode & 0o777, 0o700);
    assert.match(applyOsSafeguards(root)[0], /already/);
    relaxOsSafeguards(root);
    assert.equal(fs.statSync(path.join(root, ".claude/settings.json")).mode & 0o200, 0o200);
    assert.equal(fs.statSync(path.join(root, ".claude/hooks/specplane-x.sh")).mode & 0o111, 0o111);
  } finally { rm(root); }
});

test("the setting effect applies and relaxes file permissions", () => {
  const root = repo(ON);
  try {
    write(root, { ".claude/settings.json": "{}\n" });
    applyEffects(root, "strict_mode.os_permissions", null, true);
    assert.equal(fs.statSync(path.join(root, ".claude/settings.json")).mode & 0o222, 0);
    write(root, { ".specplane/config.yaml": "" });
    applyEffects(root, "strict_mode.enabled", true, false);
    assert.equal(fs.statSync(path.join(root, ".claude/settings.json")).mode & 0o200, 0o200);
  } finally { rm(root); }
});

test("validate reports strict measures the installation cannot carry out, and says nothing while strict mode is off", () => {
  const off = repo("");
  const root = repo(ON);
  try {
    assert.equal(validateProject(off).findings.filter((f) => f.rule === "strict").length, 0);
    const none = validateProject(root).findings.filter((f) => f.rule === "strict").map((f) => f.message);
    assert.ok(none.some((m) => /edit_block is on but no harness is installed/.test(m)), none.join("\n"));
    assert.ok(none.some((m) => /git_commit_guard is on but the strict check is missing/.test(m)));
    write(root, { ".claude/hooks/specplane-cli-block.sh": "#!/bin/sh\n", ".codex/config.toml": "" });
    const both = validateProject(root).findings.filter((f) => f.rule === "strict").map((f) => f.message);
    assert.ok(both.some((m) => /installed Claude hook does not block/.test(m)));
    assert.ok(both.some((m) => /Codex has no pre-tool hook/.test(m)));
    write(root, { ".claude/hooks/specplane-bypass-guard.sh": "# strict_mode\n" });
    assert.ok(!validateProject(root).findings.some((f) => /installed Claude hook does not block/.test(f.message)));
  } finally { rm(off); rm(root); }
});

test("the Claude adapter claims strict mode only with a guard hook that handles it; Codex reports the gap", () => {
  const root = repo("");
  try {
    const claude = getAdapter("claude")!;
    assert.equal(claude.capabilities(root)["strict-mode"], false);
    write(root, { ".claude/hooks/specplane-bypass-guard.sh": "#!/bin/sh\n" });
    assert.equal(claude.capabilities(root)["strict-mode"], false, "an older guard hook");
    write(root, { ".claude/hooks/specplane-bypass-guard.sh": "#!/bin/sh\n# strict_mode\n" });
    assert.equal(claude.capabilities(root)["strict-mode"], true);
    assert.equal(getAdapter("codex")!.capabilities(root)["strict-mode"], false);
  } finally { rm(root); }
});
