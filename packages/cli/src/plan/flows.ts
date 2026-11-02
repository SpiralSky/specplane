import { firstStart, type FirstStartOptions } from "./first-start.js";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { GitError, PlanNotFoundError, PlanStateError } from "../errors.js";
import { createPR } from "../git/forge.js";
import { branchExists, deleteBranch, rebaseOnto, remoteBranchExists } from "../git/branch.js";
import { cliTrailers, findLatest, formatMessage, readTrailers } from "../git/commit.js";
import { run } from "../git/exec.js";
import { defaultBranch, mainRoot } from "../git/repo.js";
import { listWorktrees } from "../git/worktree.js";
import type { Config, PlanStatus } from "../types.js";
import { fetchPlanBranches, getPlanActivity, hasRemote, lenientFrontmatter, showFile } from "./activity.js";
import { formatOpenGaps, parseGaps } from "./gaps.js";
import { listStepFiles, parseStep } from "./parse.js";
import { listPlans, planDir } from "./resolve.js";

export interface StartResult {
  planId: string;
  branch: string;
  backend: Config["execution"]["backend"];
  /** True when `plan/<id>` already existed. */
  resumed: boolean;
  /** Worktree path (worktree backend), otherwise null. */
  path: string | null;
  /** Compatibility field; the standalone CLI does not launch a host. */
  nextCommand: string | null;
  next: { number: number; title: string; status: string } | null;
  /** Messages for stderr (e.g. the base plan has merged). */
  notices: string[];
  dryRun?: boolean;
  target: string;
  startBase: string | null;
  freshness: string;
  target_branch: string;
  start_base: string | null;
  comparison_base: string | null;
  ref_freshness: string;
  legacy: boolean;
  checkoutCreated: boolean | null;
}

interface PlanAt {
  title: string;
  status: PlanStatus;
  specs: string[];
  depends_on: string[];
}

function tryRun(args: string[], cwd: string): string | null {
  try {
    return run("git", args, { cwd });
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

/** Plan frontmatter at `ref` (active, then archived); null when absent or malformed. */
function planAt(ref: string, id: string, config: Config, cwd: string): PlanAt | null {
  for (const dir of [`${config.plans.dir}/${id}`, `${config.plans.dir}/archive/${id}`]) {
    const text = showFile(ref, `${dir}/PLAN.md`, cwd);
    if (text === null) continue;
    const d = lenientFrontmatter(text);
    if (!d || d.id !== id || typeof d.status !== "string") return null;
    return {
      title: String(d.title ?? id),
      status: d.status as PlanStatus,
      specs: Array.isArray(d.specs) ? d.specs.map(String) : [],
      depends_on: Array.isArray(d.depends_on) ? d.depends_on.map(String) : [],
    };
  }
  return null;
}

/** Ref of the default branch tip: the local branch, or `origin/<default>` when that is strictly ahead. */
function defaultTip(def: string, cwd: string): string {
  if (!remoteBranchExists(def, cwd)) return def;
  if (!branchExists(def, cwd)) return `origin/${def}`;
  const behind = tryRun(["merge-base", "--is-ancestor", def, `origin/${def}`], cwd) !== null;
  const same = tryRun(["rev-parse", def], cwd)?.trim() === tryRun(["rev-parse", `origin/${def}`], cwd)?.trim();
  return behind && !same ? `origin/${def}` : def;
}

/** ID of the base plan `plan/<id>` is stacked on when that plan is now `done` on the default branch, else null. Read-only. */
export function mergedStackBase(id: string, config: Config, cwd: string, target?: string): string | null {
  const branch = `plan/${id}`;
  const marker = findLatest(branch, "stack", cwd);
  if (!marker) return null;
  const subject = run("git", ["log", "-1", "--format=%s", marker], { cwd }).trim();
  const baseId = /^chore\(specplane\): stack \S+ on (\S+)$/.exec(subject)?.[1];
  const tip = defaultTip(target ?? defaultBranch(cwd), cwd);
  if (baseId && planAt(tip, baseId, config, cwd)?.status === "done" && readTrailers(marker, cwd).has("Specplane-Stack-Base")) return baseId;
  return null;
}

function revParse(ref: string, cwd: string): string {
  return run("git", ["rev-parse", `${ref}^{commit}`], { cwd }).trim();
}

export type StartOptions = FirstStartOptions;

/**
 * `specplane plan start <id>` (feature/plan-execution § Start flow). All checks run before the first
 * write; `root` is the checkout the command runs in.
 */
export function startPlan(id: string, config: Config, root: string, opts: StartOptions = {}): StartResult {
  return firstStart(id, config, root, opts);
}

/** Claim commit on the default branch (architecture/reference-cli § Claim commits): sets `status: in_progress`. */
function claimPlan(id: string, planPath: string, def: string, remote: boolean, main: string, status = "in_progress"): void {
  const file = path.join(main, planPath);
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 3);
  const head = text.slice(0, end).replace(/^status:.*$/m, `status: ${status}`);
  fs.writeFileSync(file, head + text.slice(end));
  const msg = formatMessage({
    type: "chore",
    scope: "specplane",
    summary: `claim ${id} ${status}`,
    trailers: cliTrailers("claim", id),
  });
  run("git", ["commit", "-F", "-", "--", planPath], { cwd: main, input: msg });
  if (remote) run("git", ["push", "origin", def], { cwd: main });
}

export interface FinishOptions {
  /** Auto-confirm the local merge. */
  yes?: boolean;
  /** Asks the human to confirm the merge; absent means no human is available (unattended). */
  confirm?: (question: string) => Promise<boolean>;
  /** Commander sets this to false for `--no-fetch`. */
  fetch?: boolean;
}

export interface FinishResult {
  planId: string;
  /** What happened at step 6: `merged`, `pushed` (pull_request), or `ready` (merge not performed). */
  outcome: "merged" | "pushed" | "ready";
  prUrl: string | null;
  /** Human-readable lines for stderr (acceptance criteria, instructions). */
  notices: string[];
}

function git(args: string[], cwd: string): string {
  return run("git", args, { cwd }).trim();
}

function clean(cwd: string): boolean {
  return (tryRun(["status", "--porcelain", "--untracked-files=no"], cwd) ?? "").trim() === "";
}

/** Run `plans.test_command` in `cwd` (output to stderr); throws on a non-zero exit. */
function runTests(cmd: string, cwd: string): void {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: ["ignore", 2, 2] });
  if (r.error || r.status !== 0) {
    throw new PlanStateError(`Verification failed: \`${cmd}\` exited with code ${r.status ?? 1}. Fix failing tests before finishing.`);
  }
}

/** PR body built from the plan: summary line plus the acceptance criteria checklist. */
function prBody(id: string, title: string, criteria: string[]): string {
  const lines = [`Plan \`${id}\`: ${title}`];
  if (criteria.length > 0) lines.push("", "## Acceptance criteria", "", ...criteria);
  return lines.join("\n");
}

/** Acceptance-criteria checklist lines of a PLAN.md body. */
function acceptanceCriteria(text: string): string[] {
  const m = /^#{1,6}\s+Acceptance criteria\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im.exec(text);
  return m ? m[1].split("\n").filter((l) => /^\s*(?:[-*]|\d+\.)\s/.test(l)).map((l) => l.trim()) : [];
}

/**
 * `specplane plan finish <id>` (feature/plan-execution § Finish flow), run in the plan's checkout `root`.
 * Every readiness check runs before the first write. Re-running after the final commit resumes at the merge.
 */
export async function finishPlan(id: string, config: Config, root: string, opts: FinishOptions = {}): Promise<FinishResult> {
  const main = mainRoot(root);
  const def = defaultBranch(main);
  const remote = hasRemote(main);
  const branch = `plan/${id}`;
  const backend = config.execution.backend;
  const merge = config.plans.merge;
  const notices: string[] = [];
  const frontmatterMode = config.plans.status_source === "frontmatter";

  // 1. Readiness (no writes; fetch only updates remote-tracking refs).
  const dir = planDir(id, config, root);
  const cur = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  if (cur !== branch) throw new PlanStateError(`Cannot finish: the checkout is on \`${cur}\`, not \`${branch}\`.`);
  if (!clean(root)) throw new PlanStateError("Cannot finish: the working tree has uncommitted changes. Commit or stash them first.");
  for (const f of listStepFiles(dir)) {
    const s = parseStep(f).frontmatter;
    if (s.status !== "done" && s.status !== "skipped") {
      throw new PlanStateError(`Cannot finish: step ${String(s.step).padStart(2, "0")} is \`${s.status}\`.`);
    }
  }
  if (merge === "local_merge" && backend === "external") {
    throw new PlanStateError("Cannot finish: the `external` backend does not support `local_merge`.");
  }
  if (merge === "pull_request" && !remote) {
    throw new PlanStateError("Cannot finish: `merge: pull_request` needs a remote `origin` to push to.");
  }
  if (remote && opts.fetch !== false) run("git", ["fetch", "origin", def], { cwd: main });
  const tip = defaultTip(def, main);
  const planHere = planAt("HEAD", id, config, root);
  if (!planHere) throw new PlanNotFoundError(id);
  if (config.plans.dependency_mode === "stack") {
    for (const dep of planHere.depends_on) {
      if (planAt(tip, dep, config, main)?.status !== "done") throw new PlanStateError(`Cannot finish: dependency \`${dep}\` is not done.`);
    }
  }
  const alreadyDone = planHere.status === "done";
  const planPath = `${config.plans.dir}/${id}/PLAN.md`;
  const claimReview = frontmatterMode && backend !== "branch" && !alreadyDone && planAt(tip, id, config, main)?.status !== "review";
  if (claimReview) {
    const mainBranch = tryRun(["rev-parse", "--abbrev-ref", "HEAD"], main)?.trim();
    if (mainBranch !== def) {
      throw new PlanStateError(`Cannot claim plan \`${id}\`: the main checkout is on \`${mainBranch}\`, not \`${def}\`. Switch to \`${def}\` and run finish again.`);
    }
    if ((tryRun(["status", "--porcelain", "--", planPath], main) ?? "").trim() !== "") {
      throw new PlanStateError(`Cannot claim plan \`${id}\`: \`${planPath}\` has uncommitted changes in the main checkout. Commit or discard them and run finish again.`);
    }
  }

  // 2. Verify.
  const testCmd = config.plans.test_command.trim();
  if (!alreadyDone) {
    if (testCmd !== "") runTests(testCmd, root);
    const crit = acceptanceCriteria(fs.readFileSync(path.join(dir, "PLAN.md"), "utf8"));
    if (crit.length > 0) notices.push(`Acceptance criteria (confirm before merging):\n${crit.map((c) => `  ${c}`).join("\n")}`);
    const gapsFile = path.join(dir, "spec-gaps.md");
    if (fs.existsSync(gapsFile)) {
      const open = formatOpenGaps(parseGaps(gapsFile).entries);
      if (open.length > 0) notices.push(`Open spec gaps:\n${open.map((g) => `  ${g}`).join("\n")}`);
    }
  }

  // 3. Claim review (frontmatter mode).
  if (claimReview) claimPlan(id, planPath, def, remote, main, "review");

  // 4. Rebase onto the default branch (restack when stacked).
  const rebaseTip = defaultTip(def, main);
  const marker = findLatest(branch, "stack", root);
  const stackBase = marker ? readTrailers(marker, root).get("Specplane-Stack-Base")?.at(-1) : undefined;
  const before = git(["rev-parse", "HEAD"], root);
  rebaseOnto(rebaseTip, stackBase ?? rebaseTip, branch, root);
  if (git(["rev-parse", "HEAD"], root) !== before && testCmd !== "") runTests(testCmd, root);

  // 5. Final commit (the PLAN.md may move to the archive, so read the criteria first).
  const criteria = acceptanceCriteria(fs.readFileSync(path.join(dir, "PLAN.md"), "utf8"));
  if (!alreadyDone) finalCommit(id, config, root);

  // 6. Merge.
  let outcome: FinishResult["outcome"];
  let prUrl: string | null = null;
  if (merge === "pull_request") {
    run("git", ["push", "-u", "--force-with-lease", "origin", branch], { cwd: root });
    prUrl = createPR(branch, def, planHere.title, prBody(id, planHere.title, criteria), { cwd: root, forge: config.plans.forge });
    notices.push(
      prUrl ? `Opened pull request: ${prUrl}` : `Pushed \`${branch}\`. Open a pull request from \`${branch}\` into \`${def}\`, then run \`specplane plan cleanup ${id}\` after it merges.`,
    );
    outcome = "pushed";
  } else {
    const ok = opts.yes === true || (opts.confirm ? await opts.confirm(`Merge \`${branch}\` into \`${def}\` now?`) : false);
    if (!ok) {
      notices.push(`Plan \`${id}\` is ready to merge. Run \`specplane plan finish ${id}\` again to merge it.`);
      return { planId: id, outcome: "ready", prUrl, notices };
    }
    localMerge(id, branch, def, remote, backend, main);
    cleanupPlan(id, config, main);
    outcome = "merged";
  }
  return { planId: id, outcome, prUrl, notices };
}

/** Step 5: `status: done`, archive when configured, one `finish` commit. */
function finalCommit(id: string, config: Config, root: string): void {
  const dir = `${config.plans.dir}/${id}`;
  const file = path.join(root, dir, "PLAN.md");
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 3);
  fs.writeFileSync(file, text.slice(0, end).replace(/^status:.*$/m, "status: done") + text.slice(end));
  git(["add", "--", `${dir}/PLAN.md`], root);
  if (config.plans.archive_done) {
    const dest = `${config.plans.dir}/archive/${id}`;
    fs.mkdirSync(path.join(root, config.plans.dir, "archive"), { recursive: true });
    git(["mv", dir, dest], root);
  }
  const msg = formatMessage({ type: "chore", scope: "specplane", summary: `finish ${id}`, trailers: cliTrailers("finish", id) });
  run("git", ["commit", "-F", "-"], { cwd: root, input: msg });
}

/** Local merge in the main checkout (feature/plan-execution § Local merge). */
function localMerge(id: string, branch: string, def: string, remote: boolean, backend: Config["execution"]["backend"], main: string): void {
  const resume = `The done commit stays on \`${branch}\`; run \`specplane plan finish ${id}\` again after fixing it.`;
  if (backend === "branch") {
    // The main checkout is the plan checkout; it is clean after the final commit.
    run("git", ["switch", def], { cwd: main });
  }
  const mainBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], main);
  if (mainBranch !== def) {
    throw new PlanStateError(`Cannot merge plan \`${id}\`: the main checkout is on \`${mainBranch}\`, not \`${def}\`. Switch to \`${def}\`. ${resume}`);
  }
  if (!clean(main)) {
    throw new PlanStateError(`Cannot merge plan \`${id}\`: the main checkout has uncommitted changes. Commit or stash them. ${resume}`);
  }
  if (tryRun(["merge-base", "--is-ancestor", def, branch], main) === null) {
    throw new PlanStateError(`Cannot merge plan \`${id}\`: \`${def}\` moved after the rebase. Run \`specplane plan finish ${id}\` again to rebase.`);
  }
  run("git", ["merge", "--no-ff", "-m", `Merge ${branch}`, branch], { cwd: main });
  if (remote) run("git", ["push", "origin", def], { cwd: main });
}

/** Rewrite the `status:` line of a PLAN.md. */
function setStatus(file: string, status: string): void {
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 3);
  fs.writeFileSync(file, text.slice(0, end).replace(/^status:.*$/m, `status: ${status}`) + text.slice(end));
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

/** The separate worktree (not the main checkout) that has `branch` checked out, if any. */
function planWorktree(branch: string, main: string): string | null {
  return listWorktrees(main).find((w) => w.branch === branch && !samePath(w.path, main))?.path ?? null;
}

function requireCleanWorktree(wt: string | null, action: string, force: boolean): void {
  if (wt && !force && (tryRun(["status", "--porcelain"], wt) ?? "").trim() !== "") {
    throw new PlanStateError(`Cannot ${action}: the worktree at \`${wt}\` has uncommitted changes. Commit or stash them, or use \`--force\`.`);
  }
}

function dropWorktree(wt: string, force: boolean, main: string): void {
  run("git", ["worktree", "remove", ...(force ? ["--force"] : []), wt], { cwd: main });
}

export interface CleanupResult {
  planId: string;
  worktreeRemoved: boolean;
  branchSwitched: boolean;
  branchDeleted: boolean;
}

/**
 * `specplane plan cleanup <id>` (feature/tooling): remove the worktree (or leave the branch checkout) and delete
 * `plan/<id>` only when the plan is `done` on the default branch. Each part is skipped when already done.
 */
export function cleanupPlan(id: string, config: Config, root: string, opts: { force?: boolean } = {}): CleanupResult {
  const main = mainRoot(root);
  const def = defaultBranch(main);
  const branch = `plan/${id}`;
  if (hasRemote(main)) run("git", ["fetch", "origin", def], { cwd: main });
  const tip = defaultTip(def, main);
  const plan = planAt(tip, id, config, main);
  const hasBranch = branchExists(branch, main);
  if (!plan && !hasBranch) throw new PlanNotFoundError(id);
  const result: CleanupResult = { planId: id, worktreeRemoved: false, branchSwitched: false, branchDeleted: false };
  if (!hasBranch) return result;
  if (plan?.status !== "done") {
    throw new PlanStateError(`Cannot clean up plan: \`${id}\` is \`${plan?.status ?? "unknown"}\`, not \`done\` on \`${def}\`; \`${branch}\` is kept.`);
  }

  // Validate before any write.
  const wt = planWorktree(branch, main);
  requireCleanWorktree(wt, "clean up plan", opts.force === true);
  const onBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], main) === branch;
  if (onBranch && !clean(main)) {
    throw new PlanStateError(`Cannot clean up plan: the checkout has uncommitted changes on \`${branch}\`. Commit or stash them first.`);
  }

  if (wt) {
    dropWorktree(wt, opts.force === true, main);
    result.worktreeRemoved = true;
  }
  if (onBranch) {
    run("git", ["switch", def], { cwd: main });
    result.branchSwitched = true;
  }
  deleteBranch(branch, main);
  result.branchDeleted = true;
  return result;
}

export interface AbandonOptions {
  deleteBranch?: boolean;
  force?: boolean;
}

export interface AbandonResult {
  planId: string;
  committed: boolean;
  archived: boolean;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
}

/** `specplane plan abandon <id>` (feature/plan-execution § Abandoning a plan). Re-running finishes any leftover steps. */
export function abandonPlan(id: string, config: Config, root: string, opts: AbandonOptions = {}): AbandonResult {
  const main = mainRoot(root);
  const def = defaultBranch(main);
  const branch = `plan/${id}`;
  const rec = listPlans(config, main).find((p) => p.id === id);
  if (!rec) throw new PlanNotFoundError(id);
  const status = String(lenientFrontmatter(fs.readFileSync(rec.planFile, "utf8"))?.status ?? "unknown");
  if (status === "done" || status === "abandoned") {
    throw new PlanStateError(`Cannot abandon plan: \`${id}\` is \`${status}\`.`);
  }
  const relDir = path.relative(main, rec.dir);
  const archiveRel = `${config.plans.dir}/archive/${id}`;
  const moves = config.plans.archive_done && !rec.archived;

  // 1. Validate.
  const wt = planWorktree(branch, main);
  requireCleanWorktree(wt, "abandon plan", opts.force === true);
  const cur = git(["rev-parse", "--abbrev-ref", "HEAD"], main);
  if (cur !== def) {
    throw new PlanStateError(`Cannot abandon plan \`${id}\`: the main checkout is on \`${cur}\`, not \`${def}\`. Switch to \`${def}\` and run abandon again.`);
  }
  if ((tryRun(["status", "--porcelain", "--", relDir], main) ?? "").trim() !== "") {
    throw new PlanStateError(`Cannot abandon plan \`${id}\`: \`${relDir}\` has uncommitted changes in the main checkout. Commit or discard them and run abandon again.`);
  }
  if (moves && fs.existsSync(path.join(main, archiveRel))) {
    throw new PlanStateError(`Cannot abandon plan \`${id}\`: \`${archiveRel}\` already exists.`);
  }

  // 2. Write.
  const result: AbandonResult = { planId: id, committed: false, archived: false, worktreeRemoved: false, branchDeleted: false };
  setStatus(rec.planFile, "abandoned");
  const paths = [relDir];
  if (moves) {
    fs.mkdirSync(path.join(main, config.plans.dir, "archive"), { recursive: true });
    git(["add", "--", relDir], main);
    git(["mv", relDir, archiveRel], main);
    paths.push(archiveRel);
    result.archived = true;
  }
  const msg = formatMessage({ type: "chore", scope: "specplane", summary: `abandon ${id}`, trailers: cliTrailers("abandon", id) });
  run("git", ["commit", "-F", "-", "--", ...paths], { cwd: main, input: msg });
  result.committed = true;
  if (hasRemote(main)) run("git", ["push", "origin", def], { cwd: main });
  if (wt) {
    dropWorktree(wt, opts.force === true, main);
    result.worktreeRemoved = true;
  }
  if (opts.deleteBranch && branchExists(branch, main)) {
    deleteBranch(branch, main);
    result.branchDeleted = true;
  }
  return result;
}

export interface ArchiveResult {
  planId: string;
  to: string;
}

/** `specplane plan archive <id>`: move a `done` or `abandoned` plan into the archive, in the current checkout. */
export function archivePlan(id: string, config: Config, root: string): ArchiveResult {
  const rec = listPlans(config, root).find((p) => p.id === id);
  if (!rec) throw new PlanNotFoundError(id);
  if (rec.archived) throw new PlanStateError(`Cannot archive plan: \`${id}\` is already archived.`);
  const status = String(lenientFrontmatter(fs.readFileSync(rec.planFile, "utf8"))?.status ?? "unknown");
  if (status !== "done" && status !== "abandoned") {
    throw new PlanStateError(`Cannot archive plan: \`${id}\` is \`${status}\`, not \`done\` or \`abandoned\`.`);
  }
  const relDir = path.relative(root, rec.dir);
  const dest = `${config.plans.dir}/archive/${id}`;
  if (fs.existsSync(path.join(root, dest))) throw new PlanStateError(`Cannot archive plan: \`${dest}\` already exists.`);
  if ((tryRun(["status", "--porcelain", "--", relDir], root) ?? "").trim() !== "") {
    throw new PlanStateError(`Cannot archive plan: \`${relDir}\` has uncommitted changes. Commit or discard them first.`);
  }
  fs.mkdirSync(path.join(root, config.plans.dir, "archive"), { recursive: true });
  git(["mv", relDir, dest], root);
  const msg = formatMessage({ type: "chore", scope: "specplane", summary: `archive ${id}`, trailers: cliTrailers("archive", id) });
  run("git", ["commit", "-F", "-", "--", relDir, dest], { cwd: root, input: msg });
  return { planId: id, to: dest };
}

export interface RestackResult {
  planId: string;
  /** `restacked` (history rewritten), `current` (nothing to do), or `dry-run`. */
  outcome: "restacked" | "current" | "dry-run";
  /** Ref the branch was (or would be) rebased onto. */
  onto: string;
  /** True when the base plan has merged and the plan is no longer stacked. */
  unstacked: boolean;
  /** Commits a dry run would replay, oldest first (empty for other outcomes). */
  commits: { sha: string; subject: string }[];
}

/** Commits in `<upstream>..plan/<id>`, oldest first, without stack marker commits. */
function commitsToReplay(branch: string, upstream: string, cwd: string): { sha: string; subject: string }[] {
  const shas = run("git", ["rev-list", "--reverse", `${upstream}..${branch}`], { cwd }).trim().split("\n").filter(Boolean);
  return shas
    .map((sha) => ({ sha, subject: run("git", ["log", "-1", "--format=%s", sha], { cwd }).trim(), marker: readTrailers(sha, cwd).get("Specplane-Workflow")?.at(-1) === "stack" }))
    .filter((c) => !c.marker)
    .map(({ sha, subject }) => ({ sha: sha.slice(0, 7), subject }));
}

/**
 * `specplane plan restack <id>` (architecture/reference-cli § Restack): replay only the branch's own commits
 * (those after the latest stack marker's recorded base) onto the new base. Conflicts abort the rebase.
 */
export function restackPlan(id: string, config: Config, root: string, opts: { dryRun?: boolean } = {}): RestackResult {
  const main = mainRoot(root);
  const def = defaultBranch(main);
  const branch = `plan/${id}`;
  if (hasRemote(main)) {
    run("git", ["fetch", "origin", def], { cwd: main });
    fetchPlanBranches(main);
  }
  if (!branchExists(branch, main)) {
    if (!planAt(defaultTip(def, main), id, config, main)) throw new PlanNotFoundError(id);
    throw new PlanStateError(`Cannot restack: \`${id}\` is not stacked.`);
  }
  const marker = findLatest(branch, "stack", main);
  const upstream = marker ? readTrailers(marker, main).get("Specplane-Stack-Base")?.at(-1) : undefined;
  if (!marker || !upstream) throw new PlanStateError(`Cannot restack: \`${id}\` is not stacked.`);
  const subject = run("git", ["log", "-1", "--format=%s", marker], { cwd: main }).trim();
  const baseId = /^chore\(specplane\): stack \S+ on (\S+)$/.exec(subject)?.[1];
  if (!baseId) throw new PlanStateError(`Cannot restack: the stack marker of \`${id}\` does not name a base plan.`);

  const tip = defaultTip(def, main);
  const merged = planAt(tip, baseId, config, main)?.status === "done";
  let newBase = tip;
  if (!merged) {
    const baseBranch = `plan/${baseId}`;
    newBase = branchExists(baseBranch, main) ? baseBranch : remoteBranchExists(baseBranch, main) ? `origin/${baseBranch}` : "";
    if (newBase === "") throw new PlanStateError(`Cannot restack: base plan \`${baseId}\` has no branch and is not done on \`${def}\`.`);
  }
  const newBaseSha = revParse(newBase, main);
  if (!merged && newBaseSha === upstream) return { planId: id, outcome: "current", onto: newBase, unstacked: false, commits: [] };

  const checkout = planWorktree(branch, main) ?? (git(["rev-parse", "--abbrev-ref", "HEAD"], main) === branch ? main : null);
  if (!checkout) {
    throw new PlanStateError(`Cannot restack: \`${branch}\` is not checked out. Run \`specplane plan start ${id}\` first.`);
  }
  if (!clean(checkout)) throw new PlanStateError("Cannot restack: the working tree has uncommitted changes. Commit or stash them first.");
  if (opts.dryRun) {
    return { planId: id, outcome: "dry-run", onto: newBase, unstacked: merged, commits: commitsToReplay(branch, upstream, main) };
  }

  // Unlike finish, a conflict leaves the checkout mid-rebase for the human (`feature/tooling`).
  rebaseOnto(newBase, upstream, branch, checkout, { onConflict: "leave" });
  // A new marker: the next base while stacked, or a marker without a base once the plan is on the default branch.
  const trailers = { ...cliTrailers("stack", id), ...(merged ? {} : { "Specplane-Stack-Base": newBaseSha }) };
  const msg = formatMessage({
    type: "chore",
    scope: "specplane",
    summary: merged ? `unstack ${id} from ${baseId}` : `stack ${id} on ${baseId}`,
    trailers,
  });
  run("git", ["commit", "--allow-empty", "-F", "-"], { cwd: checkout, input: msg });
  return { planId: id, outcome: "restacked", onto: newBase, unstacked: merged, commits: [] };
}
