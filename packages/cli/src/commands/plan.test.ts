import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getEffectiveStatus } from "../plan/status.js";
import { makeRepo } from "../test-repo.js";
import type { Config } from "../types.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const cfg = (source: string) => `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  status_source: ${source}\n`;
const plan = (id: string, status: string, extra = "") =>
  `---\nid: ${id}\ntitle: "T ${id}"\nstatus: ${status}\nspecs: [feature/x]\n${extra}---\n# P\n`;

function repo(source = "git"): string {
  const root = makeRepo({
    ".specplane/config.yaml": cfg(source),
    "plans/2026-01-01-alpha/PLAN.md": plan("2026-01-01-alpha", "ready"),
    "plans/2026-01-02-beta/PLAN.md": plan("2026-01-02-beta", "ready", "depends_on: [2026-01-01-alpha]\n"),
    "plans/2026-01-03-gamma/PLAN.md": plan("2026-01-03-gamma", "abandoned"),
    "plans/2026-01-04-delta/PLAN.md": plan("2026-01-04-delta", "done"),
    "plans/archive/2025-12-01-old/PLAN.md": plan("2025-12-01-old", "done"),
  });
  const git = (...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  return root;
}
const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const rows = (root: string, ...args: string[]) => JSON.parse(run(root, "plan", "list", "--json", ...args).out) as Record<string, unknown>[];
const eff = (root: string) => Object.fromEntries(rows(root).map((r) => [r.id, r.effective_status]));

test("plan list: ready plan without a branch is ready; blocked dependent (Scenario 2)", () => {
  const root = repo();
  const e = eff(root);
  assert.equal(e["2026-01-01-alpha"], "ready");
  assert.equal(e["2026-01-02-beta"], "blocked");
  assert.equal(e["2026-01-03-gamma"], "abandoned");
  assert.equal(e["2026-01-04-delta"], "done");
});

test("plan list: branch makes a ready plan in_progress, blocked wins, done unchanged (Scenarios 1, 2, 6)", () => {
  const root = repo();
  for (const id of ["2026-01-01-alpha", "2026-01-02-beta", "2026-01-04-delta"]) spawnSync("git", ["branch", `plan/${id}`], { cwd: root });
  const e = eff(root);
  assert.equal(e["2026-01-01-alpha"], "in_progress");
  assert.equal(e["2026-01-02-beta"], "blocked");
  assert.equal(e["2026-01-04-delta"], "done");
});

test("plan list: status_source frontmatter ignores branches", () => {
  const root = repo("frontmatter");
  spawnSync("git", ["branch", "plan/2026-01-01-alpha"], { cwd: root });
  assert.equal(eff(root)["2026-01-01-alpha"], "ready");
});

test("plan list: abandoned dependency blocks a ready plan (Scenario 4: abandoned dependency)", () => {
  const root = makeRepo({
    ".specplane/config.yaml": cfg("git"),
    "plans/2026-01-03-gamma/PLAN.md": plan("2026-01-03-gamma", "abandoned"),
    "plans/2026-01-05-eps/PLAN.md": plan("2026-01-05-eps", "ready", "depends_on: [2026-01-03-gamma]\n"),
  });
  spawnSync("git", ["init", "-q"], { cwd: root });
  assert.equal(eff(root)["2026-01-05-eps"], "blocked");
});

test("plan list: JSON fields, sorting, archived, --status filter, human table", () => {
  const root = repo();
  const all = rows(root);
  assert.deepEqual(Object.keys(all[0]!), ["id", "title", "stored_status", "effective_status", "depends_on", "specs", "archived"]);
  assert.equal(all[0]!.id, "2026-01-04-delta");
  assert.equal(all.at(-1)!.archived, true);
  assert.deepEqual(rows(root, "--status", "blocked").map((r) => r.id), ["2026-01-02-beta"]);
  const h = run(root, "plan", "list");
  assert.equal(h.code, 0, h.err);
  assert.match(h.out, /^2026-01-04-delta {2}T 2026-01-04-delta {2}done$/m);
  assert.equal(run(root, "plan", "list", "--status", "bogus").code, 1);
});

test("plan list: stack mode blocks two unmerged dependencies and prints the reason", () => {
  const root = makeRepo({
    ".specplane/config.yaml": "spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  dependency_mode: stack\n",
    "plans/2026-01-01-alpha/PLAN.md": plan("2026-01-01-alpha", "ready"),
    "plans/2026-01-02-beta/PLAN.md": plan("2026-01-02-beta", "ready"),
    "plans/2026-01-03-gamma/PLAN.md": plan("2026-01-03-gamma", "ready", "depends_on: [2026-01-01-alpha, 2026-01-02-beta]\n"),
  });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: root });
  assert.equal(eff(root)["2026-01-03-gamma"], "blocked");
  const h = run(root, "plan", "list");
  assert.equal(h.code, 0, h.err);
  assert.match(h.out, /^2026-01-03-gamma {2}T 2026-01-03-gamma {2}blocked {2}Cannot stack on more than one unmerged dependency: `2026-01-01-alpha`, `2026-01-02-beta`\.$/m);
});

test("getEffectiveStatus: forge hook derives review; non-ready statuses unchanged", () => {
  const config = { plans: { status_source: "git", dependency_mode: "wait_for_merge" } } as Config;
  const git = { branchExists: () => true, hasOpenPr: () => true };
  assert.equal(getEffectiveStatus({ id: "a", status: "ready" }, new Map(), config, git), "review");
  assert.equal(getEffectiveStatus({ id: "a", status: "draft" }, new Map(), config, git), "draft");
  assert.equal(getEffectiveStatus({ id: "a", status: "review" }, new Map(), config, git), "review");
  assert.equal(getEffectiveStatus({ id: "a", status: "ready" }, new Map(), config, { branchExists: () => true }), "in_progress");
});

// ---- plan new / show / graph ----
import * as fs from "node:fs";
import { CONFIG, spec } from "../test-repo.js";

function newRepo(): string {
  const root = makeRepo({
    ".specplane/config.yaml": CONFIG.replace(/plans:[\s\S]*$/, "") + "plans:\n  dir: plans\n",
    "specs/features/alpha.md": spec({ id: "feature/alpha", title: "A", status: "draft", author: "user" }),
    "plans/2026-01-01-alpha/PLAN.md": plan("2026-01-01-alpha", "done").replace("feature/x", "feature/alpha"),
    "plans/archive/2025-12-01-old/PLAN.md": plan("2025-12-01-old", "done").replace("feature/x", "feature/alpha"),
  });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  return root;
}

test("plan new: creates draft plan, steps/, HANDOFF.md; validate passes", () => {
  const root = newRepo();
  const r = run(root, "plan", "new", "--id", "2026-02-01-beta", "--title", "Beta plan", "--specs", "feature/alpha", "--depends-on", "2026-01-01-alpha");
  assert.equal(r.code, 0, r.err);
  const dir = path.join(root, "plans/2026-02-01-beta");
  const text = fs.readFileSync(path.join(dir, "PLAN.md"), "utf8");
  assert.match(text, /status: draft/);
  assert.match(text, /depends_on: \["2026-01-01-alpha"\]/);
  assert.match(text, /## Acceptance criteria/);
  assert.ok(fs.statSync(path.join(dir, "steps")).isDirectory());
  assert.equal(fs.readFileSync(path.join(dir, "HANDOFF.md"), "utf8"), "# HANDOFF — 2026-02-01-beta\n");
  assert.equal(run(root, "validate").code, 0, run(root, "validate").out + run(root, "validate").err);
});

test("plan new: existing ID, unknown spec/plan, bad ID, missing flags exit 1", () => {
  const root = newRepo();
  const base = ["plan", "new", "--title", "T", "--specs", "feature/alpha"];
  const dup = run(root, ...base, "--id", "2026-01-01-alpha");
  assert.equal(dup.code, 1);
  assert.match(dup.err, /Plan `2026-01-01-alpha` already exists\. Choose a different slug\./);
  assert.equal(run(root, "plan", "new", "--id", "2026-02-01-b", "--title", "T", "--specs", "feature/nope").code, 1);
  assert.equal(run(root, ...base, "--id", "2026-02-01-b", "--depends-on", "2026-09-09-nope").code, 1);
  assert.equal(run(root, ...base, "--id", "bad").code, 1);
  assert.equal(run(root, ...base).code, 1);
  assert.ok(!fs.existsSync(path.join(root, "plans/2026-02-01-b")));
});

test("plan new: self-dependency is rejected", () => {
  const root = newRepo();
  const r = run(root, "plan", "new", "--id", "2026-02-01-self", "--title", "T", "--specs", "feature/alpha", "--depends-on", "2026-02-01-self");
  assert.equal(r.code, 1);
  assert.ok(!fs.existsSync(path.join(root, "plans/2026-02-01-self")));
});

test("plan new: records validated target and canonical comparison commit; refusals and dry run write nothing", () => {
  const root = newRepo();
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init").status, 0);
  const sha = git("rev-parse", "HEAD").stdout.trim();
  const base = ["plan", "new", "--id", "2026-02-01-target", "--specs", "feature/alpha"];
  const dir = path.join(root, "plans/2026-02-01-target");
  for (const extra of [["--target", "bad branch"], ["--target", "plan/2026-02-01-target"], ["--comparison-base", "missing"], ["--target", "release", "--dry-run"]]) {
    const r = run(root, ...base, ...extra);
    assert.equal(r.code, extra.includes("--dry-run") ? 0 : 1, r.err);
    if (extra.includes("--dry-run")) assert.match(r.out, /^Would create /);
    assert.equal(fs.existsSync(dir), false);
  }
  const r = run(root, ...base, "--target", "release", "--comparison-base", "HEAD");
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(path.join(dir, "PLAN.md"), "utf8");
  assert.match(text, /target_branch: "release"/);
  assert.match(text, /title: "Target"/);
  assert.ok(text.includes(`comparison_base: "${sha}"`));
  assert.ok(fs.existsSync(path.join(dir, "steps/.gitkeep")));
});

test("plan new: an abandoned dependency refuses without creating files", () => {
  const root = newRepo();
  fs.writeFileSync(path.join(root, "plans/2026-01-01-alpha/PLAN.md"), plan("2026-01-01-alpha", "abandoned").replace("feature/x", "feature/alpha"));
  const r = run(root, "plan", "new", "--id", "2026-02-01-target", "--specs", "feature/alpha", "--depends-on", "2026-01-01-alpha");
  assert.equal(r.code, 1);
  assert.match(r.err, /abandoned/);
  assert.equal(fs.existsSync(path.join(root, "plans/2026-02-01-target")), false);
});

test("plan show: active and archived plans; unknown ID exits 1", () => {
  const root = newRepo();
  assert.equal(run(root, "plan", "show", "2026-01-01-alpha").out, fs.readFileSync(path.join(root, "plans/2026-01-01-alpha/PLAN.md"), "utf8"));
  assert.match(run(root, "plan", "show", "2025-12-01-old").out, /id: 2025-12-01-old/);
  const r = run(root, "plan", "show", "2030-01-01-none");
  assert.equal(r.code, 1);
  assert.match(r.err, /not found/);
});

test("plan graph: matches the graph in generated PLANS.md", () => {
  const root = newRepo();
  run(root, "plan", "new", "--id", "2026-02-01-beta", "--title", "B", "--specs", "feature/alpha", "--depends-on", "2026-01-01-alpha");
  const g = run(root, "plan", "graph");
  assert.equal(g.code, 0);
  assert.match(g.out, /^graph TD/);
  assert.match(g.out, /p_2026_01_01_alpha --> p_2026_02_01_beta/);
  assert.equal(run(root, "generate").code, 0);
  const md = fs.readFileSync(path.join(root, "plans/PLANS.md"), "utf8");
  assert.ok(md.includes(g.out.trimEnd()));
});
