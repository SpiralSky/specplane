import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../config.js";
import { prepareStart } from "./prepare-start.js";

const id = "2026-11-02-example";
const ownedDirs: string[] = [];
after(() => { for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-start-")); ownedDirs.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).trim();
  const put = (name: string, text: string) => { const file = path.join(cwd, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  put(".specplane/config.yaml", "plans:\n  dependency_mode: stack\n");
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\n---\n`);
  put("docs/specifications/features/example.md", "---\nid: feature/example\ntitle: Example\nauthor: user\nstatus: approved\n---\nApproved\n");
  git("add", "."); git("commit", "-m", "base");
  return { cwd, git, put, config: loadConfig(cwd).config };
}
test("prepares committed target and preserves dirty invoking files", () => {
  const { cwd, git, put, config } = fixture(); const head = git("rev-parse", "HEAD");
  put("docs/specifications/features/example.md", "dirty unapproved");
  const before = git("status", "--porcelain"); const result = prepareStart(id, config, cwd);
  assert.equal(result.base, head); assert.equal(result.context.targetBranch, "main"); assert.equal(result.first, true);
  assert.equal(result.refs["refs/heads/main"], head); assert.equal(git("status", "--porcelain"), before);
  assert.equal(fs.readFileSync(path.join(cwd, "docs/specifications/features/example.md"), "utf8"), "dirty unapproved");
});
test("refuses target-local missing plan, unapproved spec and conflicting paths", () => {
  const { cwd, git, put, config } = fixture(); git("branch", "candidate");
  put("docs/specifications/features/example.md", "---\nid: feature/example\ntitle: Example\nauthor: user\nstatus: review\n---\n"); git("commit", "-am", "review");
  assert.throws(() => prepareStart(id, config, cwd), /not approved/);
  git("checkout", "candidate"); put(".specplane/config.yaml", "plans:\n  dir: other\n"); git("commit", "-am", "paths");
  assert.throws(() => prepareStart(id, config, cwd, { target: "candidate" }), /path interpretation/);
  git("checkout", "main"); git("branch", "empty", "HEAD~1"); git("checkout", "empty"); git("rm", `plans/${id}/PLAN.md`); git("commit", "-m", "remove plan"); git("checkout", "main");
  assert.throws(() => prepareStart(id, config, cwd, { target: "empty" }), /not found/i);
});
test("refuses ambiguous legacy and divergent target refs without writes", () => {
  const { cwd, git, put, config } = fixture(); const original = git("rev-parse", "HEAD");
  git("branch", `plan/${id}`); assert.throws(() => prepareStart(id, config, cwd), /ambiguous/); git("branch", "-D", `plan/${id}`);
  put("a", "one"); git("add", "a"); git("commit", "-m", "one"); const local = git("rev-parse", "HEAD");
  git("checkout", "--detach", original); put("b", "two"); git("add", "b"); git("commit", "-m", "two"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  const before = git("status", "--porcelain"); assert.throws(() => prepareStart(id, config, cwd), /divergent/);
  assert.equal(git("rev-parse", "refs/heads/main"), local); assert.equal(git("status", "--porcelain"), before);
});
test("stack preparation validates dependency binding and prospective specification revision", () => {
  const { cwd, git, put, config } = fixture();
  const dep = "2026-11-02-base";
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ndepends_on: [${dep}]\n---\n`);
  put(`plans/${dep}/PLAN.md`, `---\nid: ${dep}\ntitle: Base\nstatus: ready\nspecs: [feature/example]\n---\n`);
  git("add", "."); git("commit", "-m", "add dependency"); const target = git("rev-parse", "HEAD");
  git("checkout", "-b", `plan/${dep}`);
  put(`plans/${dep}/PLAN.md`, `---\nid: ${dep}\ntitle: Base\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${target}\n---\n`);
  git("commit", "-am", "bind"); const base = git("rev-parse", "HEAD"); git("checkout", "main");
  const result = prepareStart(id, config, cwd); assert.equal(result.stackId, dep); assert.equal(result.base, base);
  git("checkout", `plan/${dep}`); put("docs/specifications/features/example.md", "---\nid: feature/example\ntitle: Example\nauthor: user\nstatus: approved\n---\nChanged\n"); git("commit", "-am", "change spec"); git("checkout", "main");
  const before = git("status", "--porcelain"); assert.throws(() => prepareStart(id, config, cwd), /different required specification/); assert.equal(git("status", "--porcelain"), before);
});
test("explicit target and recorded resume ignore malformed unrelated HEAD plan", () => {
  const { cwd, git, put, config } = fixture();
  git("branch", "candidate"); git("checkout", "-b", "unrelated");
  put(`plans/${id}/PLAN.md`, "---\nid: wrong\n---\n"); git("commit", "-am", "invalid unrelated plan");
  const before = git("status", "--porcelain");
  assert.equal(prepareStart(id, config, cwd, { target: "candidate" }).context.targetBranch, "candidate");
  git("checkout", "candidate"); const start = git("rev-parse", "HEAD"); git("checkout", "-b", `plan/${id}`);
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: candidate\n  start_target_branch: candidate\n  start_base: ${start}\n---\n`); git("commit", "-am", "bind"); git("checkout", "unrelated");
  assert.equal(prepareStart(id, config, cwd).first, false); assert.equal(git("status", "--porcelain"), before);
});
test("resume refuses conflicting target and branch immutable metadata", () => {
  const { cwd, git, put, config } = fixture(); const start = git("rev-parse", "HEAD");
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ncomparison_base: ${start}\n---\n`); git("commit", "-am", "record comparison");
  git("checkout", "-b", `plan/${id}`);
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ncomparison_base: ${start}\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${start}\n---\n`); git("commit", "-am", "bind"); git("checkout", "main");
  assert.equal(prepareStart(id, config, cwd).first, false);
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\n---\n`); git("commit", "-am", "remove comparison");
  assert.throws(() => prepareStart(id, config, cwd), /comparison provenance conflict/);
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ncomparison_base: ${"f".repeat(40)}\n---\n`); git("commit", "-am", "conflict comparison");
  assert.throws(() => prepareStart(id, config, cwd), /comparison provenance conflict/);
  const target = git("rev-parse", "HEAD");
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ncomparison_base: ${start}\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${target}\n---\n`); git("commit", "-am", "conflict binding");
  const before = git("status", "--porcelain"); assert.throws(() => prepareStart(id, config, cwd), /execution binding conflict/); assert.equal(git("status", "--porcelain"), before);
});
test("malformed or misidentified approved specification cannot authorize start", () => {
  const { cwd, git, put, config } = fixture();
  for (const text of ["---\nid: feature/example\nstatus: approved\n---\n", "---\nid: feature/other\ntitle: Example\nauthor: user\nstatus: approved\n---\n"]) {
    put("docs/specifications/features/example.md", text); git("commit", "-am", "invalid spec");
    const before = git("status", "--porcelain"); const head = git("rev-parse", "HEAD");
    assert.throws(() => prepareStart(id, config, cwd), /Invalid required specification/);
    assert.equal(git("status", "--porcelain"), before); assert.equal(git("rev-parse", "HEAD"), head);
  }
});
test("first start refuses an orphaned execution binding without modifying refs", () => {
  const { cwd, git, put, config } = fixture(); const base = git("rev-parse", "HEAD");
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}\n---\n`); git("commit", "-am", "orphan binding");
  const head = git("rev-parse", "HEAD"); const before = git("status", "--porcelain");
  assert.throws(() => prepareStart(id, config, cwd), /orphaned execution binding/);
  assert.equal(git("rev-parse", "HEAD"), head); assert.equal(git("status", "--porcelain"), before);
});
