import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";
import { computeNext, type NextInput, type PlanNext } from "./next.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SPECPLANE_AGENT: "", SPECPLANE_SESSION: "",
};
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const sp = (cwd: string, ...a: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: "utf8", env: ENV, input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const ID = "2026-01-01-alpha";
const step = (n: number, status: string, context = "") =>
  `---\nplan: ${ID}\nstep: ${n}\ntitle: "S${n}"\nstatus: ${status}\n${context}---\n# S${n}\n`;

function repo(backend: string, steps: Record<string, string>, extra: Record<string, string> = {}) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-next-"));
  const files: Record<string, string> = {
    ".specplane/config.yaml": `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  require_approved_specs: none\nexecution:\n  backend: ${backend}\n  worktree_dir: ${wt}\n`,
    "specs/features/xx.md": "---\nid: feature/xx\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n\n## Part\n\ntext\n",
    [`plans/${ID}/PLAN.md`]: `---\nid: ${ID}\ntitle: "Alpha"\nstatus: ready\nspecs: [feature/xx]\n---\n# P\n`,
    [`plans/${ID}/HANDOFF.md`]: `# HANDOFF\n`,
    ...Object.fromEntries(Object.entries(steps).map(([f, c]) => [`plans/${ID}/steps/${f}`, c])),
    ...extra,
  };
  const root = makeRepo(files);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const res = sp(root, "plan", "start", ID);
  assert.equal(res.code, 0, res.err);
  const checkout = backend === "worktree" ? path.join(wt, path.basename(root), ID) : root;
  return { root, checkout };
}
const next = (cwd: string): PlanNext => {
  const r = sp(cwd, "plan", "next", ID, "--json");
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out) as PlanNext;
};

test("earlier blocked step wins over later pending step; missing context file is a warning", () => {
  const r = repo("worktree", {
    "01-a.md": step(1, "done"),
    "02-b.md": step(2, "blocked", "context:\n  - spec: feature/xx#part\n  - spec: feature/missing\n  - file: nope.txt\n"),
    "03-c.md": step(3, "pending"),
  });
  const n = next(r.checkout);
  assert.equal(n.step?.number, 2);
  assert.equal(n.step?.file, `plans/${ID}/steps/02-b.md`);
  assert.equal(n.action, "ask_human");
  assert.deepEqual(n.attention.map((a) => a.kind), ["blocked"]);
  assert.equal(n.checkout, fs.realpathSync(r.checkout));
  assert.equal(n.context[0].path, "specs/features/xx.md", JSON.stringify(n.warnings));
  assert.equal(n.context[0].anchor, "part");
  assert.equal(n.context[1].path, null);
  assert.equal(n.warnings.length, 2);
});

test("earlier pending step runs before a later step that is already done", () => {
  const r = repo("worktree", { "01-a.md": step(1, "pending"), "02-b.md": step(2, "done") });
  const n = next(r.checkout);
  assert.equal(n.step?.number, 1);
  assert.equal(n.action, "spawn_step");
  assert.match(n.reason, /before step 2/);
});

test("checkout is null on the branch and external backends unless the branch is checked out", () => {
  const ext = repo("external", { "01-a.md": step(1, "pending") });
  assert.equal(next(ext.root).checkout, null);
  const br = repo("branch", { "01-a.md": step(1, "pending") });
  assert.equal(next(br.root).checkout, fs.realpathSync(br.root));
  git(br.root, "switch", "-q", "main");
  assert.equal(next(br.root).checkout, null);
});

test("open proposal gap takes precedence over spawn_step; finish_ready when all done", () => {
  const gap = (n: number, kind: string) =>
    `## G${n}: case ${n}\n**Kind**: ${kind}\n**Step**: 1\n**Case**: c\n**Resolution**: r\n**Target spec**: feature/xx\n**Status**: open\n`;
  const r = repo("worktree", { "01-a.md": step(1, "pending") }, { [`plans/${ID}/spec-gaps.md`]: `${gap(1, "proposal")}\n${gap(2, "assumption")}` });
  const n = next(r.checkout);
  assert.equal(n.action, "ask_human");
  assert.deepEqual(n.attention.map((a) => a.kind), ["gap_decision"]);
  assert.equal(n.openGaps.length, 2);

  const done = repo("worktree", { "01-a.md": step(1, "done") });
  const d = next(done.checkout);
  assert.equal(d.step, null);
  assert.equal(d.action, "finish");
  assert.deepEqual(d.attention.map((a) => a.kind), ["finish_ready"]);
});

test("dirty checkout asks a human", () => {
  const r = repo("worktree", { "01-a.md": step(1, "pending") });
  fs.writeFileSync(path.join(r.checkout, "scratch.txt"), "x");
  const n = next(r.checkout);
  assert.equal(n.action, "ask_human");
  assert.deepEqual(n.attention.map((a) => a.kind), ["dirty"]);
});

test("attention is deduplicated by kind", () => {
  const base: NextInput = {
    plan: ID, title: "t", effectiveStatus: "in_progress", started: true,
    steps: [{ number: 1, title: "a", status: "blocked", file: "f" }],
    context: [], checkout: "/c", blockedIssues: ["BLOCKED: x"], warnings: [],
    gaps: [1, 2, 3].map((n) => ({ n, caseTitle: "c", kind: "proposal", step: 1, case: "", resolution: "", targets: [], status: "open", line: 1 })),
    restackBase: "other", diverged: true, dirty: true,
  };
  const n = computeNext(base);
  const kinds = n.attention.map((a) => a.kind);
  assert.equal(new Set(kinds).size, kinds.length);
  assert.deepEqual([...kinds].sort(), ["blocked", "dirty", "diverged", "gap_decision", "restack"]);
  assert.equal(n.action, "ask_human");
  assert.deepEqual(n.blocked, ["BLOCKED: x"]);
  const restack = computeNext({ ...base, steps: [], diverged: false, dirty: false, gaps: [] });
  assert.equal(restack.action, "restack");
});

test("plan next has no side effects and prints only JSON with --json", () => {
  const r = repo("worktree", { "01-a.md": step(1, "pending") });
  const snap = () => ({
    status: git(r.checkout, "status", "--porcelain"),
    head: git(r.checkout, "rev-parse", "HEAD"),
    refs: git(r.root, "for-each-ref"),
    worktrees: git(r.root, "worktree", "list"),
    mainStatus: git(r.root, "status", "--porcelain"),
  });
  const before = snap();
  const a = sp(r.checkout, "plan", "next", ID, "--json");
  const b = sp(r.root, "plan", "next", ID, "--json");
  assert.equal(a.out, b.out);
  JSON.parse(a.out);
  assert.deepEqual(snap(), before);
  const human = sp(r.checkout, "plan", "next", ID);
  assert.match(human.out, /Action: spawn_step/);
  assert.deepEqual(snap(), before);
});
