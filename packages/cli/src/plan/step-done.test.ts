import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";
import { handoffOutcomes } from "./validate.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SPECPLANE_AGENT: "claude-code", SPECPLANE_SESSION: "",
};
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const sp = (cwd: string, env: Record<string, string>, ...a: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: "utf8", env: { ...ENV, ...env }, input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const ID = "2026-01-01-alpha";
const PLAN = `plans/${ID}`;
const step = (n: number, status: string) => `---\nplan: ${ID}\nstep: ${n}\ntitle: "Step ${n}"\nstatus: ${status}\n---\n# S${n}\n`;
const GAPS = `# Spec gaps\n\n## G1: first case\n**Kind**: assumption\n**Step**: 1\n**Case**: c\n**Resolution**: r\n**Target spec**: feature/xx\n**Status**: open\n`;

function repo(steps: Record<string, string>, handoff = "# HANDOFF\n", extra: Record<string, string> = {}) {
  const root = makeRepo({
    ".specplane/config.yaml": "spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  require_approved_specs: none\nexecution:\n  backend: branch\n",
    "specs/features/xx.md": "---\nid: feature/xx\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n\n## Part\n\ntext\n",
    [`${PLAN}/PLAN.md`]: `---\nid: ${ID}\ntitle: "Alpha"\nstatus: in_progress\nspecs: [feature/xx]\n---\n# P\n`,
    [`${PLAN}/HANDOFF.md`]: handoff,
    ...Object.fromEntries(Object.entries(steps).map(([f, c]) => [`${PLAN}/steps/${f}`, c])),
    ...extra,
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}
const head = (root: string) => git(root, "rev-parse", "HEAD");
const clean = (root: string) => git(root, "status", "--porcelain");

test("appends a §4.1 section, sets status, commits with ordered trailers", () => {
  const root = repo({ "01-a.md": step(1, "pending"), "02-b.md": step(2, "pending") }, "# HANDOFF\n", { [`${PLAN}/spec-gaps.md`]: GAPS });
  const r = sp(root, {}, "plan", "step-done", ID, "--outcome", "done", "--summary", "add thing", "--type", "feat",
    "--changed", "src/a.ts:new module", "--changed", "src/b.ts:wire it", "--gap", "G1", "--next-knows", "Use A.",
    "--trailer", "Co-Authored-By: Bot <b@x>");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Committed [0-9a-f]+/);
  const text = fs.readFileSync(path.join(root, PLAN, "HANDOFF.md"), "utf8");
  assert.match(text, /\n## Step 01: Step 1\n\n\*\*Date\*\*: \d{4}-\d{2}-\d{2}\n\*\*Outcome\*\*: done\n\n### What changed\n\n- `src\/a.ts`: new module\n- `src\/b.ts`: wire it\n\n### Deviations from the plan\n\nNone\.\n\n### Gaps found in specs\n\n- G1 \(assumption\): first case\. See `spec-gaps.md`\.\n\n### Open issues\n\nNone\.\n\n### What the next step must know\n\nUse A\.\n$/);
  assert.match(fs.readFileSync(path.join(root, PLAN, "steps/01-a.md"), "utf8"), /status: done/);
  assert.match(fs.readFileSync(path.join(root, PLAN, "steps/02-b.md"), "utf8"), /status: pending/);
  assert.deepEqual(handoffOutcomes(path.join(root, PLAN, "HANDOFF.md")).get(1), ["done"]);
  const msg = git(root, "log", "-1", "--format=%B");
  assert.equal(msg, [
    "feat(alpha): add thing", "", "- `src/a.ts`: new module\n- `src/b.ts`: wire it", "",
    ["Specplane-Workflow: step", `Specplane-Plan: ${ID}`, "Specplane-Step: 01", "Specplane-Agent: claude-code", "Co-Authored-By: Bot <b@x>"].join("\n"),
  ].join("\n"));
  assert.equal(clean(root), "");
});

test("Specplane-Session is written when set and the next step is picked by number", () => {
  const root = repo({ "01-a.md": step(1, "done"), "02-b.md": step(2, "pending") }, "# HANDOFF\n\n## Step 01: Step 1\n\n**Date**: 2026-01-01\n**Outcome**: done\n");
  const r = sp(root, { SPECPLANE_SESSION: "sess-1" }, "plan", "step-done", ID, "--outcome", "done", "--summary", "x");
  assert.equal(r.code, 0, r.err);
  assert.match(git(root, "log", "-1", "--format=%B"), /Specplane-Step: 02\nSpecplane-Agent: claude-code\nSpecplane-Session: sess-1$/);
  assert.match(fs.readFileSync(path.join(root, PLAN, "steps/02-b.md"), "utf8"), /status: done/);
});

function refused(root: string, args: string[], pattern: RegExp) {
  const h = head(root);
  const snapshot = git(root, "status", "--porcelain");
  const r = sp(root, {}, "plan", "step-done", ID, ...args);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, pattern);
  assert.equal(head(root), h);
  assert.equal(git(root, "status", "--porcelain"), snapshot, "no writes");
}

test("refuses an already done step", () => {
  const root = repo({ "01-a.md": step(1, "done") });
  refused(root, ["--step", "1", "--outcome", "done", "--summary", "x"], /already `done`/);
});

test("refuses done on a blocked step without --force; --force allows it and keeps both sections", () => {
  const root = repo({ "01-a.md": step(1, "blocked") }, "# HANDOFF\n\n## Step 01: Step 1\n\n**Date**: 2026-01-01\n**Outcome**: blocked\n");
  refused(root, ["--outcome", "done", "--summary", "x"], /blocked.*--force/);
  const r = sp(root, {}, "plan", "step-done", ID, "--outcome", "done", "--summary", "x", "--force");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(handoffOutcomes(path.join(root, PLAN, "HANDOFF.md")).get(1), ["blocked", "done"]);
});

test("refuses blocked without a BLOCKED: open issue; accepts one", () => {
  const root = repo({ "01-a.md": step(1, "pending") });
  refused(root, ["--outcome", "blocked", "--summary", "x"], /BLOCKED:/);
  refused(root, ["--outcome", "blocked", "--summary", "x", "--open-issue", "something"], /BLOCKED:/);
  const r = sp(root, {}, "plan", "step-done", ID, "--outcome", "blocked", "--summary", "stop", "--open-issue", "BLOCKED: specs contradict");
  assert.equal(r.code, 0, r.err);
  assert.match(fs.readFileSync(path.join(root, PLAN, "steps/01-a.md"), "utf8"), /status: blocked/);
  assert.match(fs.readFileSync(path.join(root, PLAN, "HANDOFF.md"), "utf8"), /### Open issues\n\n- BLOCKED: specs contradict\n/);
});

test("refuses a --gap ID with no spec-gaps.md entry", () => {
  const root = repo({ "01-a.md": step(1, "pending") }, "# HANDOFF\n", { [`${PLAN}/spec-gaps.md`]: GAPS });
  refused(root, ["--outcome", "done", "--summary", "x", "--gap", "G2"], /no entry `G2`/);
  const none = repo({ "01-a.md": step(1, "pending") });
  refused(none, ["--outcome", "done", "--summary", "x", "--gap", "G1"], /does not exist/);
});

test("refuses when HANDOFF.md already has a later step section", () => {
  const root = repo({ "01-a.md": step(1, "pending"), "02-b.md": step(2, "done") }, "# HANDOFF\n\n## Step 02: Step 2\n\n**Date**: 2026-01-01\n**Outcome**: done\n");
  refused(root, ["--step", "1", "--outcome", "done", "--summary", "x"], /step 02, after step 01/);
});

test("skipped writes None. for changes and needs a deviation", () => {
  const root = repo({ "01-a.md": step(1, "pending") });
  refused(root, ["--outcome", "skipped", "--summary", "x"], /--deviation/);
  const r = sp(root, {}, "plan", "step-done", ID, "--outcome", "skipped", "--summary", "skip", "--deviation", "Not needed any more.");
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(path.join(root, PLAN, "HANDOFF.md"), "utf8");
  assert.match(text, /\*\*Outcome\*\*: skipped\n\n### What changed\n\nNone\.\n\n### Deviations from the plan\n\nNot needed any more\.\n/);
});

test("a failed commit restores the files", () => {
  const root = repo({ "01-a.md": step(1, "pending") });
  fs.mkdirSync(path.join(root, ".git/hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/hooks/commit-msg"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const r = sp(root, {}, "plan", "step-done", ID, "--outcome", "done", "--summary", "x");
  assert.equal(r.code, 2);
  assert.equal(clean(root), "");
});

test("a subject over 72 characters is refused before any write", () => {
  const root = repo({ "01-a.md": step(1, "pending") });
  refused(root, ["--outcome", "done", "--summary", "x".repeat(80)], /72/);
});
