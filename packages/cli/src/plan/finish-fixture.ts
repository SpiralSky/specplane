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
import { startFixture } from "./setup-fixture.js";

interface Opts {
  planCfg?: string;
  exec?: string;
  remote?: boolean;
  steps?: string[];
  planStatus?: string;
  merge?: string;
  target?: string;
}

interface R { root: string; wt: string; origin: string; co: string }

/** Each test file owns its repositories, environment and cleanup. */
export function createFinishFixture() {
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

  const ownedDirs: string[] = [];

  after(() => { for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true }); });

  /** Repo on `main`, plan started through the real API, then steps committed on its branch. */
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
    startFixture(root, A, ENV, o.target ? { target: o.target } : {});
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
      let count = 0; try { const result = await finishPlan(process.argv[1], loadConfig(process.cwd()).config, process.cwd(), { confirm: async q => { count++; ${callbackBody} return true; } }); console.log(result.outcome); }
      catch (e) { console.error(String(e)); process.exitCode = 1; }`;
    const x = spawnSync(process.execPath, ["--input-type=module", "-e", script, A], { cwd: r.co, encoding: "utf8", env: ENV });
    return { code: x.status, out: x.stdout, err: x.stderr };
  };

  const sha = (cwd: string, ref: string) => git(cwd, "rev-parse", ref);

  const branchExists = (root: string, b: string) => gitOk(root, "show-ref", "--verify", "--quiet", `refs/heads/${b}`);

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
  return { cli, ENV, git, gitOk, sp, A, planMd, stepMd, ownedDirs, repo, fin, finConfirmed, finWithCallback, sha, branchExists, ghRepo, finEnv };
}
