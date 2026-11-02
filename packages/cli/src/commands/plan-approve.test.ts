import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";
import { withApprovalReadTree } from "./approval-read-tree.js";
import { run as gitRun } from "../git/exec.js";
import { GitError } from "../errors.js";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  SPECPLANE_AGENT: "", SPECPLANE_SESSION: "",
};

const git = (cwd: string, ...a: string[]): string => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", env: ENV });
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (root: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const count = (root: string) => Number(git(root, "rev-list", "--count", "HEAD"));
const short = (root: string, ref: string) => git(root, "rev-parse", "--short=7", ref);
const subject = (root: string, ref: string) => git(root, "log", "-1", "--format=%s", ref);
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const fm = (id: string, status = "approved") => spec({ id, title: `T ${id}`, status, author: "user" });
const plan = (id: string, status = "draft", specs = "[feature/base]", extra = "") =>
  `---\nid: ${id}\ntitle: "T ${id}"\nstatus: ${status}\nspecs: ${specs}\n${extra}---\n# P\n`;

/** Temp git repository with the base/ext config and the given files, all committed. */
function repo(files: Record<string, string>): string {
  const root = makeRepo({ ".specplane/config.yaml": CONFIG, ...files });
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const ID = "2026-01-01-alpha";

test("plan approve: sets ready, regenerates PLANS.md in the same commit (G2)", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID),
  });
  const before = count(root);
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `approved ${ID} ${short(root, "HEAD")}\n`);
  assert.equal(count(root), before + 1);
  assert.equal(subject(root, "HEAD"), `docs(${ID}): approve plan`);
  assert.match(git(root, "log", "-1", "--format=%B"), /^Specplane-Workflow: approve$/m);
  assert.match(read(root, `plans/${ID}/PLAN.md`), /^status: ready$/m);

  const files = git(root, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
  assert.deepEqual(files, [`plans/${ID}/PLAN.md`, "plans/PLANS.md"]);
  assert.match(read(root, "plans/PLANS.md"), new RegExp(`\\| \\[${ID}\\]\\(${ID}/PLAN\\.md\\) \\| T ${ID} \\| ready \\|`));
});

test("plan approve: one commit per ID and stops at the first refusal", () => {
  const other = "2026-01-02-beta";
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID),
    [`plans/${other}/PLAN.md`]: plan(other, "ready"),
  });
  const before = count(root);
  const r = run(root, "plan", "approve", ID, other);
  assert.equal(r.code, 1);
  assert.equal(r.out, `approved ${ID} ${short(root, "HEAD")}\n`);
  assert.equal(r.err, `Plan \`${other}\` is \`ready\`; only \`draft\` plans can be approved.\n`);
  assert.equal(count(root), before + 1);
  assert.match(read(root, `plans/${ID}/PLAN.md`), /^status: ready$/m);
  assert.match(read(root, `plans/${other}/PLAN.md`), /^status: ready$/m);
});

test("plan approve refuses an unknown ID and a plan that is not draft", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID, "ready"),
  });
  assert.equal(run(root, "plan", "approve", "2025-01-01-ghost").err, "Plan `2025-01-01-ghost` not found.\n");
  assert.equal(run(root, "plan", "approve", ID).err, `Plan \`${ID}\` is \`ready\`; only \`draft\` plans can be approved.\n`);
});

test("plan approve refuses a spec that is not approved", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base", "draft"),
    [`plans/${ID}/PLAN.md`]: plan(ID),
  });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.equal(r.err, `Cannot approve \`${ID}\`: \`feature/base\` is \`draft\`, not \`approved\`.\n`);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.match(read(root, `plans/${ID}/PLAN.md`), /^status: draft$/m);
});

test("plan approve refuses an uncommitted plan folder", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID),
  });
  const head = git(root, "rev-parse", "HEAD");
  fs.appendFileSync(path.join(root, `plans/${ID}/PLAN.md`), "\nedit\n");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.equal(r.err, `Commit or stash changes to \`plans/${ID}/PLAN.md\` first.\n`);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("plan approve reports validation errors and commits nothing", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID, "draft", "[feature/base]", "depends_on: [2025-01-01-ghost]\n"),
  });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.match(r.err, new RegExp(`Checking ${ID}\\.\\.\\. 1 error`));
  assert.match(r.err, /`depends_on` entry `2025-01-01-ghost` does not match any plan/);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.match(read(root, `plans/${ID}/PLAN.md`), /^status: draft$/m);
});

test("plan approve --dry-run prints the plan and changes nothing", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID),
  });
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID, "--dry-run");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`would approve ${ID}`));
  assert.match(r.out, /would regenerate plans\/PLANS\.md/);
  assert.match(r.out, new RegExp(`would commit docs\\(${ID}\\): approve plan`));
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
  assert.match(read(root, `plans/${ID}/PLAN.md`), /^status: draft$/m);
});

test("approval preserves unrelated staged work and commits the exact HEAD rendering", () => {
  const root = repo({
    "specs/features/base.md": fm("feature/base"),
    [`plans/${ID}/PLAN.md`]: plan(ID),
    "implementation.txt": "old\n",
  });
  fs.writeFileSync(path.join(root, "implementation.txt"), "staged\n");
  git(root, "add", "implementation.txt");
  fs.writeFileSync(path.join(root, "implementation.txt"), "working\n");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 0, r.err);
  assert.equal(git(root, "show", ":implementation.txt"), "staged");
  assert.equal(read(root, "implementation.txt"), "working\n");
  const committed = read(root, "plans/PLANS.md");
  const rendered = run(root, "plan", "index", "--print");
  assert.equal(rendered.code, 0, rendered.err);
  assert.equal(rendered.out, committed);
});

test("approval refuses dirty approval evidence and keeps the checkout intact", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base", "draft"), [`plans/${ID}/PLAN.md`]: plan(ID) });
  fs.writeFileSync(path.join(root, "specs/features/base.md"), fm("feature/base"));
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.match(r.err, /is `draft`, not `approved`/);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(read(root, "specs/features/base.md"), fm("feature/base"));
  assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
});

test("approval rolls back its own files after a failing commit hook", () => {
  const original = plan(ID);
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: original, "other": "old\n" });
  fs.writeFileSync(path.join(root, "other"), "staged\n");
  git(root, "add", "other");
  const hook = path.join(root, ".git/hooks/pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 2);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(read(root, `plans/${ID}/PLAN.md`), original);
  assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "other");
});

test("approval uses the committed custom path and symbolic target fallback", () => {
  const root = repo({ ".specplane/config.yaml": `${CONFIG}\nplans:\n  dir: roadmap\n`, "specs/features/base.md": fm("feature/base"), [`roadmap/${ID}/PLAN.md`]: plan(ID) });
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 0, r.err);
  const generated = read(root, "roadmap/PLANS.md");
  assert.match(generated, /repository default/);
  const rendered = run(root, "plan", "index", "--print");
  assert.equal(rendered.code, 0, rendered.err);
  assert.equal(rendered.out, generated);
});

test("approval reports its exact retained commit when a post-commit hook moves HEAD", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID) });
  const before = git(root, "rev-parse", "HEAD");
  const hook = path.join(root, ".git/hooks/post-commit");
  fs.writeFileSync(hook, `#!/bin/sh\ngit update-ref refs/heads/main ${before}\n`, { mode: 0o755 });
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  const created = /Approval commit ([0-9a-f]{40}) retained/.exec(r.err)?.[1];
  assert.ok(created, r.err);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(git(root, "rev-parse", `${created}^`), before);
  assert.match(git(root, "show", `${created}:plans/${ID}/PLAN.md`), /status: ready/);
});


test("approval validates committed administrative inputs and preserves unrelated staged and working edits", () => {
  const other = "2026-01-02-beta";
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID), [`plans/${other}/PLAN.md`]: plan(other), "docs/decisions/0001-test.md": "original\n", [`plans/${ID}/steps/01-test.md`]: `---\nplan: ${ID}\nstep: 1\ntitle: Test\nstatus: pending\n---\n` });
  fs.writeFileSync(path.join(root, "specs/features/base.md"), fm("feature/base", "draft"));
  git(root, "add", "specs/features/base.md");
  fs.writeFileSync(path.join(root, `plans/${other}/PLAN.md`), plan(other, "ready"));
  fs.writeFileSync(path.join(root, "docs/decisions/0001-test.md"), "dirty\n");
  fs.writeFileSync(path.join(root, `plans/${ID}/steps/01-test.md`), "dirty step\n");
  fs.appendFileSync(path.join(root, ".specplane/config.yaml"), "\nplans:\n  require_approved_specs: none\n");
  const before = git(root, "diff", "--cached", "--binary");
  const preview = run(root, "plan", "approve", ID, "--dry-run");
  assert.equal(preview.code, 0, preview.err);
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 0, r.err);
  assert.equal(git(root, "diff", "--cached", "--binary"), before);
  assert.equal(read(root, "specs/features/base.md"), fm("feature/base", "draft"));
  assert.equal(read(root, `plans/${ID}/steps/01-test.md`), "dirty step\n");
  assert.equal(read(root, "docs/decisions/0001-test.md"), "dirty\n");
  const rendered = run(root, "plan", "index", "--print");
  assert.equal(rendered.code, 0, rendered.err);
  assert.equal(rendered.out, read(root, "plans/PLANS.md"));
});

test("approval refuses changed output even in dry-run", () => {
  for (const mode of ["output"]) {
    const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID) });
    if (mode === "output") fs.writeFileSync(path.join(root, "plans/PLANS.md"), "user index\n");
    else fs.appendFileSync(path.join(root, ".specplane/config.yaml"), "\nplans:\n  dir: elsewhere\n");
    const before = git(root, "rev-parse", "HEAD");
    for (const args of [["--dry-run"], []]) {
      const r = run(root, "plan", "approve", ID, ...args);
      assert.equal(r.code, 1, r.err);
      assert.match(r.err, mode === "output" ? /PLANS.md/ : /configuration paths differ/);
      assert.equal(git(root, "rev-parse", "HEAD"), before);
    }
  }
});

test("assume-unchanged spec cannot supply approval evidence", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base", "draft"), [`plans/${ID}/PLAN.md`]: plan(ID) });
  git(root, "update-index", "--assume-unchanged", "specs/features/base.md");
  fs.writeFileSync(path.join(root, "specs/features/base.md"), fm("feature/base"));
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.match(r.err, /is `draft`, not `approved`/);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(read(root, "specs/features/base.md"), fm("feature/base"));
});

test("dry-run and approval both refuse an unsupported status representation", () => {
  const original = plan(ID).replace("status: draft", '"status": draft');
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: original });
  const before = git(root, "rev-parse", "HEAD");
  for (const args of [["--dry-run"], []]) {
    const r = run(root, "plan", "approve", ID, ...args);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /Cannot safely edit plan status/);
    assert.equal(git(root, "rev-parse", "HEAD"), before);
    assert.equal(read(root, `plans/${ID}/PLAN.md`), original);
    assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
  }
});

test("approval refuses hidden working edits to its output", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID), "plans/PLANS.md": "committed index\n" });
  git(root, "update-index", "--assume-unchanged", "plans/PLANS.md");
  fs.writeFileSync(path.join(root, "plans/PLANS.md"), "user index\n");
  for (const args of [["--dry-run"], []]) {
    const r = run(root, "plan", "approve", ID, ...args);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /PLANS.md/);
    assert.equal(read(root, "plans/PLANS.md"), "user index\n");
  }
});

test("skip-worktree spec cannot supply approval evidence", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base", "draft"), [`plans/${ID}/PLAN.md`]: plan(ID) });
  git(root, "update-index", "--skip-worktree", "specs/features/base.md");
  fs.writeFileSync(path.join(root, "specs/features/base.md"), fm("feature/base"));
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.match(r.err, /is `draft`, not `approved`/);
  assert.equal(read(root, "specs/features/base.md"), fm("feature/base"));
});

test("working step and ADR cannot repair invalid committed validation evidence", () => {
  const step = `plans/${ID}/steps/01-test.md`;
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID), [step]: `---\nplan: ${ID}\nstep: 1\ntitle: Test\nstatus: pending\ncontext:\n  - decision: decision/1234\n---\n` });
  fs.writeFileSync(path.join(root, step), `---\nplan: ${ID}\nstep: 1\ntitle: Test\nstatus: pending\n---\n`);
  const head = git(root, "rev-parse", "HEAD");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1);
  assert.match(r.err, /decision\/1234.*does not resolve/);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});


test("approval read tree is removed after success and validation failure", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID) });
  const head = git(root, "rev-parse", "HEAD");
  let tree = "";
  withApprovalReadTree(root, head, dir => { tree = dir; assert.ok(fs.existsSync(path.join(dir, `plans/${ID}/PLAN.md`))); });
  assert.equal(fs.existsSync(tree), false);
  assert.throws(() => withApprovalReadTree(root, head, dir => { tree = dir; throw new Error("validation failure"); }), /validation failure/);
  assert.equal(fs.existsSync(tree), false);
});


test("HEAD config governs approval despite malformed or different staged and working config", () => {
  for (const pending of ["plans: [", `${CONFIG}\nplans:\n  dir: elsewhere\n`]) {
    const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID) });
    fs.writeFileSync(path.join(root, ".specplane/config.yaml"), pending);
    git(root, "add", ".specplane/config.yaml");
    const before = git(root, "show", ":.specplane/config.yaml");
    const r = run(root, "plan", "approve", ID);
    assert.equal(r.code, 0, r.err);
    assert.equal(git(root, "show", ":.specplane/config.yaml"), before);
    assert.equal(read(root, ".specplane/config.yaml"), pending);
  }
});

test("approval refuses nonregular committed validation inputs without following them", () => {
  for (const rel of [`plans/${ID}/steps/01-test.md`, `plans/${ID}/HANDOFF.md`, "specs/features/link.md", "decisions/link.md", "specs/features", `plans/${ID}/steps`]) {
    const step = `---\nplan: ${ID}\nstep: 1\ntitle: Test\nstatus: pending\ncontext:\n  - decision: decision/1234\n---\n`;
    const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID), "bad-step.md": step });
    const target = path.join(root, rel);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(target), path.join(root, "bad-step.md")), target);
    git(root, "add", "-A"); git(root, "commit", "-qm", "link input");
    const head = git(root, "rev-parse", "HEAD");
    const r = run(root, "plan", "approve", ID);
    assert.equal(r.code, 1, `${rel}: ${r.err}`);
    assert.match(r.err, /Unsupported committed approval input/);
    assert.equal(git(root, "rev-parse", "HEAD"), head);
    assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
  }
});

test("approval refuses gitlinks in validation roots while allowing unrelated links", () => {
  const root = repo({ "specs/features/base.md": fm("feature/base"), [`plans/${ID}/PLAN.md`]: plan(ID), "source": "x" });
  fs.symlinkSync("source", path.join(root, "unrelated-link")); git(root, "add", "unrelated-link");
  const head = git(root, "rev-parse", "HEAD");
  git(root, "update-index", "--add", "--cacheinfo", `160000,${head},decisions/submodule`); git(root, "commit", "-qm", "gitlink");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1, r.err); assert.match(r.err, /Unsupported committed approval input.*submodule/);
  git(root, "rm", "--cached", "decisions/submodule"); git(root, "commit", "-qm", "remove gitlink");
  const ok = run(root, "plan", "approve", ID); assert.equal(ok.code, 0, ok.err);
});

test("hidden owned file and ancestor symlinks never mutate destinations or index", () => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) for (const which of ["plan", "ancestor", "output"]) {
    const planRel = `plans/${ID}/PLAN.md`;
    const root = repo({ "specs/features/base.md": fm("feature/base"), [planRel]: plan(ID), "plans/PLANS.md": "index bytes\n", "other": "old\n" });
    fs.writeFileSync(path.join(root, "other"), "staged\n"); git(root, "add", "other");
    const rel = which === "output" ? "plans/PLANS.md" : planRel; git(root, "update-index", flag, rel);
    const dest = path.join(root, "external-copy");
    if (which === "ancestor") { fs.renameSync(path.join(root, `plans/${ID}`), dest); fs.symlinkSync(dest, path.join(root, `plans/${ID}`)); }
    else { fs.copyFileSync(path.join(root, rel), dest); fs.unlinkSync(path.join(root, rel)); fs.symlinkSync(dest, path.join(root, rel)); }
    const destFile = which === "ancestor" ? path.join(dest, "PLAN.md") : dest;
    const beforeDest = fs.readFileSync(destFile), index = fs.readFileSync(path.join(root, ".git/index")), refs = git(root, "show-ref");
    const r = run(root, "plan", "approve", ID);
    assert.equal(r.code, 1, `${flag} ${which}: ${r.err}`);
    assert.deepEqual(fs.readFileSync(destFile), beforeDest); assert.deepEqual(fs.readFileSync(path.join(root, ".git/index")), index);
    assert.equal(git(root, "show-ref"), refs); assert.equal(fs.readFileSync(path.join(root, "plans/PLANS.md"), "utf8"), "index bytes\n");
  }
});


test("binary Git runner preserves batch bytes and throws typed errors", () => {
  const root = repo({ "binary": "initial" });
  const bytes = Buffer.from([0, 10, 255, 13, 0]);
  const oid = gitRun("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: bytes }).trim();
  const result = gitRun("git", ["cat-file", "--batch"], { cwd: root, input: Buffer.from(`${oid}\n${oid}\n`), binary: true });
  const record = Buffer.concat([Buffer.from(`${oid} blob ${bytes.length}\n`), bytes, Buffer.from("\n")]);
  assert.deepEqual(result, Buffer.concat([record, record]));
  assert.throws(() => gitRun("git", ["cat-file", "--invalid-option"], { cwd: root, input: Buffer.alloc(0), binary: true }), GitError);
});

test("partial staging recovery preserves unrelated staged changes", () => {
  const rel = `plans/${ID}/PLAN.md`;
  const root = repo({ "specs/features/base.md": fm("feature/base"), [rel]: plan(ID), "other": "old\n" });
  fs.writeFileSync(path.join(root, "other"), "staged\n"); git(root, "add", "other");
  git(root, "update-index", "--assume-unchanged", rel);
  const head = git(root, "rev-parse", "HEAD"), other = git(root, "show", ":other");
  const r = run(root, "plan", "approve", ID);
  assert.equal(r.code, 1, r.err);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "show", ":other"), other);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "other");
  assert.equal(read(root, rel), plan(ID));
  assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
});


test("hidden plan symlink to an external file refuses before any output or index mutation", () => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    const rel = `plans/${ID}/PLAN.md`;
    const root = repo({ "specs/features/base.md": fm("feature/base"), [rel]: plan(ID), "other": "old" });
    fs.writeFileSync(path.join(root, "other"), "staged"); git(root, "add", "other"); git(root, "update-index", flag, rel);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "approval-external-"));
    try {
      const target = path.join(outside, "target"); fs.writeFileSync(target, plan(ID));
      fs.unlinkSync(path.join(root, rel)); fs.symlinkSync(target, path.join(root, rel));
      const index = fs.readFileSync(path.join(root, ".git/index")), refs = git(root, "show-ref");
      const r = run(root, "plan", "approve", ID);
      assert.equal(r.code, 1, r.err); assert.equal(read(outside, "target"), plan(ID));
      assert.deepEqual(fs.readFileSync(path.join(root, ".git/index")), index); assert.equal(git(root, "show-ref"), refs);
      assert.equal(fs.existsSync(path.join(root, "plans/PLANS.md")), false);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  }
});
