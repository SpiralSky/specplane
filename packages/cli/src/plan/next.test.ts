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
const ENV: NodeJS.ProcessEnv = {
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

test("blocked issues reflect the retained checkout HANDOFF, including uncommitted changes", () => {
  const r = repo("worktree", { "01-a.md": step(1, "blocked") }, { [`plans/${ID}/HANDOFF.md`]: "# HANDOFF\n- BLOCKED: old\n" });
  fs.writeFileSync(path.join(r.checkout, `plans/${ID}/HANDOFF.md`), "# HANDOFF\n- BLOCKED: current\n* BLOCKED: second\n");
  const n = next(r.root);
  assert.deepEqual(n.blocked, ["BLOCKED: current", "BLOCKED: second"]);
  assert.equal(n.action, "ask_human");
});

test("remote tree preserves all accepted gap headings and requires a decision", () => {
  const gap = (n: number, kind: string, spacing: string) =>
    `##${spacing}G${n}: case ${n}\n**Kind**: ${kind}\n**Step**: 1\n**Case**: c\n**Resolution**: r\n**Target spec**: feature/xx\n**Status**: open\n`;
  const r = repo("branch", { "01-a.md": step(1, "pending") });
  fs.writeFileSync(path.join(r.root, `plans/${ID}/spec-gaps.md`), gap(1, "proposal", " ") + gap(2, "assumption", "  ") + gap(3, "gap", "\t"));
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "gaps on execution branch");
  const tip = git(r.root, "rev-parse", "HEAD");
  git(r.root, "switch", "-q", "main");
  git(r.root, "update-ref", `refs/remotes/origin/plan/${ID}`, tip);
  git(r.root, "branch", "-D", `plan/${ID}`);
  const n = next(r.root);
  assert.equal(n.checkout, null);
  assert.deepEqual(n.openGaps.map(g => [g.id, g.kind]), [["G1", "proposal"], ["G2", "assumption"], ["G3", "gap"]]);
  assert.equal(n.action, "ask_human");
  assert.match(n.reason, /G1, G2/);
  assert.deepEqual(n.attention.map(a => a.kind), ["gap_decision"]);
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

test("next reads the selected remote-only execution tree and target status without changing refs", () => {
  const r = repo("branch", { "01-a.md": step(1, "pending") });
  fs.writeFileSync(path.join(r.root, `plans/${ID}/steps/01-a.md`), step(1, "blocked", "context:\n  - spec: feature/xx#remote-part\n  - file: remote.txt\n"));
  fs.writeFileSync(path.join(r.root, "specs/features/xx.md"), "---\nid: feature/xx\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n\n## Remote part\n");
  fs.writeFileSync(path.join(r.root, "remote.txt"), "remote");
  fs.writeFileSync(path.join(r.root, `plans/${ID}/spec-gaps.md`), "## G1: Remote decision\n**Kind**: proposal\n**Step**: 1\n**Case**: c\n**Resolution**: r\n**Target spec**: feature/xx\n**Status**: open\n");
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "execution inputs");
  const tip = git(r.root, "rev-parse", "HEAD");
  git(r.root, "switch", "-q", "main");
  git(r.root, "update-ref", `refs/remotes/origin/plan/${ID}`, tip);
  git(r.root, "branch", "-D", `plan/${ID}`);
  const refs = git(r.root, "for-each-ref");
  const n = next(r.root);
  assert.equal(n.checkout, null);
  assert.equal(n.step?.status, "blocked");
  assert.deepEqual(n.context.map(c => c.path), ["specs/features/xx.md", "remote.txt"]);
  assert.deepEqual(n.openGaps.map(g => g.id), ["G1"]);
  assert.equal(n.action, "ask_human");
  assert.deepEqual(n.attention.map(a => a.kind), ["blocked", "gap_decision"]);
  assert.equal(git(r.root, "for-each-ref"), refs);
  const list = sp(r.root, "plan", "list", "--live", "--json");
  assert.equal(list.code, 0, list.err);
  assert.doesNotMatch(list.out, /Attention is unavailable/);
  const plan = path.join(r.root, `plans/${ID}/PLAN.md`);
  fs.writeFileSync(plan, fs.readFileSync(plan, "utf8").replace("status: ready", "status: shelved\nshelved_from: ready"));
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "shelve target");
  assert.equal(next(r.root).effectiveStatus, "shelved");
  assert.equal(next(r.root).action, "none");
  git(r.root, "switch", "-q", "-c", "other");
  git(r.root, "update-ref", "-d", "refs/heads/main");
  assert.notEqual(sp(r.root, "plan", "next", ID, "--json").code, 0);
});

test("unstarted plan reads the selected target snapshot even if absent from the invoking checkout", () => {
  const r = repo("branch", { "01-a.md": step(1, "pending") });
  git(r.root, "switch", "-q", "main");
  git(r.root, "branch", "-D", `plan/${ID}`);
  git(r.root, "switch", "-q", "-c", "other");
  fs.rmSync(path.join(r.root, "plans", ID), { recursive: true });
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "remove invoking copy");
  const n = next(r.root);
  assert.equal(n.step?.number, 1);
  assert.equal(n.effectiveStatus, "ready");
  assert.equal(n.action, "none");
});

test("target shelving refuses forced recording in a retained checkout", () => {
  const r = repo("worktree", { "01-a.md": step(1, "done") });
  const plan = path.join(r.root, `plans/${ID}/PLAN.md`);
  fs.writeFileSync(plan, fs.readFileSync(plan, "utf8").replace("status: ready", "status: shelved\nshelved_from: ready"));
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "shelve target");
  const before = git(r.checkout, "rev-parse", "HEAD");
  const result = sp(r.checkout, "plan", "step-done", ID, "--step", "1", "--outcome", "done", "--summary", "rerun", "--force", "--reason", "verify");
  assert.notEqual(result.code, 0);
  assert.match(result.err, /shelved/i);
  assert.equal(git(r.checkout, "rev-parse", "HEAD"), before);
  assert.equal(git(r.checkout, "status", "--porcelain"), "");
});

test("target dependencies block an open PR and PR lookup uses the recorded target", () => {
  const r = repo("worktree", { "01-a.md": step(1, "pending") });
  const dep = "2026-01-01-dep";
  const plan = path.join(r.root, `plans/${ID}/PLAN.md`);
  fs.writeFileSync(plan, fs.readFileSync(plan, "utf8").replace("specs: [feature/xx]", `specs: [feature/xx]\ndepends_on: [${dep}]`));
  const depdir = path.join(r.root, "plans", dep); fs.mkdirSync(depdir, { recursive: true });
  const depfile = path.join(depdir, "PLAN.md");
  fs.writeFileSync(depfile, `---\nid: ${dep}\ntitle: Dep\nstatus: ready\nspecs: [feature/xx]\n---\n# Dep\n`);
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "add target dependency");
  git(r.root, "remote", "add", "origin", "https://github.com/example/disposable.git");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-forge-"));
  const log = path.join(bin, "calls");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = '--version' ]; then echo fake; else echo '[{"url":"https://example.invalid/pr"}]'; fi\n`, { mode: 0o755 });
  const oldPath = ENV.PATH; ENV.PATH = `${bin}:${oldPath}`;
  try {
    assert.equal(next(r.root).effectiveStatus, "blocked");
    fs.writeFileSync(depfile, fs.readFileSync(depfile, "utf8").replace("status: ready", "status: done"));
    git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "complete dependency");
    assert.equal(next(r.root).effectiveStatus, "review");
    assert.match(fs.readFileSync(log, "utf8"), /pr list .*--base main/);
  } finally { ENV.PATH = oldPath; fs.rmSync(bin, { recursive: true, force: true }); }
});

test("non-default target supplies status and forge while selected tree supplies context paths", () => {
  const r = repo("worktree", { "01-a.md": step(1, "pending", "context:\n  - spec: feature/xx#selected\n  - file: selected.txt\n  - decision: decision/0001\n  - decision: decision/0002\n") });
  git(r.root, "switch", "-q", "-c", "release");
  const config = path.join(r.root, ".specplane/config.yaml");
  let cfg = fs.readFileSync(config, "utf8").replace("  require_approved_specs: none\n", "  require_approved_specs: none\n  forge: github\n");
  fs.writeFileSync(config, cfg);
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "target forge");
  const branchPlan = path.join(r.checkout, `plans/${ID}/PLAN.md`);
  fs.writeFileSync(branchPlan, fs.readFileSync(branchPlan, "utf8").replace(/target_branch: "main"/g, 'target_branch: "release"'));
  const branchConfig = path.join(r.checkout, ".specplane/config.yaml");
  fs.writeFileSync(branchConfig, fs.readFileSync(branchConfig, "utf8").replace("  require_approved_specs: none\n", "  require_approved_specs: none\n  forge: none\n"));
  fs.writeFileSync(path.join(r.checkout, "specs/features/xx.md"), "---\nid: feature/xx\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n\n## Selected\n");
  fs.writeFileSync(path.join(r.checkout, "selected.txt"), "selected");
  fs.mkdirSync(path.join(r.checkout, "docs/decisions"), { recursive: true });
  fs.writeFileSync(path.join(r.checkout, "docs/decisions/0001-selected.md"), "---\nid: decision/0001\ntitle: Selected\ndate: 2026-01-01\nstatus: accepted\nsuperseded_by: ''\nrelated_specs: []\n---\n# Selected\n");
  fs.writeFileSync(path.join(r.checkout, "docs/decisions/0002-broken.md"), "not frontmatter\n");
  git(r.checkout, "add", "-A"); git(r.checkout, "commit", "-q", "-m", "selected inputs");
  const tip = git(r.checkout, "rev-parse", "HEAD");
  git(r.root, "worktree", "remove", r.checkout);
  git(r.root, "update-ref", `refs/remotes/origin/plan/${ID}`, tip);
  git(r.root, "branch", "-D", `plan/${ID}`);
  git(r.root, "switch", "-q", "main");
  fs.writeFileSync(config, fs.readFileSync(config, "utf8").replace("  require_approved_specs: none\n", "  require_approved_specs: none\n  forge: none\n"));
  git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "invoking config");
  git(r.root, "remote", "add", "origin", "https://github.com/example/disposable.git");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-forge-"));
  const log = path.join(bin, "calls");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = '--version' ]; then echo fake; else echo '[{"url":"https://example.invalid/pr"}]'; fi\n`, { mode: 0o755 });
  const oldPath = ENV.PATH; ENV.PATH = `${bin}:${oldPath}`;
  try {
    let n = next(r.root);
    assert.equal(n.checkout, null);
    assert.equal(n.effectiveStatus, "review");
    assert.deepEqual(n.context.map(c => c.path), ["specs/features/xx.md", "selected.txt", "docs/decisions/0001-selected.md", null]);
    assert.equal(n.warnings.length, 1);
    assert.match(n.warnings[0], /decision\/0002/);
    assert.match(fs.readFileSync(log, "utf8"), /pr list .*--base release/);
    git(r.root, "switch", "-q", "release");
    cfg = fs.readFileSync(config, "utf8").replace("  forge: github\n", "  forge: github\n  status_source: frontmatter\n");
    fs.writeFileSync(config, cfg); git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "frontmatter status");
    n = next(r.root);
    assert.equal(n.effectiveStatus, "ready");
    assert.equal(n.action, "spawn_step");
    const targetPlan = path.join(r.root, `plans/${ID}/PLAN.md`);
    fs.writeFileSync(targetPlan, fs.readFileSync(targetPlan, "utf8").replace("status: ready", "status: abandoned"));
    git(r.root, "add", "-A"); git(r.root, "commit", "-q", "-m", "abandon target");
    assert.equal(next(r.root).effectiveStatus, "abandoned");
    assert.equal(next(r.root).action, "none");
    git(r.root, "switch", "-q", "main"); git(r.root, "branch", "-D", "release");
    assert.notEqual(sp(r.root, "plan", "next", ID, "--json").code, 0);
  } finally { ENV.PATH = oldPath; fs.rmSync(bin, { recursive: true, force: true }); }
});
