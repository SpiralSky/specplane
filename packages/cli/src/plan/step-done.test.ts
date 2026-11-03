import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
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
const spRaw = (cwd: string, env: Record<string, string>, ...a: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: "utf8", env: { ...ENV, ...env }, input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const digest = (s: Buffer | string) => createHash('sha256').update(s).digest('hex');
function recordingSet(root: string, changes: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-reviewed-set-'));
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({ protocol: 1, head: head(root), branch: git(root, 'branch', '--show-current'), changes: changes.map(change => {
    const colon = change.indexOf(':'), relative = change.slice(0, colon).trim();
    const before = spawnSync('git', ['show', `HEAD:${relative}`], { cwd: root, env: ENV });
    return { path: relative, purpose: change.slice(colon + 1).trim(), beforeDigest: before.status === 0 ? digest(before.stdout) : 'missing', afterDigest: fs.existsSync(path.join(root, relative)) ? digest(fs.readFileSync(path.join(root, relative))) : 'missing' };
  }) }));
  return file;
}
const sp = (root: string, env: Record<string, string>, ...args: string[]) => {
  const file = recordingSet(root, args.flatMap((arg, i) => arg === '--changed' ? [args[i + 1]] : []));
  try { return spRaw(root, env, ...args, '--recording-set', file); }
  finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
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
  const planFile = path.join(root, PLAN, 'PLAN.md');
  fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('\nspecs:', `\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${git(root, 'rev-parse', 'HEAD')}\nspecs:`));
  git(root, 'add', '--', `${PLAN}/PLAN.md`);
  git(root, 'commit', '-q', '-m', 'bind fixture execution');
  git(root, "switch", "-q", "-c", `plan/${ID}`);
  return root;
}
const head = (root: string) => git(root, "rev-parse", "HEAD");
const clean = (root: string) => git(root, "status", "--porcelain");

test("appends a §4.1 section, sets status, commits with ordered trailers", () => {
  const root = repo({ "01-a.md": step(1, "pending"), "02-b.md": step(2, "pending") }, "# HANDOFF\n", { [`${PLAN}/spec-gaps.md`]: GAPS });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'new module\n');
  fs.writeFileSync(path.join(root, 'src/b.ts'), 'wire it\n');
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

test("forced completed-step rerun records reason without deleting earlier history", () => {
  const root = repo({ "01-a.md": step(1, "done"), "02-b.md": step(2, "done") }, "# HANDOFF\n\n## Step 01: Step 1\n**Outcome**: done\n\n## Step 02: Step 2\n**Outcome**: done\n");
  refused(root,["--step","1","--outcome","done","--summary","redo","--force"],/already/);
  const r=sp(root,{},"plan","step-done",ID,"--step","1","--outcome","done","--summary","rerun","--force","--reason","verify regression");
  assert.equal(r.code,0,r.err);
  assert.match(git(root,"log","-1","--format=%B"),/Specplane-Force-Reason: verify regression/);
  const h=fs.readFileSync(path.join(root,PLAN,"HANDOFF.md"),"utf8");
  assert.equal((h.match(/## Step 01/g)??[]).length,2);
  assert.match(h,/Forced rerun: verify regression/);
  assert.match(fs.readFileSync(path.join(root,PLAN,"PLAN.md"),"utf8"),/status: in_progress/);
});

test('records reviewed additions and deletions outside the plan folder, with full staging', () => {
  const root = repo({ '01-a.md': step(1, 'pending') }, '# HANDOFF\n', { 'old.txt': 'remove\n' });
  fs.unlinkSync(path.join(root, 'old.txt'));
  fs.writeFileSync(path.join(root, 'new.txt'), 'new\n');
  git(root, 'add', '--', 'old.txt', 'new.txt');
  const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'replace file', '--changed', 'old.txt:remove', '--changed', 'new.txt:add');
  assert.equal(result.code, 0, result.err);
  assert.equal(clean(root), '');
  assert.deepEqual(git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), ['new.txt', 'old.txt', `${PLAN}/HANDOFF.md`, `${PLAN}/steps/01-a.md`].sort());
});

test('requires explicit manifest; status-only records use an empty reviewed set', () => {
  const root = repo({ '01-a.md': step(1, 'pending') });
  const before = head(root);
  const missing = spRaw(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'status');
  assert.equal(missing.code, 1); assert.match(missing.err, /--recording-set/);
  assert.equal(head(root), before); assert.equal(clean(root), '');
  const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'status');
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(git(root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), [`${PLAN}/HANDOFF.md`, `${PLAN}/steps/01-a.md`].sort());
});

test('unreviewed plan-folder files and core progress edits refuse without staging', () => {
  const root = repo({ '01-a.md': step(1, 'pending') });
  const unexpected = path.join(root, PLAN, 'notes.md');
  fs.writeFileSync(unexpected, 'unrelated');
  refused(root, ['--outcome', 'done', '--summary', 'x'], /unreviewed change/);
  fs.unlinkSync(unexpected);
  fs.appendFileSync(path.join(root, PLAN, 'HANDOFF.md'), 'edited');
  refused(root, ['--outcome', 'done', '--summary', 'x'], /core progress edit/);
});

test('partial staging refuses and retains exact caller index and working bytes', () => {
  const root = repo({ '01-a.md': step(1, 'pending') }, '# HANDOFF\n', { 'source.txt': 'base' });
  fs.writeFileSync(path.join(root, 'source.txt'), 'staged'); git(root, 'add', 'source.txt');
  fs.writeFileSync(path.join(root, 'source.txt'), 'working');
  clean(root);
  const index = fs.readFileSync(path.join(root, '.git/index'));
  refused(root, ['--outcome', 'done', '--summary', 'x', '--changed', 'source.txt:edit'], /partial staging/);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
  assert.equal(fs.readFileSync(path.join(root, 'source.txt'), 'utf8'), 'working');
});

test('early refusal does not refresh index bytes after a tracked mtime changes', () => {
  const root = repo({ '01-a.md': step(1, 'pending') }, '# HANDOFF\n', { 'source.txt': 'same bytes' });
  const index = fs.readFileSync(path.join(root, '.git/index'));
  fs.utimesSync(path.join(root, 'source.txt'), new Date(), new Date(Date.now() + 30_000));
  const result = spRaw(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'x');
  assert.equal(result.code, 1, result.err); assert.match(result.err, /--recording-set/);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
});

test('failed commit preserves exact mixed staging, caller edits and generated preimages', () => {
  const root = repo({ '01-a.md': step(1, 'pending') }, '# HANDOFF\n', { 'staged.txt': 'before', 'unstaged.txt': 'before' });
  fs.writeFileSync(path.join(root, 'staged.txt'), 'after'); git(root, 'add', 'staged.txt');
  fs.writeFileSync(path.join(root, 'unstaged.txt'), 'after');
  clean(root);
  const index = fs.readFileSync(path.join(root, '.git/index'));
  fs.writeFileSync(path.join(root, '.git/hooks/commit-msg'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'x', '--changed', 'staged.txt:edit', '--changed', 'unstaged.txt:edit');
  assert.equal(result.code, 2, result.err);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git/index')), index);
  assert.equal(fs.readFileSync(path.join(root, PLAN, 'HANDOFF.md'), 'utf8'), '# HANDOFF\n');
  assert.equal(fs.readFileSync(path.join(root, PLAN, 'steps/01-a.md'), 'utf8'), step(1, 'pending'));
  assert.equal(fs.readFileSync(path.join(root, 'staged.txt'), 'utf8'), 'after');
  assert.equal(fs.readFileSync(path.join(root, 'unstaged.txt'), 'utf8'), 'after');
  assert.equal(fs.existsSync(path.join(root, '.git/index.lock')), false);
});

test('failed hook editing generated content reports recovery and preserves the edit', () => {
  const root = repo({ '01-a.md': step(1, 'pending') });
  fs.writeFileSync(path.join(root, '.git/hooks/commit-msg'), `#!/bin/sh\nprintf 'concurrent edit\\n' > '${PLAN}/HANDOFF.md'\nexit 1\n`, { mode: 0o755 });
  const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'x');
  assert.equal(result.code, 1, result.err); assert.match(result.err, /recovery required/);
  assert.equal(fs.readFileSync(path.join(root, PLAN, 'HANDOFF.md'), 'utf8'), 'concurrent edit\n');
  assert.ok(fs.readdirSync(path.join(root, '.git')).some(file => /^specplane-step-.*\.index$/.test(file)));
});

test('failed hook swapping a generated parent for a symlink never rolls back outside the checkout', () => {
  const root = repo({ '01-a.md': step(1, 'pending') });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-rollback-outside-'));
  try {
    const copied = path.join(outside, 'copied');
    const original = path.join(outside, 'original');
    fs.writeFileSync(path.join(root, '.git/hooks/commit-msg'),
      `#!/bin/sh\nset -e\ncp -R '${PLAN}' '${copied}'\nmv '${PLAN}' '${original}'\nln -s '${copied}' '${PLAN}'\nexit 1\n`, { mode: 0o755 });
    const before = head(root);
    const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'x');
    assert.equal(result.code, 1, result.err); assert.match(result.err, /recovery required/);
    assert.equal(head(root), before);
    assert.equal(fs.lstatSync(path.join(root, PLAN)).isSymbolicLink(), true);
    // Both copies retain the exact generated after-state. Restoring pending or
    // removing the appended section here would mutate the outside directory.
    assert.equal(fs.readFileSync(path.join(copied, 'steps/01-a.md'), 'utf8'), step(1, 'done'));
    assert.match(fs.readFileSync(path.join(copied, 'HANDOFF.md'), 'utf8'), /\*\*Outcome\*\*: done/);
    assert.deepEqual(fs.readFileSync(path.join(copied, 'HANDOFF.md')), fs.readFileSync(path.join(original, 'HANDOFF.md')));
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

for (const mutation of ['strip-trailers', 'duplicate-trailer', 'switch-branch'] as const) {
  test(`committed ${mutation} mutation requires recovery instead of recording success`, () => {
    const root = repo({ '01-a.md': step(1, 'pending') });
    const hook = mutation === 'switch-branch' ? 'post-commit' : 'commit-msg';
    const script = mutation === 'strip-trailers' ? 'sed -i "/^Specplane-/d" "$1"' :
      mutation === 'duplicate-trailer' ? `printf 'specplane-plan: ${ID}\\n' >> "$1"` :
      'git branch hook-branch HEAD\ngit symbolic-ref HEAD refs/heads/hook-branch';
    fs.writeFileSync(path.join(root, '.git/hooks', hook), `#!/bin/sh\nset -e\n${script}\n`, { mode: 0o755 });
    const before = head(root);
    const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'x');
    assert.equal(result.code, 1, result.err); assert.match(result.err, /recovery required.*committed branch or core trailers/s);
    assert.notEqual(head(root), before, 'the existing commit must remain available for recovery');
    assert.equal(fs.readFileSync(path.join(root, PLAN, 'steps/01-a.md'), 'utf8'), step(1, 'done'));
    assert.match(fs.readFileSync(path.join(root, PLAN, 'HANDOFF.md'), 'utf8'), /\*\*Outcome\*\*: done/);
    assert.ok(fs.readdirSync(path.join(root, '.git')).some(file => /^specplane-step-.*\.index$/.test(file)));
  });
}

test('force reasons require an explicit step and nonblank original single-line text', () => {
  for (const args of [ ['--force', '--reason', 'why'], ['--step', '1', '--force', '--reason', ' '], ['--step', '1', '--force', '--reason', 'why\n'], ['--step', '1', '--reason', 'why'] ]) {
    const root = repo({ '01-a.md': step(1, 'done'), '02-b.md': step(2, 'pending') });
    refused(root, ['--outcome', 'done', '--summary', 'x', ...args], /force reason/);
  }
});

for (const kind of ['symlink', 'dangling', 'hardlink'] as const) {
  test(`core-owned HANDOFF ${kind} refuses before any write`, () => {
    const root = repo({ '01-a.md': step(1, 'pending') });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specplane-progress-outside-'));
    const original = path.join(outside, 'handoff');
    try {
      if (kind !== 'dangling') fs.writeFileSync(original, '# external handoff\n');
      const file = path.join(root, PLAN, 'HANDOFF.md');
      fs.unlinkSync(file);
      if (kind === 'hardlink') fs.linkSync(original, file); else fs.symlinkSync(original, file);
      const before = head(root);
      const result = sp(root, {}, 'plan', 'step-done', ID, '--outcome', 'done', '--summary', 'x');
      assert.equal(result.code, 1, result.err); assert.match(result.err, /links and nonregular/);
      assert.equal(head(root), before);
      if (kind !== 'dangling') assert.equal(fs.readFileSync(original, 'utf8'), '# external handoff\n');
      else assert.equal(fs.existsSync(original), false);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
}
