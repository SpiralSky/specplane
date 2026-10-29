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

test("getEffectiveStatus: forge hook derives review; non-ready statuses unchanged", () => {
  const config = { plans: { status_source: "git", dependency_mode: "wait_for_merge" } } as Config;
  const git = { branchExists: () => true, hasOpenPr: () => true };
  assert.equal(getEffectiveStatus({ id: "a", status: "ready" }, new Map(), config, git), "review");
  assert.equal(getEffectiveStatus({ id: "a", status: "draft" }, new Map(), config, git), "draft");
  assert.equal(getEffectiveStatus({ id: "a", status: "review" }, new Map(), config, git), "review");
  assert.equal(getEffectiveStatus({ id: "a", status: "ready" }, new Map(), config, { branchExists: () => true }), "in_progress");
});
