import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { acquireWriterLease } from "../core/writer-leases.js";
import { firstStart, recheckStartRefs } from "./first-start.js";
import { prepareStart } from "./prepare-start.js";

const id = "2026-11-02-example";
function fixture(t: import("node:test").TestContext, configText = "") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "first-start-"));
  t.after(() => { fs.rmSync(path.join(os.tmpdir(), ".worktrees", path.basename(cwd)), { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); });
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).trim();
  const put = (name: string, text: string) => { const file = path.join(cwd, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  put(".specplane/config.yaml", configText);
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\n---\n`);
  put("docs/specifications/features/example.md", "---\nid: feature/example\ntitle: Example\nauthor: user\nstatus: approved\n---\n");
  git("add", "."); git("commit", "-m", "base");
  return { cwd, git, put, config: loadConfig(cwd).config };
}
test("first start binds the authoritative nondefault target in a metadata-only commit", t => {
  const f = fixture(t, "execution:\n  backend: external\n"); f.git("branch", "candidate");
  const base = f.git("rev-parse", "candidate"); f.put("docs/specifications/features/example.md", "unapproved in working tree");
  const result = firstStart(id, f.config, f.cwd, { target: "candidate", fetch: false });
  assert.equal(result.target, "candidate"); assert.equal(result.startBase, base);
  const ref = `plan/${id}`; assert.equal(f.git("rev-parse", `${ref}^`), base);
  assert.equal(f.git("diff", "--name-only", base, ref), `plans/${id}/PLAN.md`);
  const text = f.git("show", `${ref}:plans/${id}/PLAN.md`);
  assert.match(text, /target_branch: "candidate"/); assert.match(text, new RegExp(`start_base: ${base}`));
  assert.match(f.git("log", "-1", "--format=%B", ref), /Specplane-Workflow: start/);
  assert.equal(fs.readFileSync(path.join(f.cwd, "docs/specifications/features/example.md"), "utf8"), "unapproved in working tree");
  assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /Resume/);
  assert.equal(f.git("rev-parse", ref), f.git("rev-parse", `refs/heads/${ref}`));
});
test("dry run and refusal leave no branch or runtime files", t => {
  const f = fixture(t, "execution:\n  backend: external\n"); const before = f.git("status", "--porcelain");
  assert.equal(firstStart(id, f.config, f.cwd, { dryRun: true }).dryRun, true);
  assert.throws(() => firstStart(id, f.config, f.cwd, { dryRun: true, target: "missing" }), /unavailable/);
  assert.equal(fs.existsSync(path.join(f.cwd, ".git/specplane-runtime")), false); assert.equal(f.git("status", "--porcelain"), before);
  assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});
test("repository lease excludes start before mutation", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const holder = acquireWriterLease({ repository: true, checkouts: [f.cwd], requestId: "holder" });
  try { assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /lease/); }
  finally { holder.release(); }
  assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});
test("failed setup retains binding branch and removes only new checkout", t => {
  const f = fixture(t, "plans:\n  setup_hook: 'exit 1'\nexecution:\n  backend: worktree\n  worktree_dir: ../.worktrees\n");
  assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /Recovery:.*start commit/s);
  assert.match(f.git("show", `plan/${id}:plans/${id}/PLAN.md`), /start_base:/);
  assert.equal(f.git("worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
});
test("frontmatter claim uses target checkout and leaves unrelated checkout unchanged", t => {
  const f = fixture(t, "plans:\n  status_source: frontmatter\nexecution:\n  backend: external\n");
  f.git("branch", "candidate"); const target = path.join(f.cwd, "candidate-checkout"); f.git("worktree", "add", target, "candidate");
  const main = f.git("rev-parse", "main"); const result = firstStart(id, f.config, f.cwd, { target: "candidate", fetch: false });
  assert.equal(f.git("rev-parse", "main"), main); assert.equal(result.startBase, f.git("rev-parse", "candidate"));
  assert.match(f.git("show", `candidate:plans/${id}/PLAN.md`), /status: in_progress/);
  assert.equal(f.git("rev-parse", `plan/${id}^`), result.startBase);
});

test("stale captured target ref refuses before a plan branch is created", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const prepared = prepareStart(id, f.config, f.cwd); f.put("changed", "changed"); f.git("add", "changed"); f.git("commit", "-m", "move target");
  const after = f.git("rev-parse", "HEAD");
  assert.throws(() => recheckStartRefs(f.cwd, prepared.refs), /changed during preparation/);
  assert.equal(f.git("rev-parse", "HEAD"), after); assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});

test("CLI previews the selected target and rejects standalone run without writes", t => {
  const f = fixture(t, "execution:\n  backend: external\n"); f.git("branch", "candidate");
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const preview = spawnSync(process.execPath, [cli, "plan", "start", id, "--target", "candidate", "--dry-run", "--json"], { cwd: f.cwd, encoding: "utf8", timeout: 5000 });
  assert.equal(preview.status, 0, preview.stderr); assert.equal(JSON.parse(preview.stdout).target, "candidate");
  const run = spawnSync(process.execPath, [cli, "plan", "start", id, "--run"], { cwd: f.cwd, encoding: "utf8", timeout: 5000 });
  assert.equal(run.status, 1); assert.match(run.stderr, /Standalone --run/);
  assert.equal(f.git("branch", "--list", `plan/${id}`), ""); assert.equal(fs.existsSync(path.join(f.cwd, ".git/specplane-runtime")), false);
});
