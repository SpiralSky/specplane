import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";
import { loadConfig } from "../config.js";
import { finishPlan } from "./flows.js";

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
const gitOk = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env: ENV }).status === 0;
const sp = (cwd: string, ...a: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: "utf8", env: ENV, input: "" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

const A = "2026-01-01-alpha";
const planMd = (status = "ready") =>
  `---\nid: ${A}\ntitle: "T"\nstatus: ${status}\nspecs: [feature/example]\n---\n# P\n\n## Acceptance criteria\n\n- [ ] it works\n`;
const stepMd = (n: number, status: string) => `---\nplan: ${A}\nstep: ${n}\ntitle: s${n}\nstatus: ${status}\n---\n# s\n`;

interface Opts {
  planCfg?: string;
  exec?: string;
  remote?: boolean;
  steps?: string[];
  planStatus?: string;
  merge?: string;
  target?: string;
}
const ownedDirs: string[] = [];
after(() => { for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true }); });

interface R { root: string; wt: string; origin: string; co: string }

/** Repo on `main`, plan started via the CLI, steps set to the given statuses and committed on the plan branch. */
function repo(o: Opts = {}): R {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-fwt-"));
  const root = makeRepo({
    ".specplane/config.yaml": `spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: plans\n  merge: ${o.merge ?? "local_merge"}\n  require_approved_specs: none\n${o.planCfg ?? ""}execution:\n  worktree_dir: ${wt}\n${o.exec ?? ""}`,
    "specs/features/example.md": "---\nid: feature/example\ntitle: X\nstatus: approved\nauthor: user\n---\n# X\n",
    [`plans/${A}/PLAN.md`]: planMd(o.planStatus),
    "base.txt": "base\n",
  });
  ownedDirs.push(root, wt);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-forigin-"));
  ownedDirs.push(origin);
  if (o.remote) {
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", origin);
    git(root, "push", "-q", "origin", "main");
    git(root, "fetch", "-q", "origin");
  }
  if (o.target) {
    git(root, "switch", "-q", "-c", o.target);
    if (o.remote) git(root, "push", "-q", "origin", o.target);
  }
  const res = sp(root, "plan", "start", A, ...(o.target ? ["--target", o.target] : []));
  assert.equal(res.code, 0, res.err);
  const inRoot = /backend: (branch|external)/.test(o.exec ?? "");
  const co = inRoot ? root : path.join(wt, path.basename(root), A);
  if ((o.exec ?? "").includes("external")) git(root, "switch", "-q", `plan/${A}`);
  (o.steps ?? ["done"]).forEach((st, i) => {
    const dir = path.join(co, "plans", A, "steps");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `0${i + 1}-s.md`), stepMd(i + 1, st));
  });
  git(co, "add", "-A");
  git(co, "commit", "-q", "-m", "work");
  return { root, wt, origin, co };
}
const fin = (r: R, ...a: string[]) => sp(r.co, "plan", "finish", A, ...a);
// Scripted human port: exercises the actual confirmation callback with the displayed head and target.
const finConfirmed = (r: R, noFetch = false, env: NodeJS.ProcessEnv = ENV) => {
  const flow = new URL("./flows.js", import.meta.url).href;
  const config = new URL("../config.js", import.meta.url).href;
  const script = `import { finishPlan } from ${JSON.stringify(flow)}; import { loadConfig } from ${JSON.stringify(config)};
    try { const result = await finishPlan(process.argv[1], loadConfig(process.cwd()).config, process.cwd(), { fetch: ${!noFetch}, confirm: async q => { if (!/ at .* into .* at /.test(q)) throw new Error("missing state"); return true; } });
      process.stdout.write((result.outcome === "merged" ? "Finished and merged" : result.outcome === "pushed" ? "Finished and pushed" : "Finished") + "\\n"); process.stderr.write(result.notices.join("\\n")); }
    catch (e) { process.stderr.write(String(e)); process.exitCode = 1; }`;
  const x = spawnSync(process.execPath, ["--input-type=module", "-e", script, A], { cwd: r.co, encoding: "utf8", env });
  return { code: x.status, out: x.stdout, err: x.stderr };
};
const finWithCallback = (r: R, callbackBody: string) => {
  const flow = new URL("./flows.js", import.meta.url).href;
  const config = new URL("../config.js", import.meta.url).href;
  const script = `import { finishPlan } from ${JSON.stringify(flow)}; import { loadConfig } from ${JSON.stringify(config)}; import { execFileSync } from "node:child_process"; import fs from "node:fs";
    let count = 0; try { const result = await finishPlan(process.argv[1], loadConfig(process.cwd()).config, process.cwd(), { confirm: async () => { count++; ${callbackBody} return true; } }); console.log(result.outcome); }
    catch (e) { console.error(String(e)); process.exitCode = 1; }`;
  const x = spawnSync(process.execPath, ["--input-type=module", "-e", script, A], { cwd: r.co, encoding: "utf8", env: ENV });
  return { code: x.status, out: x.stdout, err: x.stderr };
};
const sha = (cwd: string, ref: string) => git(cwd, "rev-parse", ref);
const branchExists = (root: string, b: string) => gitOk(root, "show-ref", "--verify", "--quiet", `refs/heads/${b}`);

test("finish: local merge without a remote (Scenarios 4, 4a)", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.root, "later.txt"), "x");
  git(r.root, "add", "later.txt");
  git(r.root, "commit", "-q", "-m", "main moves");
  const first = fin(r, "--yes");
  assert.equal(first.code, 0, first.err);
  assert.match(first.err, /ready to merge/);
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /Finished and merged/);
  assert.equal(git(r.root, "rev-list", "--parents", "-n", "1", "main").split(" ").length, 3, "merge commit");
  assert.ok(fs.existsSync(path.join(r.root, "plans", "archive", A, "PLAN.md")));
  assert.ok(!fs.existsSync(path.join(r.root, "plans", A)));
  assert.match(fs.readFileSync(path.join(r.root, "plans", "archive", A, "PLAN.md"), "utf8"), /status: done/);
  assert.ok(!fs.existsSync(r.co), "worktree removed");
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  const body = git(r.root, "log", "--format=%B", "--grep=finish", "-n", "1", "main");
  assert.match(body, /chore\(specplane\): finish 2026-01-01-alpha/);
  assert.match(body, /Specplane-Workflow: finish/);
  assert.match(first.err, /Acceptance criteria/);
});

test("finish: --no-fetch skips the fetch; pushes and merges still happen", () => {
  const r = repo({ remote: true });
  // The remote no longer has `main`, so any fetch fails while local refs are intact.
  git(r.origin, "branch", "-D", "main");
  const bad = fin(r, "--yes");
  assert.notEqual(bad.code, 0, "a fetch failure surfaces without --no-fetch");
  const ready = fin(r, "--yes", "--no-fetch");
  assert.equal(ready.code, 0, ready.err);
  assert.match(ready.err, /ready to merge/);
  const ok = finConfirmed(r, true);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /Finished and merged/);
  assert.equal(git(r.origin, "rev-parse", "main"), git(r.root, "rev-parse", "main"), "merged commit pushed");
});

test("finish: lists open spec-gaps entries without blocking", () => {
  const r = repo();
  fs.writeFileSync(
    path.join(r.co, "plans", A, "spec-gaps.md"),
    "# Spec gaps — " + A + "\n\n## G1: missing text\n\n**Kind**: assumption\n**Step**: 1\n**Case**: no message for X\n**Resolution**: used Y\n**Target spec**: `feature/example`\n**Status**: open\n\n## G2: settled\n\n**Kind**: gap\n**Step**: 1\n**Case**: Z\n**Resolution**: done\n**Target spec**: `feature/example`\n**Status**: applied\n",
  );
  git(r.co, "add", "-A");
  git(r.co, "commit", "-q", "-m", "gaps");
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /Open spec gaps:\n  G1 \(assumption, feature\/example\): no message for X/);
  assert.doesNotMatch(res.err, /G2/, "only open entries are listed");
});

test("finish: step not done stops with no writes (Scenario 5a)", () => {
  const r = repo({ steps: ["done", "blocked"] });
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot finish: step 02 is `blocked`\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.equal(sp(r.co, "plan", "finish", A).code, 1);
});

test("finish: wrong branch and dirty tree fail with no writes", () => {
  const r = repo();
  let res = sp(r.root, "plan", "finish", A);
  assert.equal(res.code, 1);
  assert.match(res.err, /Cannot finish: the checkout is on `main`, not `plan\/2026-01-01-alpha`\./);
  fs.appendFileSync(path.join(r.co, "base.txt"), "dirty");
  res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /uncommitted changes/);
});

test("finish: failing tests stop the flow without a commit (Scenario 5)", () => {
  const r = repo({ planCfg: "  test_command: exit 1\n" });
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /Verification failed: `exit 1` exited with code 1\. Fix failing tests before finishing\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.ok(branchExists(r.root, `plan/${A}`));
});

test("finish: tests re-run after a rebase that applied commits", () => {
  const log = path.join(os.tmpdir(), `specplane-testlog-${process.pid}-${Date.now()}`);
  const r = repo({ planCfg: `  test_command: echo run >> ${log}\n`, remote: false });
  fs.writeFileSync(path.join(r.root, "later.txt"), "x");
  git(r.root, "add", "later.txt");
  git(r.root, "commit", "-q", "-m", "main moves");
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2);
  fs.rmSync(log);
});

test("finish: rebase conflict aborts and leaves the branch unchanged", () => {
  const r = repo();
  fs.writeFileSync(path.join(r.co, "base.txt"), "plan side\n");
  git(r.co, "commit", "-qam", "plan edit");
  fs.writeFileSync(path.join(r.root, "base.txt"), "main side\n");
  git(r.root, "commit", "-qam", "main edit");
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /Rebase of `plan\/2026-01-01-alpha` onto `[0-9a-f]+` has conflicts; resolve manually\./);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.ok(!fs.existsSync(path.join(r.root, ".git", "worktrees", A, "rebase-merge")));
});

test("finish: without --yes and no human, stops ready; a re-run merges (resume)", () => {
  const r = repo();
  let res = fin(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /ready to merge/);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
  const done = sha(r.co, "HEAD");
  res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(git(r.root, "rev-list", "--count", "--grep=finish", "main"), "1", "no second finish commit");
  assert.ok(gitOk(r.root, "merge-base", "--is-ancestor", done, "main"));
});

test("finish: merge stops when the main checkout is on another branch", () => {
  const r = repo();
  git(r.root, "switch", "-q", "-c", "other");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /clean checkout of target `main`/);
  assert.ok(branchExists(r.root, `plan/${A}`));
  assert.notEqual(git(r.co, "log", "-1", "--format=%s").startsWith("chore(specplane): finish"), true);
});

test("finish: local merge pushes the default branch when a remote exists", () => {
  const r = repo({ remote: true });
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.equal(sha(r.origin, "main"), sha(r.root, "main"));
});

test("finish: pull_request pushes the branch and prints instructions", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.out, /Finished and pushed/);
  assert.match(res.err, /Open a pull request from `plan\/2026-01-01-alpha` into `main`/);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  assert.ok(fs.existsSync(r.co), "worktree kept until cleanup");
});

/** Stub `gh` first on PATH; origin looks like GitHub but fetches/pushes resolve to the local bare repo. */
function ghRepo(planCfg: string, ghOut: string, target?: string): { r: R; env: NodeJS.ProcessEnv; log: string } {
  const r = repo({ remote: true, merge: "pull_request", planCfg, target });
  git(r.root, "config", "remote.origin.url", "https://github.com/o/r.git");
  git(r.root, "config", `url.${r.origin}.insteadOf`, "https://github.com/o/r.git");
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-gh-"));
  ownedDirs.push(bin);
  const log = path.join(bin, "calls.log");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\necho -- >> '${log}'\n[ "$1" = "--version" ] && exit 0\n[ "$1" = "pr" ] && [ "$2" = "list" ] && { echo '[]'; exit 0; }\necho '${ghOut}'\n`, { mode: 0o755 });
  return { r, env: { ...ENV, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, log };
}
const finEnv = (r: R, env: NodeJS.ProcessEnv) => {
  const x = spawnSync(process.execPath, [cli, "plan", "finish", A], { cwd: r.co, encoding: "utf8", env, input: "" });
  return { code: x.status, out: x.stdout, err: x.stderr };
};

test("finish: pull_request with a forge pushes, opens a PR from the plan, prints the URL", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "https://github.com/o/r/pull/3");
  const res = finConfirmed(r, false, env);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /Opened pull request: https:\/\/github\.com\/o\/r\/pull\/3/);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  const calls = fs.readFileSync(log, "utf8");
  assert.match(calls, /pr\ncreate\n--head\nplan\/2026-01-01-alpha\n--base\nmain\n--title\nT\n--body\n/);
  assert.match(calls, /Plan `2026-01-01-alpha`/);
  assert.match(calls, /- \[ \] it works/);
});

test("finish: pull_request with forge none prints manual instructions and never calls gh", () => {
  const { r, env, log } = ghRepo("  forge: none\n", "unused");
  const res = finConfirmed(r, false, env);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /Open a pull request from/);
  assert.equal(fs.existsSync(log), false);
});

test("finish: pull_request without a remote fails with no writes", () => {
  const r = repo({ merge: "pull_request" });
  const head = sha(r.co, "HEAD");
  const res = fin(r);
  assert.equal(res.code, 1);
  assert.match(res.err, /needs a remote/);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("finish: frontmatter mode claims review on the default branch first", () => {
  const r = repo({ planCfg: "  status_source: frontmatter\n", remote: false });
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  const log = git(r.root, "log", "--format=%s", "main");
  assert.match(log, /claim 2026-01-01-alpha review/);
  assert.match(log, /finish 2026-01-01-alpha/);
});

test("finish: branch backend switches back to the default branch and deletes the branch", () => {
  const r = repo({ exec: "  backend: branch\n" });
  const res = fin(r, "--yes");
  assert.equal(res.code, 0, res.err);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  assert.equal(git(r.root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(branchExists(r.root, `plan/${A}`), false);
  assert.ok(fs.existsSync(path.join(r.root, "plans", "archive", A, "PLAN.md")));
});

test("finish: external backend rejects local_merge", () => {
  const r = repo({ exec: "  backend: external\n" });
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /`external` backend does not support `local_merge`/);
});

test("finish uses recorded nondefault target and requires fresh acceptance after finalization", () => {
  const r = repo({ target: "release" });
  const main = sha(r.root, "main");
  const first = fin(r, "--yes");
  assert.equal(first.code, 0, first.err);
  assert.equal(sha(r.root, "release"), main);
  assert.match(first.err, /ready to merge/);
  const reviewed = sha(r.co, "HEAD");
  const second = finConfirmed(r);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /Finished and merged/);
  assert.equal(sha(r.root, "main"), main);
  assert.ok(gitOk(r.root, "merge-base", "--is-ancestor", reviewed, "release"));
});

test("finish refuses a missing target checkout before changing the plan", () => {
  const r = repo({ target: "release" });
  git(r.root, "switch", "-q", "main");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /clean checkout of target `release`/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("finish rebases on a remote-ahead recorded target and advertises its PR base", () => {
  const r = repo({ target: "release", remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-remote-ahead-"));
  ownedDirs.push(clone);
  git(clone, "clone", "-q", r.origin, ".");
  git(clone, "switch", "-q", "release");
  fs.writeFileSync(path.join(clone, "remote.txt"), "remote\n");
  git(clone, "add", "remote.txt");
  git(clone, "commit", "-q", "-m", "remote target advances");
  git(clone, "push", "-q", "origin", "release");
  const remoteTip = sha(clone, "HEAD");
  const res = finConfirmed(r);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /into `release`/);
  assert.ok(gitOk(r.co, "merge-base", "--is-ancestor", remoteTip, "HEAD"));
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
});

test("target movement invalidates earlier acceptance and requires another invocation", () => {
  const r = repo();
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const prior = sha(r.co, "HEAD");
  fs.writeFileSync(path.join(r.root, "advanced.txt"), "advance\n");
  git(r.root, "add", "advanced.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  const target = sha(r.root, "HEAD");
  const rebased = fin(r, "--yes");
  assert.equal(rebased.code, 0, rebased.err);
  assert.match(rebased.err, /ready to merge/);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.notEqual(sha(r.co, "HEAD"), prior);
  const merged = finConfirmed(r);
  assert.equal(merged.code, 0, merged.err);
  assert.match(merged.out, /Finished and merged/);
});

test("finish refuses a wrong-base open PR before changing or pushing the plan", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "unused");
  const program = path.join(path.dirname(log), "gh");
  fs.writeFileSync(program, `#!/bin/sh\n[ "$1" = "--version" ] && exit 0\n[ "$1" = "pr" ] && [ "$2" = "list" ] && { echo '[{"url":"https://github.com/o/r/pull/1","baseRefName":"other"}]'; exit 0; }\nexit 2\n`, { mode: 0o755 });
  const before = sha(r.co, "HEAD");
  const result = finEnv(r, env);
  assert.equal(result.code, 2);
  assert.match(result.err, /base conflicts with recorded target/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
});

test("confirmation refuses when target moves during the human challenge", async () => {
  const r = repo();
  const ready = fin(r, "--yes");
  assert.equal(ready.code, 0, ready.err);
  const reviewed = sha(r.co, "HEAD");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async question => {
    assert.match(question, new RegExp(reviewed));
    fs.writeFileSync(path.join(r.root, "raced.txt"), "race\n");
    git(r.root, "add", "raced.txt");
    git(r.root, "commit", "-q", "-m", "target race");
    return true;
  } }), /changed during operation/);
  assert.equal(sha(r.co, "HEAD"), reviewed);
  assert.equal(gitOk(r.root, "merge-base", "--is-ancestor", reviewed, "main"), false);
});

test("a manual done edit does not impersonate a completed finish", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: done"));
  git(r.co, "commit", "-qam", "manual done");
  const head = sha(r.co, "HEAD");
  const res = fin(r, "--yes");
  assert.equal(res.code, 1);
  assert.match(res.err, /no matching finish commit/);
  assert.equal(sha(r.co, "HEAD"), head);
});

test("forge receives the recorded nondefault PR base", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "https://github.com/o/r/pull/7", "release");
  const result = finConfirmed(r, false, env);
  assert.equal(result.code, 0, result.err);
  assert.match(fs.readFileSync(log, "utf8"), /pr\ncreate\n--head\nplan\/2026-01-01-alpha\n--base\nrelease\n/);
});

test("finalized PR retry requires fresh publication confirmation after target moves", () => {
  const log = path.join(os.tmpdir(), `specplane-retry-tests-${process.pid}-${Date.now()}`);
  const r = repo({ remote: true, merge: "pull_request", planCfg: `  forge: none\n  test_command: echo run >> ${log}\n` });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const failed = finConfirmed(r);
  assert.equal(failed.code, 1, failed.err);
  const finalized = sha(r.co, "HEAD");
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  fs.unlinkSync(hook);
  fs.writeFileSync(path.join(r.root, "new-target.txt"), "advance\n");
  git(r.root, "add", "new-target.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  git(r.root, "push", "-q", "origin", "main");
  const target = sha(r.root, "HEAD");
  const retry = fin(r, "--yes");
  assert.equal(retry.code, 0, retry.err);
  assert.match(retry.err, /ready for fresh finish acceptance/);
  assert.notEqual(sha(r.co, "HEAD"), finalized);
  assert.ok(gitOk(r.co, "merge-base", "--is-ancestor", target, "HEAD"));
  assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2, "verification reran after rebase");
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  const accepted = finConfirmed(r);
  assert.equal(accepted.code, 0, accepted.err);
  assert.equal(sha(r.origin, `plan/${A}`), sha(r.co, "HEAD"));
  assert.equal(git(r.co, "rev-list", "--count", "--grep=finish", "HEAD"), "1");
  fs.rmSync(log);
});

test("finalization confirmation preserves callback-time target file and index edits", async () => {
  const r = repo();
  const before = sha(r.co, "HEAD");
  const file = path.join(r.root, "base.txt");
  await assert.rejects(finishPlan(A, loadConfig(r.co).config, r.co, { confirm: async () => {
    fs.writeFileSync(file, "human staged change\n");
    git(r.root, "add", "base.txt");
    fs.writeFileSync(file, "human unstaged change\n");
    return true;
  } }), /clean checkout of target/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(fs.readFileSync(file, "utf8"), "human unstaged change\n");
  assert.equal(git(r.root, "show", ":base.txt"), "human staged change");
  assert.equal(git(r.co, "log", "-1", "--format=%s").includes("finish"), false);
});

test("verification edits to target checkout refuse before review claim", () => {
  const r = repo({ planCfg: "  status_source: frontmatter\n" });
  const cfg = path.join(r.root, ".specplane", "config.yaml");
  fs.writeFileSync(cfg, fs.readFileSync(cfg, "utf8").replace("  merge: local_merge\n", `  merge: local_merge\n  test_command: 'printf edited > ${r.root}/base.txt'\n`));
  git(r.root, "add", ".specplane/config.yaml");
  git(r.root, "commit", "-q", "-m", "configure verification");
  const target = sha(r.root, "HEAD");
  const head = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /clean checkout of target/);
  assert.equal(sha(r.root, "HEAD"), target);
  assert.equal(sha(r.co, "HEAD"), head);
  assert.equal(fs.readFileSync(path.join(r.root, "base.txt"), "utf8"), "edited");
});

test("finish rejects a draft target lifecycle record", () => {
  const r = repo();
  const file = path.join(r.root, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: draft"));
  git(r.root, "commit", "-qam", "move target back to draft");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /target status draft/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("unattended finalization reports readiness without claiming finish", () => {
  const r = repo();
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Ready for finalization/);
  assert.doesNotMatch(result.out, /Finished/);
  assert.equal(sha(r.co, "HEAD"), before);
});

test("publication refuses a refreshed remote plan tracking ref after confirmation", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const remoteSeed = sha(r.root, "main");
  const action = `if (count === 2) { execFileSync("git", ["update-ref", "refs/remotes/origin/plan/${A}", ${JSON.stringify(remoteSeed)}]); }`;
  const result = finWithCallback(r, action);
  assert.equal(result.code, 1);
  assert.match(result.err, /refs\/remotes\/origin\/plan.*changed during operation/);
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
});

test("publication refuses a plan head moved during confirmation", () => {
  const r = repo({ remote: true, merge: "pull_request", planCfg: "  forge: none\n" });
  const action = `if (count === 2) { execFileSync("git", ["commit", "--allow-empty", "-m", "concurrent change"]); }`;
  const result = finWithCallback(r, action);
  assert.equal(result.code, 1);
  assert.match(result.err, /Plan changed during publication confirmation/);
  assert.equal(git(r.co, "log", "-1", "--format=%s"), "concurrent change");
  assert.equal(gitOk(r.origin, "show-ref", "--verify", "--quiet", `refs/heads/plan/${A}`), false);
});

test("failed local target push reports integrated commit and retry publishes without another merge", () => {
  const r = repo({ remote: true });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const result = finConfirmed(r);
  assert.equal(result.code, 1);
  assert.match(result.err, /was merged into main at [0-9a-f]+, but target publication failed/);
  const merged = sha(r.root, "HEAD");
  assert.equal(git(r.root, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  fs.unlinkSync(hook);
  const retry = fin(r, "--yes");
  assert.equal(retry.code, 0, retry.err);
  assert.equal(sha(r.root, "HEAD"), merged);
  assert.equal(sha(r.origin, "main"), merged);
  assert.equal(branchExists(r.root, `plan/${A}`), false);
});

test("finalization hook failure reports retained checkout for recovery", () => {
  const r = repo();
  const gitdir = git(r.co, "rev-parse", "--absolute-git-dir");
  const common = path.resolve(gitdir, git(r.co, "rev-parse", "--git-common-dir"));
  const hook = path.join(common, "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const before = sha(r.co, "HEAD");
  const result = finConfirmed(r);
  assert.equal(result.code, 1);
  assert.match(result.err, /Finalization failed; plan HEAD is .*Operation-owned finish edits were restored/);
  assert.equal(sha(r.co, "HEAD"), before);
  assert.equal(git(r.co, "status", "--porcelain"), "");
  assert.match(fs.readFileSync(path.join(r.co, "plans", A, "PLAN.md"), "utf8"), /status: ready/);
  fs.unlinkSync(hook);
});

test("failed PR creation reports the already-pushed plan head", () => {
  const { r, env, log } = ghRepo("  forge: github\n", "unused");
  const program = path.join(path.dirname(log), "gh");
  fs.writeFileSync(program, "#!/bin/sh\n[ \"$1\" = \"--version\" ] && exit 0\n[ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ] && { echo '[]'; exit 0; }\nexit 2\n", { mode: 0o755 });
  const result = finConfirmed(r, false, env);
  assert.equal(result.code, 1);
  const head = sha(r.co, "HEAD");
  assert.match(result.err, new RegExp(`Published plan/${A} at ${head}.*pull request creation failed`));
  assert.equal(sha(r.origin, `plan/${A}`), head);
});

test("finalized local retry after rebase requires renewed acceptance before merge", () => {
  const r = repo();
  const first = finWithCallback(r, "if (count === 2) return false;");
  assert.equal(first.code, 0, first.err);
  const done = sha(r.co, "HEAD");
  assert.match(git(r.co, "log", "-1", "--format=%s"), /finish/);
  fs.writeFileSync(path.join(r.root, "advance.txt"), "advanced\n");
  git(r.root, "add", "advance.txt");
  git(r.root, "commit", "-q", "-m", "advance target");
  const target = sha(r.root, "HEAD");
  const unattended = fin(r, "--yes");
  assert.equal(unattended.code, 0, unattended.err);
  assert.match(unattended.err, /ready for fresh finish acceptance/);
  assert.notEqual(sha(r.co, "HEAD"), done);
  assert.equal(sha(r.root, "HEAD"), target);
  const accepted = finConfirmed(r);
  assert.equal(accepted.code, 0, accepted.err);
  assert.match(accepted.out, /Finished and merged/);
});

test("failed review claim push is published on retry before finalization", () => {
  const r = repo({ remote: true, planCfg: "  status_source: frontmatter\n" });
  const hook = path.join(r.origin, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const failed = fin(r, "--yes");
  assert.equal(failed.code, 1);
  assert.match(failed.err, /Review claim [0-9a-f]+ remains on main; publication may be pending/);
  const claim = sha(r.root, "HEAD");
  assert.notEqual(sha(r.origin, "main"), claim);
  fs.unlinkSync(hook);
  const retry = fin(r, "--yes");
  assert.equal(retry.code, 0, retry.err);
  assert.equal(sha(r.origin, "main"), claim);
  assert.match(retry.out, /Ready for finalization/);
  assert.doesNotMatch(git(r.co, "log", "-1", "--format=%s"), /finish/);
});

test("finalization failure preserves unexpected hook edits for recovery", () => {
  const r = repo();
  const common = git(r.co, "rev-parse", "--git-common-dir");
  const hook = path.join(common, "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nprintf 'hook edit\\n' > base.txt\nexit 1\n", { mode: 0o755 });
  const result = finConfirmed(r);
  assert.equal(result.code, 1);
  assert.match(result.err, /Finish edits were retained because the checkout or index changed unexpectedly/);
  assert.equal(fs.readFileSync(path.join(r.co, "base.txt"), "utf8"), "hook edit\n");
  assert.notEqual(git(r.co, "status", "--porcelain"), "");
  fs.unlinkSync(hook);
});

test("finish rejects a branch lifecycle status incompatible with its status source", () => {
  const r = repo();
  const file = path.join(r.co, "plans", A, "PLAN.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: ready", "status: in_progress"));
  git(r.co, "commit", "-qam", "invalid branch status");
  const before = sha(r.co, "HEAD");
  const result = fin(r, "--yes");
  assert.equal(result.code, 1);
  assert.match(result.err, /plan status in_progress is not executable for git mode/);
  assert.equal(sha(r.co, "HEAD"), before);
});
