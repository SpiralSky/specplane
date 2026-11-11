import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomHex } from "../clock.js";
import { run } from "../git/exec.js";
import { storeDir } from "../repo/store.js";
import type { Project } from "../spec/project.js";
import { allTests, declarations, type RunDef, type TestDef } from "./tests.js";
import { writeLog, type LogMode } from "./logs.js";

/**
 * Running deterministic tests (`architecture/reference-cli` §10.2): every runnable test starts its argv without a shell
 * in a temporary detached checkout of HEAD, with a clean environment, a time limit and captured output.
 */

export type TestOutcome = "passed" | "failed" | "not-run";

export interface TestRunResult {
  test: string;
  spec: string;
  kind: "deterministic" | "intelligent";
  outcome: TestOutcome;
  /** One to a few lines: the failed expectation and the start of the difference, or why nothing ran. */
  summary: string;
  log?: string;
}

/** What to run: every spec, one spec, one section of it (`#<section>`), or one preamble test (`#T<n>`). */
export interface Selection { spec?: string; /** Several specs at once; used by the staged check. */ specs?: string[]; section?: string; label?: string }

export interface RunOptions {
  root: string;
  project: Project;
  selection: Selection;
  timeoutSec: number;
  logMode: LogMode;
  gitLogDir: string;
  /** Who runs, for the log header. */
  actor: string;
  commit: string;
  /** Test the index instead of `commit`: the checkout is `git checkout-index` into the temporary directory (`§14.2`). */
  staged?: boolean;
  /** Test hook: environment variables added to the clean environment. */
  extraEnv?: Record<string, string>;
}

export const DEFAULT_TIMEOUT_SEC = 120;
const OUTPUT_CAP = 1024 * 1024;
const DIFF_LINES = 5;

/** The tests a selection names, in spec and file order. Requirement files declare none. */
export function selectTests(project: Project, sel: Selection): TestDef[] {
  const out: TestDef[] = [];
  for (const doc of [...project.specs.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (doc.layer === "requirement" || (sel.spec && doc.id !== sel.spec) || (sel.specs && !sel.specs.includes(doc.id))) continue;
    let tests = allTests(declarations(doc));
    if (sel.label) tests = tests.filter((t) => t.sectionId === null && t.label === sel.label);
    else if (sel.section) tests = tests.filter((t) => t.sectionId === sel.section);
    out.push(...tests);
  }
  return out;
}

interface Captured { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }

/** Start `argv` without a shell; the environment is PATH, HOME, LANG and TMPDIR from the caller plus `SPECPLANE_TEST=1`. */
function exec(argv: string[], cwd: string, timeoutMs: number, extra: Record<string, string>): Promise<Captured> {
  const env: Record<string, string> = { SPECPLANE_TEST: "1", ...extra };
  for (const k of ["PATH", "HOME", "LANG", "TMPDIR"]) if (process.env[k] !== undefined) env[k] = process.env[k]!;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (c: Captured): void => { if (!settled) { settled = true; clearTimeout(timer); resolve(c); } };
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const take = (cur: string, d: Buffer): string => (cur.length >= OUTPUT_CAP ? cur : cur + d.toString("utf8").slice(0, OUTPUT_CAP - cur.length));
    child.stdout.on("data", (d: Buffer) => { stdout = take(stdout, d); });
    child.stderr.on("data", (d: Buffer) => { stderr = take(stderr, d); });
    child.on("error", (e) => done({ code: null, stdout, stderr, timedOut, spawnError: e.message }));
    child.on("close", (code) => done({ code, stdout, stderr, timedOut }));
  });
}

const head = (s: string): string => s.split("\n").slice(0, DIFF_LINES).join("\n");

/** The first failed expectation as a short summary, or null when all hold (`§10.2` step 3). */
export function checkExpect(def: RunDef, r: Captured): string | null {
  if (r.timedOut) return `timed out`;
  if (r.spawnError) return `could not start \`${def.run[0]}\`: ${r.spawnError}`;
  const e = def.expect;
  if (r.code !== e.exit) return `expected exit ${e.exit}, got ${r.code}${r.stderr.trim() ? `\n${head(r.stderr.trim())}` : ""}`;
  for (const s of e.stdoutContains) if (!r.stdout.includes(s)) return `stdout does not contain ${JSON.stringify(s)}\nstdout begins:\n${head(r.stdout)}`;
  for (const s of e.stderrContains) if (!r.stderr.includes(s)) return `stderr does not contain ${JSON.stringify(s)}\nstderr begins:\n${head(r.stderr)}`;
  if (e.stdoutEquals !== undefined && r.stdout.trimEnd() !== e.stdoutEquals.trimEnd()) return `stdout differs from the expected text\nexpected begins:\n${head(e.stdoutEquals)}\nactual begins:\n${head(r.stdout)}`;
  return null;
}

export interface RunReport {
  results: TestRunResult[];
  /** True when the working tree has changes, so the committed state is what was tested (`verification R36.2`). */
  dirty: boolean;
  warnings: string[];
}

function removeCheckout(root: string, dir: string): void {
  try { run("git", ["worktree", "remove", "--force", dir], { cwd: root }); } catch { /* fall through */ }
  fs.rmSync(dir, { recursive: true, force: true });
  try { run("git", ["worktree", "prune"], { cwd: root }); } catch { /* best effort */ }
}

/**
 * Run the selected tests. Intelligent tests, tests without a runnable definition and tests whose label is declared
 * twice are `not-run` with the reason; nothing is recorded here. The temporary checkout is created only when
 * something runs and is removed on success, failure and exit.
 */
export async function runTests(opts: RunOptions): Promise<RunReport> {
  const tests = selectTests(opts.project, opts.selection);
  const warnings: string[] = [];
  const results: TestRunResult[] = [];
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: opts.root }).trim() !== "";
  const runnable: TestDef[] = [];
  for (const t of tests) {
    const base = { test: t.id, spec: t.spec, kind: t.kind } as const;
    if (t.duplicate) results.push({ ...base, outcome: "not-run", summary: `label ${t.label} is declared twice in its section; its tests are not run` });
    else if (t.kind === "intelligent") results.push({ ...base, outcome: "not-run", summary: "intelligent test; needs a harness" });
    else if (t.blockError) results.push({ ...base, outcome: "not-run", summary: `invalid specplane-test block: ${t.blockError}` });
    else if (!t.def) results.push({ ...base, outcome: "not-run", summary: "not run: no runnable definition" });
    else runnable.push(t);
  }
  if (runnable.length) {
    const tmp = path.join(storeDir(opts.root), "tmp", `test-${randomHex(8)}`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    // An interrupt ends the process from the runner's handler; the exit hook still removes the checkout.
    const cleanup = (): void => removeCheckout(opts.root, tmp);
    process.on("exit", cleanup);
    try {
      if (opts.staged) {
        fs.mkdirSync(tmp, { recursive: true });
        run("git", ["checkout-index", "-a", "-f", `--prefix=${tmp}/`], { cwd: opts.root });
      } else run("git", ["worktree", "add", "--detach", tmp, opts.commit], { cwd: opts.root });
      for (const t of runnable) {
        const def = t.def!;
        const dir = path.join(tmp, def.cwd);
        const log: string[] = [`spec: ${t.spec}`, `test: ${t.id}`, `commit: ${opts.commit}`, `actor: ${opts.actor}`, ""];
        let failure: string | null = null;
        if (!fs.existsSync(dir)) failure = `cwd \`${def.cwd}\` does not exist in the checkout`;
        for (const argv of failure ? [] : [...def.setup, def.run]) {
          const isRun = argv === def.run;
          const c = await exec(argv, dir, opts.timeoutSec * 1000, opts.extraEnv ?? {});
          log.push(`$ ${argv.join(" ")}`, `exit: ${c.code}${c.timedOut ? " (timed out)" : ""}`, "--- stdout ---", c.stdout, "--- stderr ---", c.stderr, "");
          if (c.timedOut) { failure = `${isRun ? "" : "setup "}timed out after ${opts.timeoutSec}s`; break; }
          if (!isRun) {
            if (c.spawnError || c.code !== 0) { failure = `setup \`${argv.join(" ")}\` failed: ${c.spawnError ?? `exit ${c.code}`}`; break; }
          } else failure = checkExpect(def, c);
        }
        const logged = writeLog(opts.root, opts.logMode, opts.gitLogDir, log.join("\n"));
        const entry: TestRunResult = { test: t.id, spec: t.spec, kind: t.kind, outcome: failure ? "failed" : "passed", summary: failure ?? "all expectations met" };
        if (logged && "id" in logged) { entry.log = logged.id; if (logged.warning) warnings.push(logged.warning); }
        else if (logged) warnings.push(logged.error);
        results.push(entry);
      }
    } finally {
      process.removeListener("exit", cleanup);
      cleanup();
    }
  }
  const order = new Map(tests.map((t, i) => [t.id, i]));
  results.sort((a, b) => order.get(a.test)! - order.get(b.test)!);
  return { results, dirty, warnings };
}
