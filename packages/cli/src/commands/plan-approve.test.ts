import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG, makeRepo, spec } from "../test-repo.js";

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
  assert.equal(r.err, `Commit or stash changes to \`plans/${ID}\` first.\n`);
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
  assert.match(r.err, /changed administrative inputs/);
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
