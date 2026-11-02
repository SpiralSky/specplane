import { randomUUID } from "node:crypto";
import { acquireWriterLease } from "../core/writer-leases.js";
import { lifecycleContext, checkStackTarget, recheckLifecycleRefs, requireStackIntegration } from "./lifecycle-context.js";
import { resolveCommit } from "./context.js";
import { isDeepStrictEqual } from "node:util";
import { planAt as validatedPlanAt } from "./prepare-start.js";
import { firstStart, type FirstStartOptions } from "./first-start.js";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { GitError, PlanNotFoundError, PlanStateError } from "../errors.js";
import { createPR, matchingOpenPR } from "../git/forge.js";
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
  const stored = readTrailers(marker, cwd).get("Specplane-Stack-Base")?.at(-1);
  if (baseId && stored && planAt(tip, baseId, config, cwd)?.status === "done") {
    try { requireStackIntegration(baseId, target ?? defaultBranch(cwd), revParse(tip, cwd), resolveCommit(cwd, stored, true), config, cwd, {}); return baseId; } catch { /* A declaration alone is not a merge. */ }
  }
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
  /** Accepted for CLI compatibility; local merge requires a state-specific confirmation callback. */
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
  /** Whether the finish commit exists when reporting readiness. */
  finalized?: boolean;
  /** Human-readable lines for stderr (acceptance criteria, instructions). */
  notices: string[];
}

function git(args: string[], cwd: string): string {
  return run("git", args, { cwd }).trim();
}

function clean(cwd: string): boolean {
  return tryRun(["status", "--porcelain"], cwd)?.trim() === "";
}

function ignoredFiles(cwd: string): string[] {
  return run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], { cwd }).split("\0").filter(Boolean);
}

function protectIgnoredCollisions(cwd: string, from: string, to: string, upstream?: string): void {
  const ignored = ignoredFiles(cwd);
  if (!ignored.length) return;
  const changes = run("git", ["diff", "--name-only", "--diff-filter=ACMRT", "-z", from, to], { cwd }).split("\0").filter(Boolean);
  if (upstream) {
    // Rebase checks out the new base and then replays each commit. A path can
    // disappear from both endpoint trees yet still be overwritten mid-replay.
    const commits = git(["rev-list", `${upstream}..${from}`], cwd).split("\n").filter(Boolean);
    for (const commit of commits) {
      changes.push(...run("git", ["diff-tree", "--root", "-m", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", commit], { cwd }).split("\0").filter(Boolean));
    }
  }
  const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const collision = ignored.find(a => changes.some(b => overlaps(a, b)));
  if (collision) throw new PlanStateError(`Ignored file \`${collision}\` conflicts with the checkout update; preserve or move it before retrying.`);
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
  const trees = listWorktrees(main);
  const planIds = git(["for-each-ref", "--format=%(refname)", "refs/heads/plan/", "refs/remotes/origin/plan/"], main).split("\n").map(x => x.replace(/^refs\/(?:heads|remotes\/origin)\/plan\//, "")).filter(Boolean);
  const lease = acquireWriterLease({ repository: true, plans: [id, ...planIds], checkouts: trees.filter(w => !w.bare).map(w => w.path), requestId: `finish-${randomUUID()}` });
  try {
  const remote = hasRemote(main);
  if (remote && opts.fetch !== false) run("git", ["fetch", "origin", "+refs/heads/*:refs/remotes/origin/*"], { cwd: main });
  let p = lifecycleContext(id, config, root);
  if (remote && opts.fetch !== false) {
    run("git", ["fetch", "origin", p.context.targetBranch], { cwd: main });
    p = lifecycleContext(id, config, root);
  }
  if (JSON.stringify(trees) !== JSON.stringify(listWorktrees(main))) throw new PlanStateError("Checkout set changed during preparation; retry.");
  if (p.context.targetBranch.startsWith("plan/") && !planIds.includes(p.context.targetBranch.slice(5))) throw new PlanStateError("Target plan appeared during fetch; retry to acquire its lease.");
  config = p.config;
  const def = p.context.targetBranch;
  const targetTree = trees.find(w => w.branch === def)?.path;
  const canSwitch = config.execution.backend === "branch" && !targetTree && tryRun(["rev-parse", "--verify", `refs/heads/${def}^{commit}`], main)?.trim() === p.context.targetCommit;
  const branch = `plan/${id}`;
  const backend = config.execution.backend;
  const merge = config.plans.merge;
  const notices: string[] = [];
  const frontmatterMode = config.plans.status_source === "frontmatter";

  // A previous merge may have succeeded even though its target push failed.
  if (p.target.status === "done") {
    const reviewed = git(["rev-parse", `refs/heads/${branch}`], main);
    const registered = trees.find(w => w.branch === branch && !w.bare);
    const switchedBranchBackend = backend === "branch" && !registered && samePath(root, main) && samePath(root, targetTree ?? "") && git(["rev-parse", "--abbrev-ref", "HEAD"], root) === def;
    if (!switchedBranchBackend && (!registered || !samePath(registered.path, root) || git(["rev-parse", "--abbrev-ref", "HEAD"], root) !== branch || git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)))
      throw new PlanStateError(`Recovery requires the clean registered checkout of \`${branch}\` at its recorded head.`);
    const finishTrailers = readTrailers(reviewed, main);
    if (merge !== "local_merge" || p.plan.status !== "done" || finishTrailers.get("Specplane-Workflow")?.at(-1) !== "finish" || finishTrailers.get("Specplane-Plan")?.at(-1) !== id || !targetTree || git(["rev-parse", "HEAD"], targetTree) !== p.context.targetCommit || !clean(targetTree) || tryRun(["merge-base", "--is-ancestor", reviewed, p.context.targetCommit], main) === null)
      throw new PlanStateError("Target is done without evidence of this plan head being integrated; reconcile before retrying.");
    lease.assertOwned(); recheckLifecycleRefs(main, p.refs);
    if (remote && p.refs[`refs/remotes/origin/${def}`] !== p.context.targetCommit) {
      const challenge = `Publish recovered \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${p.context.targetCommit}\` now?`;
      if (!opts.confirm || !await opts.confirm(challenge)) return { planId: id, outcome: "ready", prUrl: null, finalized: true, notices: [`Integrated target \`${def}\` at \`${p.context.targetCommit}\` awaits publication confirmation.`] };
      lease.assertOwned(); recheckLifecycleRefs(main, p.refs);
      if (JSON.stringify(trees) !== JSON.stringify(listWorktrees(main)) || git(["rev-parse", "--abbrev-ref", "HEAD"], targetTree) !== def || git(["rev-parse", "HEAD"], targetTree) !== p.context.targetCommit || !clean(targetTree) || revParse(branch, main) !== reviewed) throw new PlanStateError("Integrated target or checkout changed during publication confirmation; retry.");
      try { run("git", ["push", "origin", def], { cwd: targetTree }); }
      catch (e) { throw new PlanStateError(`Plan ${branch} is integrated at ${p.context.targetCommit}, but target publication failed; retry after resolving the push: ${String(e)}`); }
    }
    lease.assertOwned();
    if (JSON.stringify(trees) !== JSON.stringify(listWorktrees(main)) || revParse(branch, main) !== reviewed || (!switchedBranchBackend && (git(["rev-parse", "--abbrev-ref", "HEAD"], root) !== branch || git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root))))
      throw new PlanStateError("Integrated plan checkout changed before cleanup; retain it for recovery.");
    const recoveryNotices = [`Recovered integrated plan at ${p.context.targetCommit}.`];
    if (registered && !samePath(root, main) && ignoredFiles(root).length === 0) { dropWorktree(registered.path, false, main); deleteBranch(branch, main); }
    else recoveryNotices.push("Plan checkout retained because it is the main checkout or contains ignored files; inspect it before explicit cleanup.");
    return { planId: id, outcome: "merged", prUrl: null, notices: recoveryNotices };
  }

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
  const tip = p.context.targetCommit;
  const planHere = planAt("HEAD", id, config, root);
  if (!planHere) throw new PlanNotFoundError(id);
  if (config.plans.dependency_mode === "stack") {
    for (const dep of planHere.depends_on) {
      if (planAt(tip, dep, config, main)?.status !== "done") throw new PlanStateError(`Cannot finish: dependency \`${dep}\` is not done.`);
    }
  }
  const alreadyDone = planHere.status === "done";
  if (alreadyDone) {
    const trailers = readTrailers("HEAD", root);
    if (trailers.get("Specplane-Workflow")?.at(-1) !== "finish" || trailers.get("Specplane-Plan")?.at(-1) !== id) throw new PlanStateError("Done plan branch has no matching finish commit; reconcile its lifecycle state before retrying.");
  }
  const planPath = `${config.plans.dir}/${id}/PLAN.md`;
  const claimReview = frontmatterMode && !alreadyDone && planAt(tip, id, config, main)?.status !== "review";
  const requireAdmin = claimReview || merge === "local_merge" || (!!targetTree && git(["rev-parse", "HEAD"], targetTree) === tip);
  function checkAdmin(expected: string): void {
    if (requireAdmin && !(canSwitch && !claimReview) && (!targetTree || git(["rev-parse", "--abbrev-ref", "HEAD"], targetTree) !== def || git(["rev-parse", "HEAD"], targetTree) !== expected || !clean(targetTree))) throw new PlanStateError(`A clean checkout of target \`${def}\` at the selected target commit is required; preserve its changes and retry.`);
  }
  checkAdmin(tip);
  if (claimReview) {
    const mainBranch = tryRun(["rev-parse", "--abbrev-ref", "HEAD"], targetTree!)?.trim();
    if (mainBranch !== def) {
      throw new PlanStateError(`Cannot claim plan \`${id}\`: the main checkout is on \`${mainBranch}\`, not \`${def}\`. Switch to \`${def}\` and run finish again.`);
    }
    if ((tryRun(["status", "--porcelain", "--", planPath], targetTree!) ?? "").trim() !== "") {
      throw new PlanStateError(`Cannot claim plan \`${id}\`: \`${planPath}\` has uncommitted changes in the main checkout. Commit or discard them and run finish again.`);
    }
  }

  const markerPre = findLatest(branch, "stack", root);
  const storedStackBase = markerPre ? readTrailers(markerPre, root).get("Specplane-Stack-Base")?.at(-1) : undefined;
  const stackBase = storedStackBase === undefined ? undefined : resolveCommit(root, storedStackBase, true);
  if (markerPre && readTrailers(markerPre, root).has("Specplane-Stack-Base")) {
    const subject = git(["log", "-1", "--format=%s", markerPre], root);
    const baseId = /^chore\(specplane\): stack \S+ on (\S+)$/.exec(subject)?.[1];
    if (!baseId) throw new PlanStateError("Stack dependency is missing.");
    if (planIds.includes(baseId)) checkStackTarget(baseId, def, config, main, p.refs);
    else {
      const base = validatedPlanAt(main, tip, config, baseId);
      if (base?.status !== "done" || base.execution?.target_branch !== def) throw new PlanStateError("Stack dependency lacks compatible recorded target.");
    }
    requireStackIntegration(baseId, def, tip, stackBase!, config, main, p.refs);
  }
  lease.assertOwned(); recheckLifecycleRefs(main, p.refs);
  const existingPR = merge === "pull_request" ? matchingOpenPR(branch, def, { cwd: root, forge: config.plans.forge }) : null;
  // Publish an already-created review claim before treating it as complete.
  if (frontmatterMode && remote && p.target.status === "review" && p.refs[`refs/remotes/origin/${def}`] !== tip) {
    const trailers = readTrailers(tip, main);
    if (trailers.get("Specplane-Workflow")?.at(-1) !== "claim" || trailers.get("Specplane-Plan")?.at(-1) !== id || !targetTree || !clean(targetTree) || git(["rev-parse", "HEAD"], targetTree) !== tip) throw new PlanStateError("Unpublished target review state requires reconciliation before finish.");
    lease.assertOwned(); recheckLifecycleRefs(main, p.refs);
    try { run("git", ["push", "origin", def], { cwd: targetTree }); }
    catch (e) { throw new PlanStateError(`Review claim ${tip} remains unpublished; retry after resolving the push: ${String(e)}`); }
    p.refs[`refs/remotes/origin/${def}`] = tip;
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
  lease.assertOwned(); recheckLifecycleRefs(main, p.refs); checkAdmin(tip);
  if (!clean(root)) throw new PlanStateError("Plan checkout changed during verification; retry.");
  if (claimReview) {
    try { claimPlan(id, planPath, def, remote, targetTree!, "review"); }
    catch (e) {
      const current = tryRun(["rev-parse", "HEAD"], targetTree!)?.trim();
      throw new PlanStateError(current && current !== tip ? `Review claim ${current} remains on ${def}; publication may be pending. Inspect and retry: ${String(e)}` : `Review claim failed; inspect the target checkout and index before retrying: ${String(e)}`);
    }
    p.refs[`refs/heads/${def}`] = revParse(`refs/heads/${def}`, main);
    if (remote) p.refs[`refs/remotes/origin/${def}`] = tryRun(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${def}^{commit}`], main)?.trim() ?? null;
  }

  // 4. Rebase onto the default branch (restack when stacked).
  const rebaseTip = claimReview ? git(["rev-parse", "HEAD"], targetTree!) : tip;
  const before = git(["rev-parse", "HEAD"], root);
  protectIgnoredCollisions(root, before, rebaseTip, stackBase ?? rebaseTip);
  rebaseOnto(rebaseTip, stackBase ?? rebaseTip, branch, root);
  const rebased = git(["rev-parse", "HEAD"], root) !== before;
  if (rebased && testCmd !== "") runTests(testCmd, root);
  const afterRebase = validatedPlanAt(root, "HEAD", config, id);
  if (!afterRebase || !isDeepStrictEqual(afterRebase.execution, p.context.binding) || (afterRebase.comparison_base ?? null) !== p.context.comparisonBase) throw new PlanStateError("Rebase changed execution provenance; recovery is required.");

  lease.assertOwned();
  const targetRefs = Object.fromEntries(Object.entries(p.refs).filter(([name]) => name !== `refs/heads/${branch}` && name !== `refs/remotes/origin/${branch}`));
  recheckLifecycleRefs(main, targetRefs);
  // 5. Final commit (the PLAN.md may move to the archive, so read the criteria first).
  const criteria = acceptanceCriteria(fs.readFileSync(path.join(dir, "PLAN.md"), "utf8"));
  const gapsFile = path.join(dir, "spec-gaps.md");
  const openGaps = fs.existsSync(gapsFile) ? formatOpenGaps(parseGaps(gapsFile).entries) : [];
  const gapsNotice = openGaps.length ? `Open spec gaps:\n${openGaps.map(g => `  ${g}`).join("\n")}` : null;
  if (alreadyDone) {
    const reviewed = git(["rev-parse", "HEAD"], root);
    const challenge = [...(criteria.length ? [`Acceptance criteria:\n${criteria.join("\n")}`] : []), ...(gapsNotice ? [gapsNotice] : []), `Accept finish \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
    if (!opts.confirm || !await opts.confirm(challenge)) {
      notices.push(`Plan \`${id}\` is ready for fresh finish acceptance: head \`${reviewed}\`, target \`${def}\` at \`${rebaseTip}\`.`);
      return { planId: id, outcome: "ready", prUrl: null, finalized: alreadyDone, notices };
    }
    lease.assertOwned(); recheckLifecycleRefs(main, targetRefs); checkAdmin(rebaseTip);
    if (git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)) throw new PlanStateError("Plan changed during finish acceptance; retry.");
  } else {
    const reviewed = git(["rev-parse", "HEAD"], root);
    const challenge = [...notices, `Finalize \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
    const approved = opts.confirm ? await opts.confirm(challenge) : false;
    if (!approved) {
      notices.push(`Plan \`${id}\` is ready to merge after interactive finalization: head \`${reviewed}\`, target \`${def}\` at \`${rebaseTip}\`.`);
      return { planId: id, outcome: "ready", prUrl: null, finalized: false, notices };
    }
    lease.assertOwned(); recheckLifecycleRefs(main, targetRefs);
    if (git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)) throw new PlanStateError("Plan changed during finalization confirmation; retry.");
    checkAdmin(rebaseTip);
    try { finalCommit(id, config, root); }
    catch (e) { const head = git(["rev-parse", "HEAD"], root); throw new PlanStateError(`Finalization failed; plan HEAD is ${head}. Inspect the plan checkout and index before retrying: ${String(e)}`); }
    const finalHead = git(["rev-parse", "HEAD"], root);
    const finalParents = git(["rev-list", "--parents", "-n", "1", finalHead], root).split(" ");
    const finalTrailers = readTrailers(finalHead, root);
    if (finalParents.length !== 2 || finalParents[1] !== reviewed || finalTrailers.get("Specplane-Workflow")?.at(-1) !== "finish" || finalTrailers.get("Specplane-Plan")?.at(-1) !== id || !clean(root)) throw new PlanStateError(`Finalization produced unexpected state at ${finalHead}; inspect the plan checkout before retrying.`);
  }

  // 6. Merge.
  let outcome: FinishResult["outcome"];
  let prUrl: string | null = null;
  if (merge === "pull_request") {
    // Confirm the actual publication head, including on retries: no durable
    // state-bound acceptance receipt exists.
    const publicationReviewed = git(["rev-parse", "HEAD"], root);
    {
      const reviewed = publicationReviewed;
      const challenge = [...(criteria.length ? [`Acceptance criteria (confirm before publishing):\n${criteria.map(c => `  ${c}`).join("\n")}`] : []), ...(gapsNotice ? [gapsNotice] : []), `Publish \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
      if (!opts.confirm || !await opts.confirm(challenge)) {
        notices.push(`Plan \`${id}\` is ready for publication after interactive confirmation: head \`${reviewed}\`, target \`${def}\` at \`${rebaseTip}\`.`);
        return { planId: id, outcome: "ready", prUrl: null, finalized: true, notices };
      }
      lease.assertOwned(); recheckLifecycleRefs(main, targetRefs);
      if (git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)) throw new PlanStateError("Plan changed during publication confirmation; retry.");
      checkAdmin(rebaseTip);
    }
    lease.assertOwned(); recheckLifecycleRefs(main, targetRefs);
    if (matchingOpenPR(branch, def, { cwd: root, forge: config.plans.forge }) !== existingPR) throw new PlanStateError("Pull request state changed during finish; retry.");
    const publicationHead = publicationReviewed;
    if (git(["rev-parse", "HEAD"], root) !== publicationHead || git(["rev-parse", `refs/heads/${branch}`], root) !== publicationHead || !clean(root)) throw new PlanStateError("Publication head or checkout changed; retry.");
    recheckLifecycleRefs(main, { [`refs/remotes/origin/${branch}`]: p.refs[`refs/remotes/origin/${branch}`] });
    const expectedRemote = p.refs[`refs/remotes/origin/${branch}`] ?? "";
    try { run("git", ["push", "-u", `--force-with-lease=refs/heads/${branch}:${expectedRemote}`, "origin", `${publicationHead}:refs/heads/${branch}`], { cwd: root }); }
    catch (e) { throw new PlanStateError(`Publication of ${branch} at ${publicationHead} failed; remote outcome may be uncertain, inspect it before retrying: ${String(e)}`); }
    try { prUrl = existingPR ?? createPR(branch, def, planHere.title, prBody(id, planHere.title, criteria), { cwd: root, forge: config.plans.forge }); }
    catch (e) { throw new PlanStateError(`Published ${branch} at ${publicationHead}, but pull request creation failed; retry publication or create the PR into ${def}: ${String(e)}`); }
    notices.push(
      prUrl ? `Opened pull request: ${prUrl}` : `Pushed \`${branch}\`. Open a pull request from \`${branch}\` into \`${def}\`, then run \`specplane plan cleanup ${id}\` after it merges.`,
    );
    outcome = "pushed";
  } else {
    const reviewed = git(["rev-parse", "HEAD"], root);
    if (alreadyDone && criteria.length) notices.push(`Acceptance criteria (confirm before merging):\n${criteria.map(c => `  ${c}`).join("\n")}`);
    if (alreadyDone) {
      const file = path.join(dir, "spec-gaps.md");
      if (fs.existsSync(file)) { const open = formatOpenGaps(parseGaps(file).entries); if (open.length) notices.push(`Open spec gaps:\n${open.map(g => `  ${g}`).join("\n")}`); }
    }
    const challenge = [...notices, `Merge \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
    const ok = opts.confirm ? await opts.confirm(challenge) : false;
    if (!ok) {
      notices.push(`Plan \`${id}\` is ready to merge: head \`${reviewed}\` into target \`${def}\` at \`${rebaseTip}\`. Run \`specplane plan finish ${id}\` interactively to confirm this head and target.`);
      return { planId: id, outcome: "ready", prUrl, finalized: true, notices };
    }
    lease.assertOwned(); recheckLifecycleRefs(main, targetRefs); checkAdmin(rebaseTip);
    if (!clean(root) || git(["rev-parse", "HEAD"], root) !== reviewed || git(["rev-parse", `refs/heads/${def}`], main) !== rebaseTip) throw new PlanStateError("Target or reviewed head changed after confirmation; retry finish.");
    localMerge(id, branch, def, remote, canSwitch ? "branch" : "worktree", targetTree ?? root);
    // Delete only the exact reviewed head after independently verifying integration.
    const integrated = git(["rev-parse", `refs/heads/${def}`], main);
    if (tryRun(["merge-base", "--is-ancestor", reviewed, integrated], main) === null || planAt(integrated, id, config, main)?.status !== "done" || revParse(branch, main) !== reviewed) throw new PlanStateError("Merge succeeded but integration evidence changed; retain the plan checkout for recovery.");
    if (canSwitch) deleteBranch(branch, main);
    else if (!samePath(root, main)) {
      lease.assertOwned();
      const registered = listWorktrees(main).find(w => w.branch === branch && samePath(w.path, root));
      if (!registered || registered.head !== reviewed || git(["rev-parse", "--abbrev-ref", "HEAD"], root) !== branch || git(["rev-parse", "HEAD"], root) !== reviewed || revParse(branch, main) !== reviewed || !clean(root)) throw new PlanStateError("Merge succeeded but the plan checkout changed; retain it for recovery.");
      if (ignoredFiles(root).length) notices.push("Merge succeeded; plan checkout retained because it contains ignored files. Inspect them before explicit cleanup.");
      else { dropWorktree(root, false, main); deleteBranch(branch, main); }
    } else notices.push("Merge succeeded; retain the plan checkout for explicit cleanup.");
    outcome = "merged";
  }
  return { planId: id, outcome, prUrl, notices };
  } finally { lease.release(); }
}

/** Step 5: `status: done`, archive when configured, one `finish` commit. */
function finalCommit(id: string, config: Config, root: string): void {
  const dir = `${config.plans.dir}/${id}`;
  const protectArchive = () => {
    const dest = `${config.plans.dir}/archive/${id}`;
    if (fs.lstatSync(path.join(root, dest), { throwIfNoEntry: false })) throw new PlanStateError(`Cannot archive plan: destination \`${dest}\` already exists. Preserve or move it before retrying finish.`);
    const relativeDir = path.relative(root, path.resolve(root, dir)).split(path.sep).join("/");
    const ignored = ignoredFiles(root).find(file => file.startsWith(`${relativeDir}/`));
    if (ignored) throw new PlanStateError(`Cannot archive plan: ignored file \`${ignored}\` would move. Preserve or move it before retrying finish.`);
  };
  if (config.plans.archive_done) protectArchive();
  const file = path.join(root, dir, "PLAN.md");
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 3);
  let phase = "writing done status";
  try {
    fs.writeFileSync(file, text.slice(0, end).replace(/^status:.*$/m, "status: done") + text.slice(end));
    phase = "staging done status";
    git(["add", "--", `${dir}/PLAN.md`], root);
    if (config.plans.archive_done) {
      const dest = `${config.plans.dir}/archive/${id}`;
      phase = `moving ${dir} to ${dest}`;
      protectArchive();
      fs.mkdirSync(path.join(root, config.plans.dir, "archive"), { recursive: true });
      git(["mv", dir, dest], root);
    }
  } catch (e) { throw new PlanStateError(`Finish preparation failed while ${phase}; inspect the checkout and index for partial edits: ${String(e)}`); }
  const msg = formatMessage({ type: "chore", scope: "specplane", summary: `finish ${id}`, trailers: cliTrailers("finish", id) });
  const head = git(["rev-parse", "HEAD"], root);
  const raw = (args: string[]) => run("git", args, { cwd: root });
  const status = raw(["status", "--porcelain", "-z"]);
  const cached = raw(["diff", "--cached", "--binary"]);
  const unstaged = raw(["diff", "--binary"]);
  try { run("git", ["commit", "-F", "-"], { cwd: root, input: msg }); }
  catch (e) {
    const dest = `${config.plans.dir}/archive/${id}`;
    const safe = git(["rev-parse", "HEAD"], root) === head && raw(["status", "--porcelain", "-z"]) === status &&
      raw(["diff", "--cached", "--binary"]) === cached && raw(["diff", "--binary"]) === unstaged &&
      (!config.plans.archive_done || (!fs.existsSync(path.join(root, dir)) && fs.existsSync(path.join(root, dest))));
    if (!safe) throw new PlanStateError(`Finish edits were retained because the checkout or index changed unexpectedly: ${String(e)}`);
    try {
      git(["reset", "-q", "HEAD", "--", dir, ...(config.plans.archive_done ? [dest] : [])], root);
      if (config.plans.archive_done) fs.renameSync(path.join(root, dest), path.join(root, dir));
      fs.writeFileSync(file, text);
    } catch (restore) { throw new PlanStateError(`Finish edit restoration was incomplete; inspect the checkout and index: ${String(restore)}; original failure: ${String(e)}`); }
    throw new PlanStateError(`Operation-owned finish edits were restored after commit failure: ${String(e)}`);
  }
}

/** Local merge in the main checkout (feature/plan-execution § Local merge). */
function localMerge(id: string, branch: string, def: string, remote: boolean, backend: Config["execution"]["backend"], main: string): void {
  const resume = `The done commit stays on \`${branch}\`; run \`specplane plan finish ${id}\` again after fixing it.`;
  if (backend === "branch") {
    // The main checkout is the plan checkout; it is clean after the final commit.
    protectIgnoredCollisions(main, branch, def);
    run("git", ["switch", "--no-overwrite-ignore", def], { cwd: main });
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
  protectIgnoredCollisions(main, def, branch);
  run("git", ["merge", "--no-overwrite-ignore", "--no-ff", "-m", `Merge ${branch}`, branch], { cwd: main });
  if (remote) {
    const integrated = git(["rev-parse", "HEAD"], main);
    try { run("git", ["push", "origin", def], { cwd: main }); }
    catch (e) { throw new PlanStateError(`Plan ${branch} was merged into ${def} at ${integrated}, but target publication failed; retry finish to publish this merge: ${String(e)}`); }
  }
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
  const trees = listWorktrees(main);
  const planIds = git(["for-each-ref", "--format=%(refname)", "refs/heads/plan/", "refs/remotes/origin/plan/"], main).split("\n").map(x => x.replace(/^refs\/(?:heads|remotes\/origin)\/plan\//, "")).filter(Boolean);
  const lease = opts.dryRun ? null : acquireWriterLease({ repository: true, plans: [id, ...planIds], checkouts: trees.filter(w => !w.bare).map(w => w.path), requestId: `restack-${randomUUID()}` });
  try {
  if (!opts.dryRun && hasRemote(main)) run("git", ["fetch", "origin", "+refs/heads/*:refs/remotes/origin/*"], { cwd: main });
  const p = lifecycleContext(id, config, root, "restack");
  config = p.config;
  const def = p.context.targetBranch;
  if (JSON.stringify(trees) !== JSON.stringify(listWorktrees(main))) throw new PlanStateError("Checkout set changed during preparation; retry.");
  if (def.startsWith("plan/") && !planIds.includes(def.slice(5))) throw new PlanStateError("Target plan appeared during fetch; retry to acquire its lease.");
  const branch = `plan/${id}`;
  if (!branchExists(branch, main)) {
    if (!planAt(defaultTip(def, main), id, config, main)) throw new PlanNotFoundError(id);
    throw new PlanStateError(`Cannot restack: \`${id}\` is not stacked.`);
  }
  const marker = findLatest(branch, "stack", main);
  const storedUpstream = marker ? readTrailers(marker, main).get("Specplane-Stack-Base")?.at(-1) : undefined;
  if (!marker || !storedUpstream) throw new PlanStateError(`Cannot restack: \`${id}\` is not stacked.`);
  const upstream = resolveCommit(main, storedUpstream, true);
  const subject = run("git", ["log", "-1", "--format=%s", marker], { cwd: main }).trim();
  const baseId = /^chore\(specplane\): stack \S+ on (\S+)$/.exec(subject)?.[1];
  if (!baseId) throw new PlanStateError(`Cannot restack: the stack marker of \`${id}\` does not name a base plan.`);

  const tip = p.context.targetCommit;
  const baseRecord = validatedPlanAt(main, tip, config, baseId);
  const merged = baseRecord?.status === "done";
  let baseCommit = tip;
  if (planIds.includes(baseId)) baseCommit = checkStackTarget(baseId, def, config, main, p.refs);
  else if (!merged || baseRecord?.execution?.target_branch !== def) throw new PlanStateError(`Stack dependency ${baseId} lacks compatible recorded target.`);
  if (merged) requireStackIntegration(baseId, def, tip, upstream, config, main, p.refs);
  let newBase = tip;
  if (!merged) {
    newBase = baseCommit;
    if (newBase === "") throw new PlanStateError(`Cannot restack: base plan \`${baseId}\` has no branch and is not done on \`${def}\`.`);
  }
  const newBaseSha = revParse(newBase, main);
  const checkout = planWorktree(branch, main) ?? (git(["rev-parse", "--abbrev-ref", "HEAD"], main) === branch ? main : null);
  if (!checkout) {
    throw new PlanStateError(`Cannot restack: \`${branch}\` is not checked out. Run \`specplane plan start ${id}\` first.`);
  }
  if (!clean(checkout)) throw new PlanStateError("Cannot restack: the working tree has uncommitted changes. Commit or stash them first.");
  if (!merged && newBaseSha === upstream) return { planId: id, outcome: "current", onto: newBase, unstacked: false, commits: [] };
  if (!opts.dryRun) { lease?.assertOwned(); recheckLifecycleRefs(main, p.refs); }
  protectIgnoredCollisions(checkout, branch, newBase, upstream);
  if (opts.dryRun) {
    return { planId: id, outcome: "dry-run", onto: newBase, unstacked: merged, commits: commitsToReplay(branch, upstream, main) };
  }

  // Unlike finish, a conflict leaves the checkout mid-rebase for the human (`feature/tooling`).
  rebaseOnto(newBase, upstream, branch, checkout, { onConflict: "leave" });
  const afterRebase = validatedPlanAt(checkout, "HEAD", config, id);
  if (!afterRebase || !isDeepStrictEqual(afterRebase.execution, p.context.binding) || (afterRebase.comparison_base ?? null) !== p.context.comparisonBase) throw new PlanStateError("Restack changed execution provenance; recovery is required.");
  lease?.assertOwned();
  recheckLifecycleRefs(main, Object.fromEntries(Object.entries(p.refs).filter(([name]) => name !== `refs/heads/${branch}` && name !== `refs/remotes/origin/${branch}`)));
  // A new marker: the next base while stacked, or a marker without a base once the plan is on the default branch.
  const trailers = { ...cliTrailers("stack", id), ...(merged ? {} : { "Specplane-Stack-Base": newBaseSha }) };
  const msg = formatMessage({
    type: "chore",
    scope: "specplane",
    summary: merged ? `unstack ${id} from ${baseId}` : `stack ${id} on ${baseId}`,
    trailers,
  });
  try { run("git", ["commit", "--allow-empty", "-F", "-"], { cwd: checkout, input: msg }); }
  catch (e) { throw new PlanStateError(`Restack rebase completed at ${git(["rev-parse", "HEAD"], checkout)}, but marker creation failed; inspect the checkout and create or reconcile the marker before retrying: ${String(e)}`); }
  return { planId: id, outcome: "restacked", onto: newBase, unstacked: merged, commits: [] };
  } finally { lease?.release(); }
}
