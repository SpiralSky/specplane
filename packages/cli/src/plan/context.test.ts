import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveCommit, resolvePlanContext, validateExecutionBinding } from "./context.js";
import { loadConfig } from "../config.js";
import { parsePlan } from "./parse.js";

const id = "2026-11-02-example";
function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "target-context-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(cwd, "file"), "original"); git("add", "file"); git("commit", "-m", "base");
  return { cwd, git, base: git("rev-parse", "HEAD") };
}

test("target precedence, conflicts, legacy ambiguity and unavailable targets preserve work", () => {
  const { cwd, git, base } = repo();
  for (const name of ["team", "declared", "explicit"]) git("branch", name);
  const resolve = (options = {}) => resolvePlanContext(cwd, { id, ...options });
  assert.equal(resolve().targetBranch, "main");
  assert.equal(resolve({ team: "team" }).targetBranch, "team");
  assert.equal(resolve({ team: "team", declared: "declared" }).targetBranch, "declared");
  assert.equal(resolve({ team: "team", explicit: "explicit" }).targetBranch, "explicit");
  assert.throws(() => resolve({ explicit: "explicit", declared: "declared" }), /conflicts/);
  assert.throws(() => resolve({ explicit: "missing" }), /unavailable/);
  assert.throws(() => resolve({ legacy: {} }), /ambiguous/);
  assert.throws(() => resolve({ legacy: { originalDefault: "master" } }), /changed/);
  assert.equal(resolve({ legacy: { originalDefault: "main" }, team: "team" }).targetCommit, base);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/gone");
  assert.throws(() => resolve({ legacy: { originalDefault: "gone" } }), /unavailable/);
  assert.equal(fs.readFileSync(path.join(cwd, "file"), "utf8"), "original");
  assert.equal(git("rev-parse", "HEAD"), base);
});

test("local and remote tips reconcile, divergence refuses, remote-only remains readable", () => {
  const { cwd, git, base } = repo();
  fs.writeFileSync(path.join(cwd, "file"), "second"); git("commit", "-am", "second");
  const next = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", next); git("branch", "-f", "local", base);
  git("update-ref", "refs/remotes/origin/local", next);
  assert.equal(resolvePlanContext(cwd, { id, explicit: "local" }).targetCommit, next);
  git("update-ref", "refs/remotes/origin/only", base);
  assert.equal(resolvePlanContext(cwd, { id, explicit: "only" }).targetCommit, base);
  git("checkout", "--detach", base); fs.writeFileSync(path.join(cwd, "file"), "other"); git("commit", "-am", "other");
  git("branch", "-f", "local", "HEAD");
  assert.throws(() => resolvePlanContext(cwd, { id, explicit: "local" }), /divergent/);
  assert.equal(git("rev-parse", "refs/heads/local"), git("rev-parse", "HEAD"));
});

test("inputs and immutable execution bindings require valid branches and full commit objects", () => {
  const { cwd, git, base } = repo();
  git("branch", "team");
  assert.equal(resolveCommit(cwd, "HEAD"), base);
  git("checkout", "team"); git("checkout", "main");
  assert.equal(git("check-ref-format", "--branch", "@{-1}"), "team");
  for (const target of ["../bad", "main~1", `plan/${id}`, "-bad", "HEAD", "@{-1}"]) assert.throws(() => resolvePlanContext(cwd, { id, explicit: target }), /Invalid/);
  for (const commit of [base.slice(0, 8), "HEAD", "f".repeat(40)]) assert.throws(() => resolvePlanContext(cwd, { id, comparisonBase: commit }), /Invalid/);
  const binding = { target_branch: "team", start_target_branch: "main", start_base: base, target_changes: [{ from: "main", to: "team" }] };
  assert.equal(resolvePlanContext(cwd, { id, binding, team: "main", comparisonBase: base }).targetBranch, "team");
  assert.throws(() => resolvePlanContext(cwd, { id, binding, explicit: "main" }), /conflicts/);
  assert.throws(() => validateExecutionBinding(cwd, id, { ...binding, start_base: "HEAD" }), /Malformed/);
  assert.throws(() => validateExecutionBinding(cwd, id, { ...binding, target_changes: [{ from: "team", to: "main" }] }), /chain/);
  assert.throws(() => validateExecutionBinding(cwd, id, binding, "main"), /declaration/);
  assert.throws(() => validateExecutionBinding(cwd, id, binding, undefined, { ...binding, start_base: "f".repeat(40) }), /Invalid/);
  assert.equal(git("rev-parse", "HEAD"), base);
});

test("plan metadata and configured team target are parsed and validated", () => {
  const { cwd, base } = repo();
  fs.mkdirSync(path.join(cwd, "docs/specifications"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".specplane"));
  fs.writeFileSync(path.join(cwd, ".specplane/config.yaml"), "plans:\n  target_branch: release\n");
  assert.equal(loadConfig(cwd).config.plans.target_branch, "release");
  fs.writeFileSync(path.join(cwd, ".specplane/config.yaml"), "plans:\n  target_branch: bad..name\n");
  assert.throws(() => loadConfig(cwd), /plans.target_branch/);
  const dir = path.join(cwd, id); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "PLAN.md"), `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ntarget_branch: main\ncomparison_base: ${base}\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${base}\n---\nBody\n`);
  assert.equal(parsePlan(dir).frontmatter.execution?.start_base, base);
});

test("captured plan branches refuse divergence, conflicting identity and rewritten provenance", () => {
  const { cwd, git, base } = repo();
  const binding = { target_branch: "main", start_target_branch: "main", start_base: base };
  const older = { id, commit: base, binding, comparisonBase: base };
  fs.writeFileSync(path.join(cwd, "file"), "next"); git("commit", "-am", "next");
  const next = git("rev-parse", "HEAD");
  const newer = { ...older, commit: next };
  assert.equal(resolvePlanContext(cwd, { id, binding, comparisonBase: base, planBranches: { local: newer, remote: older } }).targetBranch, "main");
  assert.throws(() => resolvePlanContext(cwd, { id, planBranches: { local: newer, remote: { ...older, id: "other" } } }), /identity/);
  assert.throws(() => resolvePlanContext(cwd, { id, planBranches: { local: { ...newer, comparisonBase: next }, remote: older } }), /comparison provenance/);
  assert.throws(() => resolvePlanContext(cwd, { id, planBranches: { local: { ...newer, binding: { ...binding, start_base: next } }, remote: older } }), /provenance/);
  git("checkout", "--detach", base); fs.writeFileSync(path.join(cwd, "file"), "fork"); git("commit", "-am", "fork");
  assert.throws(() => resolvePlanContext(cwd, { id, planBranches: { local: newer, remote: { ...older, commit: git("rev-parse", "HEAD") } } }), /Divergent/);
});

test("started snapshots control binding and require evidence for legacy targets", () => {
  const { cwd, git, base } = repo();
  git("branch", "candidate");
  const snapshot = { id, commit: base, comparisonBase: base };
  for (const planBranches of [{ local: snapshot }, { remote: snapshot }]) {
    assert.throws(() => resolvePlanContext(cwd, { id, team: "candidate", planBranches }), /recovery/);
    assert.throws(() => resolvePlanContext(cwd, { id, legacy: { originalDefault: "master" }, planBranches }), /changed/);
    const context = resolvePlanContext(cwd, { id, team: `plan/${id}`, legacy: { originalDefault: "main" }, planBranches });
    assert.equal(context.targetBranch, "main");
    assert.equal(context.comparisonBase, base);
    assert.equal(context.legacy, true);
  }
  const binding = { target_branch: "main", start_target_branch: "main", start_base: base };
  const bound = { ...snapshot, binding };
  const context = resolvePlanContext(cwd, { id, team: `plan/${id}`, planBranches: { remote: bound } });
  assert.deepEqual(context.binding, binding);
  assert.equal(context.comparisonBase, base);
  assert.throws(() => resolvePlanContext(cwd, { id, binding, planBranches: {} }), /no corresponding/);
  assert.throws(() => resolvePlanContext(cwd, { id, binding, planBranches: { local: snapshot } }), /conflicts/);
  assert.throws(() => resolvePlanContext(cwd, { id, comparisonBase: base, planBranches: { local: { id, commit: base } } }), /conflicts/);
});

test("repository default fallback considers local and origin refs in main-first order", () => {
  const { cwd, git, base } = repo();
  git("checkout", "--detach");
  git("branch", "-D", "main");
  git("update-ref", "refs/remotes/origin/main", base);
  assert.equal(resolvePlanContext(cwd, { id }).targetBranch, "main");
  git("update-ref", "refs/remotes/origin/master", base);
  git("branch", "master", base);
  assert.equal(resolvePlanContext(cwd, { id }).targetBranch, "main");
  git("update-ref", "-d", "refs/remotes/origin/main");
  git("branch", "-D", "master");
  assert.equal(resolvePlanContext(cwd, { id }).targetBranch, "master");
});
