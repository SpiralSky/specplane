import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { acquireWriterLease } from "../core/writer-leases.js";
import { firstStart, recheckStartRefs } from "./first-start.js";
import { prepareStart } from "./prepare-start.js";

const id = "2026-11-02-example";
function fixture(t: import("node:test").TestContext, configText = "") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "first-start-"));
  t.after(() => { fs.rmSync(path.join(os.tmpdir(), ".worktrees", path.basename(cwd)), { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); });
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }).trim();
  const put = (name: string, text: string) => { const file = path.join(cwd, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  git("init", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.com");
  put(".specplane/config.yaml", configText);
  put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\n---\n`);
  put("docs/specifications/features/example.md", "---\nid: feature/example\ntitle: Example\nauthor: user\nstatus: approved\n---\n");
  git("add", "."); git("commit", "-m", "base");
  return { cwd, git, put, config: loadConfig(cwd).config };
}
test("first start binds the authoritative nondefault target in a metadata-only commit", t => {
  const f = fixture(t, "execution:\n  backend: external\n"); f.git("branch", "candidate");
  const base = f.git("rev-parse", "candidate"); f.put("docs/specifications/features/example.md", "unapproved in working tree");
  const result = firstStart(id, f.config, f.cwd, { target: "candidate", fetch: false });
  assert.equal(result.target, "candidate"); assert.equal(result.startBase, base);
  const ref = `plan/${id}`; assert.equal(f.git("rev-parse", `${ref}^`), base);
  assert.equal(f.git("diff", "--name-only", base, ref), `plans/${id}/PLAN.md`);
  const text = f.git("show", `${ref}:plans/${id}/PLAN.md`);
  assert.match(text, /target_branch: "candidate"/); assert.match(text, new RegExp(`start_base: ${base}`));
  assert.match(f.git("log", "-1", "--format=%B", ref), /Specplane-Workflow: start/);
  assert.equal(fs.readFileSync(path.join(f.cwd, "docs/specifications/features/example.md"), "utf8"), "unapproved in working tree");
  assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /Resume/);
  assert.equal(f.git("rev-parse", ref), f.git("rev-parse", `refs/heads/${ref}`));
});
test("dry run and refusal leave no branch or runtime files", t => {
  const f = fixture(t, "execution:\n  backend: external\n"); const before = f.git("status", "--porcelain");
  assert.equal(firstStart(id, f.config, f.cwd, { dryRun: true }).dryRun, true);
  assert.throws(() => firstStart(id, f.config, f.cwd, { dryRun: true, target: "missing" }), /unavailable/);
  assert.equal(fs.existsSync(path.join(f.cwd, ".git/specplane-runtime")), false); assert.equal(f.git("status", "--porcelain"), before);
  assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});
test("repository lease excludes start before mutation", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const holder = acquireWriterLease({ repository: true, checkouts: [f.cwd], requestId: "holder" });
  try { assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /lease/); }
  finally { holder.release(); }
  assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});
test("failed setup retains binding branch and removes only new checkout", t => {
  const f = fixture(t, "plans:\n  setup_hook: 'exit 1'\nexecution:\n  backend: worktree\n  worktree_dir: ../.worktrees\n");
  assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /Recovery:.*start commit/s);
  assert.match(f.git("show", `plan/${id}:plans/${id}/PLAN.md`), /start_base:/);
  assert.equal(f.git("worktree", "list", "--porcelain").split("worktree ").length - 1, 1);
});
test("frontmatter claim uses target checkout and leaves unrelated checkout unchanged", t => {
  const f = fixture(t, "plans:\n  status_source: frontmatter\nexecution:\n  backend: external\n");
  f.git("branch", "candidate"); const target = path.join(f.cwd, "candidate-checkout"); f.git("worktree", "add", target, "candidate");
  const main = f.git("rev-parse", "main"); const result = firstStart(id, f.config, f.cwd, { target: "candidate", fetch: false });
  assert.equal(f.git("rev-parse", "main"), main); assert.equal(result.startBase, f.git("rev-parse", "candidate"));
  assert.match(f.git("show", `candidate:plans/${id}/PLAN.md`), /status: in_progress/);
  assert.equal(f.git("rev-parse", `plan/${id}^`), result.startBase);
});

test("stale captured target ref refuses before a plan branch is created", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const prepared = prepareStart(id, f.config, f.cwd); f.put("changed", "changed"); f.git("add", "changed"); f.git("commit", "-m", "move target");
  const after = f.git("rev-parse", "HEAD");
  assert.throws(() => recheckStartRefs(f.cwd, prepared.refs), /changed during preparation/);
  assert.equal(f.git("rev-parse", "HEAD"), after); assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});

test("CLI previews the selected target and rejects standalone run without writes", t => {
  const f = fixture(t, "execution:\n  backend: external\n"); f.git("branch", "candidate");
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const preview = spawnSync(process.execPath, [cli, "plan", "start", id, "--target", "candidate", "--dry-run", "--json"], { cwd: f.cwd, encoding: "utf8", timeout: 5000 });
  assert.equal(preview.status, 0, preview.stderr);
  const json = JSON.parse(preview.stdout); assert.equal(json.target_branch, "candidate");
  assert.equal(json.start_base, f.git("rev-parse", "candidate")); assert.equal(json.comparison_base, null); assert.equal(json.ref_freshness, "local"); assert.equal(json.nextCommand, null);
  const run = spawnSync(process.execPath, [cli, "plan", "start", id, "--run"], { cwd: f.cwd, encoding: "utf8", timeout: 5000 });
  assert.equal(run.status, 1); assert.match(run.stderr, /Standalone --run/);
  assert.equal(f.git("branch", "--list", `plan/${id}`), ""); assert.equal(fs.existsSync(path.join(f.cwd, ".git/specplane-runtime")), false);
});
test("claim hook failure restores only the claim file and its staged entry", t => {
  const f = fixture(t, "plans:\n  status_source: frontmatter\nexecution:\n  backend: external\n");
  f.put("unrelated", "leave this alone");
  const hook = path.join(f.cwd, ".git/hooks/pre-commit");
  fs.writeFileSync(hook, `#!/bin/sh\nunset GIT_INDEX_FILE\ngit add plans/${id}/PLAN.md\nexit 1\n`, { mode: 0o755 });
  const head = f.git("rev-parse", "HEAD"); const status = f.git("status", "--porcelain");
  assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /git commit/);
  assert.equal(f.git("rev-parse", "HEAD"), head); assert.equal(f.git("status", "--porcelain"), status);
  assert.equal(f.git("diff", "--cached", "--name-only"), "");
  assert.equal(fs.readFileSync(path.join(f.cwd, "unrelated"), "utf8"), "leave this alone");
});
test("failed claim push is recognized and published on retry", t => {
  const f = fixture(t, "plans:\n  status_source: frontmatter\nexecution:\n  backend: external\n");
  const original = "\uFEFF" + ["---", `id: ${id}`, "title: Example", "status: ready", "specs: [feature/example]", "---", "# Body", ""].join("\r\n");
  f.put(`plans/${id}/PLAN.md`, original); f.git("commit", "-am", "CRLF claim fixture");
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "first-start-origin-"));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "ignore", timeout: 5000 });
  f.git("remote", "add", "origin", remote); f.git("push", "origin", "main");
  const hook = path.join(remote, "hooks/pre-receive"); fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /claim commit .*publication pending/s);
  const claim = f.git("rev-parse", "main"); assert.equal(f.git("branch", "--list", `plan/${id}`), "");
  assert.equal(fs.readFileSync(path.join(f.cwd, `plans/${id}/PLAN.md`), "utf8"), original.replace("status: ready", "status: in_progress"));
  fs.unlinkSync(hook);
  const result = firstStart(id, f.config, f.cwd, { fetch: false });
  assert.equal(result.startBase, claim); assert.equal(f.git("rev-parse", `plan/${id}^`), claim);
  assert.equal(execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8", timeout: 5000 }).trim(), claim);
});
test("stack marker precedes binding and records the dependency tip", t => {
  const f = fixture(t, "plans:\n  dependency_mode: stack\nexecution:\n  backend: external\n");
  const dep = "2026-11-01-dependency";
  f.put(`plans/${id}/PLAN.md`, `---\nid: ${id}\ntitle: Example\nstatus: ready\nspecs: [feature/example]\ndepends_on: [${dep}]\n---\n`);
  f.put(`plans/${dep}/PLAN.md`, `---\nid: ${dep}\ntitle: Dependency\nstatus: ready\nspecs: [feature/example]\n---\n`);
  f.git("add", "."); f.git("commit", "-m", "dependency"); const target = f.git("rev-parse", "HEAD");
  f.git("switch", "-c", `plan/${dep}`); f.put(`plans/${dep}/PLAN.md`, `---\nid: ${dep}\ntitle: Dependency\nstatus: ready\nspecs: [feature/example]\nexecution:\n  target_branch: main\n  start_target_branch: main\n  start_base: ${target}\n---\n`); f.git("commit", "-am", "bind dependency");
  const base = f.git("rev-parse", "HEAD"); f.git("switch", "main");
  const result = firstStart(id, f.config, f.cwd, { fetch: false }); const branch = `plan/${id}`;
  assert.equal(result.startBase, base); assert.equal(f.git("rev-parse", `${branch}~2`), base);
  assert.match(f.git("log", "-1", "--format=%B", `${branch}^`), new RegExp(`Specplane-Stack-Base: ${base}`));
  assert.match(f.git("log", "-1", "--format=%B", branch), /Specplane-Workflow: start/);
  assert.equal(f.git("diff", "--name-only", `${branch}^`, branch), `plans/${id}/PLAN.md`);
});
test("target plan lease contention refuses before binding", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const targetId = "2026-11-01-other"; f.git("branch", `plan/${targetId}`);
  const holder = acquireWriterLease({ plans: [targetId], checkouts: [f.cwd], requestId: "target-holder" });
  try { assert.throws(() => firstStart(id, f.config, f.cwd, { target: `plan/${targetId}`, fetch: false }), /lease/); }
  finally { holder.release(); }
  assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});
test("checkout-only writer blocks setup after worktree registration", t => {
  const f = fixture(t, "plans:\n  setup_hook: 'touch hook-ran'\nexecution:\n  backend: worktree\n  worktree_dir: ../.worktrees\n");
  const helper = fs.mkdtempSync(path.join(os.tmpdir(), "start-lease-helper-"));
  const ready = path.join(helper, "ready"), stop = path.join(helper, "stop");
  const holder = path.join(helper, "holder.mjs");
  const leaseModule = new URL("../core/writer-leases.js", import.meta.url).href;
  fs.writeFileSync(holder, `import fs from 'node:fs'; import { acquireWriterLease } from ${JSON.stringify(leaseModule)}; const lease = acquireWriterLease({checkouts:[process.argv[2]],requestId:'other-writer'}); fs.writeFileSync(process.argv[2] + "/writer-owned", "keep"); fs.writeFileSync(process.argv[3], 'ready'); const timer = setInterval(() => { if (fs.existsSync(process.argv[4])) { lease.release(); fs.writeFileSync(process.argv[4] + ".done", "done"); clearInterval(timer); } }, 20);`);
  const wrapper = path.join(helper, "git");
  fs.writeFileSync(wrapper, `#!/bin/sh\n/usr/bin/git "$@"\nresult=$?\nif [ "$result" -eq 0 ] && [ "$1" = worktree ] && [ "$2" = add ]; then\n  ${JSON.stringify(process.execPath)} ${JSON.stringify(holder)} "$4" ${JSON.stringify(ready)} ${JSON.stringify(stop)} >/dev/null 2>&1 &\n  i=0; while [ ! -f ${JSON.stringify(ready)} ] && [ "$i" -lt 200 ]; do sleep 0.02; i=$((i+1)); done\n  [ -f ${JSON.stringify(ready)} ] || exit 9\nfi\nexit "$result"\n`, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = `${helper}:${previousPath}`;
  try {
    assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /lease.*Recovery:.*plan branch/s);
    const checkout = path.join(os.tmpdir(), ".worktrees", path.basename(f.cwd), id);
    assert.equal(fs.existsSync(checkout), true); assert.equal(fs.existsSync(path.join(checkout, "hook-ran")), false);
    assert.equal(fs.existsSync(path.join(checkout, ".specplane/config.yaml")), false);
    assert.equal(fs.readFileSync(path.join(checkout, "writer-owned"), "utf8"), "keep");
    assert.match(f.git("show", `plan/${id}:plans/${id}/PLAN.md`), /start_base:/);
  } finally { process.env.PATH = previousPath; fs.writeFileSync(stop, "stop"); execFileSync("sh", ["-c", 'i=0; while [ ! -f "$1" ] && [ "$i" -lt 250 ]; do sleep 0.02; i=$((i+1)); done; test -f "$1"', "wait", `${stop}.done`], { timeout: 6000 }); }
  t.after(() => { if (fs.existsSync(helper)) fs.rmSync(helper, { recursive: true, force: true }); });
});

test("failed branch update reports the orphan commit without claiming a branch", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "start-git-wrapper-"));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nif [ "$1" = update-ref ] && [ "$2" = refs/heads/plan/${id} ]; then echo blocked >&2; exit 1; fi\nexec /usr/bin/git "$@"\n`, { mode: 0o755 });
  const old = process.env.PATH; process.env.PATH = `${bin}:${old}`;
  try { assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /orphan start commit .*no plan branch was created/s); }
  finally { process.env.PATH = old; }
  assert.equal(f.git("branch", "--list", `plan/${id}`), "");
});
test("human start output reports provenance and no host launch command", t => {
  const f = fixture(t, "execution:\n  backend: external\n");
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "plan", "start", id, "--no-fetch"], { cwd: f.cwd, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Target: main; start base:/);
  assert.match(result.stdout, /comparison base: none; freshness: local/); assert.doesNotMatch(result.stdout, /claude/);
});
test("target ref movement during checkout creation prevents setup and preserves checkout", t => {
  const f = fixture(t, "plans:\n  setup_hook: 'touch hook-ran'\nexecution:\n  backend: worktree\n  worktree_dir: ../.worktrees\n");
  f.git("commit", "--allow-empty", "-m", "new target"); const prior = f.git("rev-parse", "HEAD^");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "start-ref-wrapper-"));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\n/usr/bin/git "$@"\nresult=$?\nif [ "$result" -eq 0 ] && [ "$1" = worktree ] && [ "$2" = add ]; then /usr/bin/git update-ref refs/heads/main ${prior}; fi\nexit "$result"\n`, { mode: 0o755 });
  const old = process.env.PATH; process.env.PATH = `${bin}:${old}`;
  try { assert.throws(() => firstStart(id, f.config, f.cwd, { fetch: false }), /refs\/heads\/main changed during preparation/); }
  finally { process.env.PATH = old; }
  const checkout = path.join(os.tmpdir(), ".worktrees", path.basename(f.cwd), id);
  assert.equal(fs.existsSync(checkout), true); assert.equal(fs.existsSync(path.join(checkout, "hook-ran")), false);
});
for (const [label, prefix, newline] of [["CRLF", "", "\r\n"], ["BOM and CRLF", "\uFEFF", "\r\n"], ["BOM and LF", "\uFEFF", "\n"]] as const) {
  test(`claim and binding preserve ${label} frontmatter and body`, t => {
    const f = fixture(t, "plans:\n  status_source: frontmatter\nexecution:\n  backend: external\n");
    const original = prefix + ["---", `id: ${id}`, "title: Example", "status: ready", "specs: [feature/example]", "---", "# Body", "untouched", ""].join(newline);
    f.put(`plans/${id}/PLAN.md`, original); f.git("commit", "-am", "preserve plan presentation");
    const result = firstStart(id, f.config, f.cwd, { fetch: false });
    const read = (ref: string) => execFileSync("git", ["show", `${ref}:plans/${id}/PLAN.md`], { cwd: f.cwd, encoding: "utf8", timeout: 5000 });
    const claimed = original.replace("status: ready", "status: in_progress");
    assert.equal(read("main"), claimed);
    const binding = ["execution:", '  target_branch: "main"', '  start_target_branch: "main"', `  start_base: ${result.startBase}`].join(newline);
    assert.equal(read(`plan/${id}`), claimed.replace(`${newline}---${newline}# Body`, `${newline}${binding}${newline}---${newline}# Body`));
  });
}
