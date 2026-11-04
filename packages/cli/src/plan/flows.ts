import { renderStatus, parseFrontmatter } from "../frontmatter.js";
import { createHash, randomUUID } from "node:crypto";
import { acquireWriterLease, checkoutIdentity, type WriterLease } from "../core/writer-leases.js";
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
import { fetchPlanBranches, getPlanActivity, hasRemote, lenientFrontmatter, showFile, planReport, targetPlanRecord } from "./activity.js";
import { formatOpenGaps, parseGaps } from "./gaps.js";
import { listStepFiles, parseStep } from "./parse.js";
import { listPlans, planDir } from "./resolve.js";
import { capturePlanSnapshot, prospectivePlanSnapshot, recheckPlanSnapshot } from "../generate/snapshot.js";
import { generatePlansMd } from "../generate/plans-md.js";

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

function requireFinishedSteps(dir: string): void {
  for (const f of listStepFiles(dir)) {
    const s = parseStep(f).frontmatter;
    if (s.status !== "done" && s.status !== "skipped") {
      throw new PlanStateError(`Cannot finish: step ${String(s.step).padStart(2, "0")} is \`${s.status}\`.`);
    }
  }
}

export interface FinishGate {
  kind: 'preparation' | 'rebase' | 'finish-acceptance' | 'publication' | 'merge';
  planId: string;
  branch: string;
  head: string;
  target: string;
  targetHead: string;
  summary: string;
}

export interface FinishOptions {
  /** Internal adapter: retain the complete writer lease across all distinct gates. */
  lease?: WriterLease;
  /** Structured trusted embedding seam; manual CLI confirmation remains independent. */
  confirmGate?: (gate: Readonly<FinishGate>) => Promise<boolean>;
  signal?: AbortSignal;
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
  const lease = opts.lease ?? acquireWriterLease({ repository: true, plans: [id, ...planIds], checkouts: trees.filter(w => !w.bare).map(w => w.path), requestId: `finish-${randomUUID()}` });
  try {
  lease.assertOwned();
  const identities = trees.filter(tree => !tree.bare).map(tree => checkoutIdentity(tree.path));
  if (!lease.keys.some(key => key.kind === 'repository' && key.identity === identities[0]?.commonDir) ||
      [id, ...planIds].some(plan => !lease.keys.some(key => key.kind === 'plan' && key.identity === plan)) ||
      identities.some(identity => !lease.keys.some(key => key.kind === 'checkout' && key.identity === identity.gitDir)))
    throw new PlanStateError('Finish requires repository, every relevant plan and checkout lease.');
  const checkCancelled = () => { if (opts.signal?.aborted) throw new PlanStateError('Finish cancelled; inspect any retained lifecycle changes before retrying.'); };
  checkCancelled();
  assertNoPendingFinish(main, id);
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
  const ask = async (kind: FinishGate['kind'], summary: string, head: string, targetHead: string): Promise<boolean> => {
    lease.assertOwned(); checkCancelled();
    const gate = Object.freeze({ kind, planId: id, branch, head, target: def, targetHead, summary });
    const approved = opts.confirmGate ? await opts.confirmGate(gate) : opts.confirm ? await opts.confirm(summary) : false;
    lease.assertOwned(); checkCancelled();
    return approved;
  };
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
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs);
    if (remote && p.refs[`refs/remotes/origin/${def}`] !== p.context.targetCommit) {
      const challenge = `Publish recovered \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${p.context.targetCommit}\` now?`;
      if (!await ask('publication', challenge, reviewed, p.context.targetCommit)) return { planId: id, outcome: "ready", prUrl: null, finalized: true, notices: [`Integrated target \`${def}\` at \`${p.context.targetCommit}\` awaits publication confirmation.`] };
      lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs);
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
  requireFinishedSteps(dir);
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
  lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs);
  const existingPR = merge === "pull_request" ? matchingOpenPR(branch, def, { cwd: root, forge: config.plans.forge }) : null;
  // Structured finish authorizes preparation writes (target review claim, pending-claim publication) before the first one.
  const unpublishedClaim = frontmatterMode && remote && p.target.status === "review" && p.refs[`refs/remotes/origin/${def}`] !== tip;
  if (opts.confirmGate && !alreadyDone && (claimReview || unpublishedClaim)) {
    const headBefore = git(["rev-parse", "HEAD"], root);
    const prepTrees = listWorktrees(main);
    const effects = [claimReview ? `commit a review claim for \`${id}\` on \`${def}\`${remote ? " and publish it" : ""}` : `publish the pending review claim on \`${def}\``];
    const question = `Prepare finishing \`${branch}\` at \`${headBefore}\` against \`${def}\` at \`${tip}\`: ${effects.join("; ")}? Rebase, finish acceptance and merge remain separate decisions.`;
    if (!await ask('preparation', question, headBefore, tip)) return { planId: id, outcome: 'ready', prUrl: null, finalized: false, notices: ['Finish preparation declined; no lifecycle change was made.'] };
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs); checkAdmin(tip);
    if (git(['rev-parse', 'HEAD'], root) !== headBefore || !clean(root) || JSON.stringify(prepTrees) !== JSON.stringify(listWorktrees(main)))
      throw new PlanStateError('Plan, target or checkout set changed during preparation confirmation; retry.');
  }
  // Publish an already-created review claim before treating it as complete.
  if (unpublishedClaim) {
    const trailers = readTrailers(tip, main);
    if (trailers.get("Specplane-Workflow")?.at(-1) !== "claim" || trailers.get("Specplane-Plan")?.at(-1) !== id || !targetTree || !clean(targetTree) || git(["rev-parse", "HEAD"], targetTree) !== tip) throw new PlanStateError("Unpublished target review state requires reconciliation before finish.");
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs);
    try { run("git", ["push", "origin", def], { cwd: targetTree }); }
    catch (e) { throw new PlanStateError(`Review claim ${tip} remains unpublished; retry after resolving the push: ${String(e)}`); }
    p.refs[`refs/remotes/origin/${def}`] = tip;
  }
  // 2. Verify.
  const testCmd = config.plans.test_command.trim();
  if (!alreadyDone) {
    if (testCmd !== "") runTests(testCmd, root);
  }

  // 3. Claim review (frontmatter mode).
  lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs); checkAdmin(tip);
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
  // The structured embedding must authorize preparation separately from acceptance
  // of the resulting revision. Keep the manual CLI's documented rebase behavior.
  if (opts.confirmGate) {
    const rebaseTrees = listWorktrees(main);
    const question = `Rebase \`${branch}\` at \`${before}\` onto \`${def}\` at \`${rebaseTip}\`? Resulting revision requires fresh finish acceptance.`;
    if (!await ask('rebase', question, before, rebaseTip)) return { planId: id, outcome: 'ready', prUrl: null, finalized: alreadyDone, notices: [...notices, 'Rebase declined; finish acceptance remains unavailable.'] };
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, p.refs); checkAdmin(rebaseTip);
    if (git(['rev-parse', 'HEAD'], root) !== before || !clean(root) || JSON.stringify(rebaseTrees) !== JSON.stringify(listWorktrees(main)))
      throw new PlanStateError('Plan, target or checkout set changed during rebase confirmation; retry.');
  }
  checkCancelled();
  rebaseOnto(rebaseTip, stackBase ?? rebaseTip, branch, root);
  const rebased = git(["rev-parse", "HEAD"], root) !== before;
  if (rebased && testCmd !== "") runTests(testCmd, root);
  const afterRebase = validatedPlanAt(root, "HEAD", config, id);
  if (!afterRebase || !isDeepStrictEqual(afterRebase.execution, p.context.binding) || (afterRebase.comparison_base ?? null) !== p.context.comparisonBase) throw new PlanStateError("Rebase changed execution provenance; recovery is required.");

  requireFinishedSteps(planDir(id, config, root));
  if (alreadyDone) {
    const output = path.join(root, config.plans.dir, 'PLANS.md');
    const stat = fs.lstatSync(output, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.nlink !== 1) throw new PlanStateError('Finalized plan index is unavailable or unsafe; reconcile before retrying finish.');
    const finalizedSnapshot = capturePlanSnapshot(root, 'head');
    const expectedIndex = generatePlansMd(finalizedSnapshot);
    if (finalizedSnapshot.outputBytes?.toString('utf8') !== expectedIndex || fs.readFileSync(output, 'utf8') !== expectedIndex ||
        run('git', ['show', `:${finalizedSnapshot.outputPath}`], { cwd: root }) !== expectedIndex)
      throw new PlanStateError('Finalized plan index differs from the resulting revision; reconcile before retrying finish.');
  }

  lease.assertOwned();
  const targetRefs = Object.fromEntries(Object.entries(p.refs).filter(([name]) => name !== `refs/heads/${branch}` && name !== `refs/remotes/origin/${branch}`));
  recheckLifecycleRefs(main, targetRefs);
  // 5. Final commit (the PLAN.md may move to the archive, so read the criteria first).
  const criteria = acceptanceCriteria(fs.readFileSync(path.join(dir, "PLAN.md"), "utf8"));
  const gapsFile = path.join(dir, "spec-gaps.md");
  const openGaps = fs.existsSync(gapsFile) ? formatOpenGaps(parseGaps(gapsFile).entries) : [];
  const gapsNotice = openGaps.length ? `Open spec gaps:\n${openGaps.map(g => `  ${g}`).join("\n")}` : null;
  // Acceptance evidence belongs to the resulting revision, never the pre-rebase tree.
  if (criteria.length) notices.push(`Acceptance criteria (confirm before merging):\n${criteria.map(c => `  ${c}`).join("\n")}`);
  if (gapsNotice) notices.push(gapsNotice);
  if (alreadyDone) {
    const reviewed = git(["rev-parse", "HEAD"], root);
    const challenge = [...(criteria.length ? [`Acceptance criteria:\n${criteria.join("\n")}`] : []), ...(gapsNotice ? [gapsNotice] : []), `Accept finish \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
    if (!await ask('finish-acceptance', challenge, reviewed, rebaseTip)) {
      notices.push(`Plan \`${id}\` is ready for fresh finish acceptance: head \`${reviewed}\`, target \`${def}\` at \`${rebaseTip}\`.`);
      return { planId: id, outcome: "ready", prUrl: null, finalized: alreadyDone, notices };
    }
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, targetRefs); checkAdmin(rebaseTip);
    if (git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)) throw new PlanStateError("Plan changed during finish acceptance; retry.");
  } else {
    const reviewed = git(["rev-parse", "HEAD"], root);
    const preview = finishPreview(id, config, root);
    const challenge = [...notices, preview.summary, `Finalize \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
    const approved = await ask('finish-acceptance', challenge, reviewed, rebaseTip);
    if (!approved) {
      notices.push(`Plan \`${id}\` is ready to merge after interactive finalization: head \`${reviewed}\`, target \`${def}\` at \`${rebaseTip}\`.`);
      return { planId: id, outcome: "ready", prUrl: null, finalized: false, notices };
    }
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, targetRefs);
    if (git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)) throw new PlanStateError("Plan changed during finalization confirmation; retry.");
    checkAdmin(rebaseTip);
    if (!isDeepStrictEqual(finishPreview(id, config, root), preview)) throw new PlanStateError("Finalization preview changed; retry.");
    try { finalCommit(id, config, root, preview); }
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
      if (!await ask('publication', challenge, reviewed, rebaseTip)) {
        notices.push(`Plan \`${id}\` is ready for publication after interactive confirmation: head \`${reviewed}\`, target \`${def}\` at \`${rebaseTip}\`.`);
        return { planId: id, outcome: "ready", prUrl: null, finalized: true, notices };
      }
      lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, targetRefs);
      if (git(["rev-parse", "HEAD"], root) !== reviewed || !clean(root)) throw new PlanStateError("Plan changed during publication confirmation; retry.");
      checkAdmin(rebaseTip);
    }
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, targetRefs);
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
    const challenge = [...notices, `Merge \`${branch}\` at \`${reviewed}\` into \`${def}\` at \`${rebaseTip}\` now?`].join("\n");
    const ok = await ask('merge', challenge, reviewed, rebaseTip);
    if (!ok) {
      notices.push(`Plan \`${id}\` is ready to merge: head \`${reviewed}\` into target \`${def}\` at \`${rebaseTip}\`. Run \`specplane plan finish ${id}\` interactively to confirm this head and target.`);
      return { planId: id, outcome: "ready", prUrl, finalized: true, notices };
    }
    lease.assertOwned(); checkCancelled(); recheckLifecycleRefs(main, targetRefs); checkAdmin(rebaseTip);
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
  } finally { if (!opts.lease) lease.release(); }
}

/** Verify physical archive inputs independently of Git's cached stat/skip flags. */
function verifyArchiveInputs(root: string, dir: string, entries: string[]): void {
  const expected = new Map(entries.map(entry => {
    const tab = entry.indexOf("\t");
    return [entry.slice(tab + 1), entry.slice(0, tab).split(" ")] as const;
  }));
  const visit = (relative: string): void => {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      // A submodule is not a recursively verified archive input.
      if (expected.has(relative)) throw new PlanStateError(`Cannot verify archive input: ${relative}.`);
      for (const name of fs.readdirSync(absolute)) visit(`${relative}/${name}`);
      return;
    }
    const record = expected.get(relative);
    if (!record) throw new PlanStateError(`Unreviewed archive input: ${relative}.`);
    const [mode, type, object] = record;
    const validType = type === "blob" && (mode === "120000" ? stat.isSymbolicLink() :
      (mode === "100644" || mode === "100755") && stat.isFile());
    if (!validType) throw new PlanStateError(`Archive input type differs from the reviewed revision: ${relative}.`);
    const bytes = stat.isSymbolicLink() ? fs.readlinkSync(absolute, { encoding: "buffer" }) : fs.readFileSync(absolute);
    const committed = run("git", ["cat-file", "blob", object], { cwd: root, binary: true });
    const executableChanged = stat.isFile() && process.platform !== "win32" &&
      Boolean(stat.mode & 0o111) !== (mode === "100755");
    if (!bytes.equals(committed) || executableChanged) throw new PlanStateError(`Archive input differs from the reviewed revision: ${relative}.`);
    expected.delete(relative);
  };
  visit(dir);
  if (expected.size) throw new PlanStateError(`Missing archive input: ${expected.keys().next().value}.`);
}

/** Preview status bytes and every archive move from the reviewed revision. */
interface FinishPreview { after: string; index: { path: string; before: string | null; after: string; mode: string }; summary: string }
function finishPreview(id: string, config: Config, root: string): FinishPreview {
  const dir = `${config.plans.dir}/${id}`;
  const file = `${dir}/PLAN.md`;
  const before = fs.readFileSync(path.join(root, file), "utf8");
  const committed = run("git", ["show", `HEAD:${file}`], { cwd: root });
  if (before !== committed) throw new PlanStateError("Finalization input differs from the reviewed revision.");
  const after = renderStatus(before, "done", file);
  if (parseFrontmatter(after, file).data.status !== "done") throw new PlanStateError("Cannot render final plan status.");
  const dest = `${config.plans.dir}/archive/${id}`;
  const indexRel = `${config.plans.dir}/PLANS.md`;
  const indexFile = path.join(root, indexRel);
  const indexStat = fs.lstatSync(indexFile, { throwIfNoEntry: false });
  if (indexStat && (!indexStat.isFile() || indexStat.nlink !== 1)) throw new PlanStateError('Finalization plan index must be a regular file with one link.');
  const snapshot = capturePlanSnapshot(root, 'head');
  const indexBefore = snapshot.outputBytes?.toString('utf8') ?? null;
  if (snapshot.outputPath !== indexRel || (indexBefore === null ? indexStat !== undefined : !indexStat || fs.readFileSync(indexFile, 'utf8') !== indexBefore)) throw new PlanStateError('Finalization plan index differs from the reviewed revision.');
  const edits = new Map<string, Buffer | null>([[file, config.plans.archive_done ? null : Buffer.from(after)]]);
  if (config.plans.archive_done) edits.set(`${dest}/PLAN.md`, Buffer.from(after));
  const generated = generatePlansMd(prospectivePlanSnapshot(root, snapshot, edits));
  const moves: string[] = [];
  if (config.plans.archive_done) {
    if (fs.lstatSync(path.join(root, dest), { throwIfNoEntry: false })) throw new PlanStateError(`Cannot archive plan: destination \`${dest}\` already exists. Preserve or move it before retrying finish.`);
    const ignored = ignoredFiles(root).find(file => file.startsWith(`${dir}/`));
    if (ignored) throw new PlanStateError(`Cannot archive plan: ignored file \`${ignored}\` would move. Preserve or move it before retrying finish.`);
    const entries = run("git", ["ls-tree", "-r", "-z", "HEAD", "--", dir], { cwd: root }).split("\0").filter(Boolean);
    verifyArchiveInputs(root, dir, entries);
    for (const entry of entries) {
      const tab = entry.indexOf("\t"), source = entry.slice(tab + 1);
      moves.push(`${source} → ${dest}${source.slice(dir.length)} (${entry.slice(0, tab)})`);
    }
  }
  return { after, index: { path: indexRel, before: indexBefore, after: generated, mode: snapshot.outputMode ?? '100644' }, summary: `Exact finalization change: ${file}\nBefore:\n${before}\nAfter:\n${after}${moves.length ? `\nArchive moves (source Git mode, type and object):\n${moves.join("\n")}` : ""}\nExact plan index change: ${indexRel}\nBefore:\n${indexBefore ?? '(missing)'}\nAfter:\n${generated}` };
}

/** A retained intent only refuses retry; its JSON never grants recovery authority. */
function finishIntentPath(root: string, id: string): string {
  const common = fs.realpathSync(git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root));
  const directory = path.join(common, "specplane-finish");
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new PlanStateError("Invalid pending finalization directory; preserve it for inspection.");
  return path.join(directory, createHash("sha256").update(id).digest("hex") + ".json");
}

function assertNoPendingFinish(root: string, id: string): void {
  const file = finishIntentPath(root, id);
  if (fs.lstatSync(file, { throwIfNoEntry: false })) throw new PlanStateError(`Pending finalization evidence at ${file}; inspect the retained commit, checkout and index before explicitly reconciling this record. Finish will not retry automatically.`);
}

function retainFinishIntent(root: string, id: string, parent: string, branch: string, tree: string, message: string): () => void {
  assertNoPendingFinish(root, id);
  const file = finishIntentPath(root, id);
  fs.mkdirSync(path.dirname(file), { mode: 0o700, recursive: true });
  // Recheck the directory after creation; never follow an existing journal link.
  finishIntentPath(root, id);
  const bytes = JSON.stringify({ version: 1, id, checkout: fs.realpathSync(root), parent, branch, tree, message });
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  let identity: fs.Stats;
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); identity = fs.fstatSync(fd); }
  finally { fs.closeSync(fd); }
  return () => {
    finishIntentPath(root, id);
    const current = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!current || !current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.nlink !== 1 || fs.readFileSync(file, "utf8") !== bytes)
      throw new PlanStateError("Pending finalization evidence changed; preserve it for inspection.");
    fs.unlinkSync(file);
  };
}

function finalCommit(id: string, config: Config, root: string, preview: FinishPreview): void {
  const { after, index } = preview;
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
  let phase = "writing done status";
  try {
    fs.writeFileSync(file, after);
    phase = "staging done status";
    git(["add", "--", `${dir}/PLAN.md`], root);
    if (config.plans.archive_done) {
      const dest = `${config.plans.dir}/archive/${id}`;
      phase = `moving ${dir} to ${dest}`;
      protectArchive();
      fs.mkdirSync(path.join(root, config.plans.dir, "archive"), { recursive: true });
      git(["mv", dir, dest], root);
    }
    phase = "writing and staging the prospective plan index";
    fs.writeFileSync(path.join(root, index.path), index.after);
    git(["add", "--", index.path], root);
  } catch (e) { throw new PlanStateError(`Finish preparation failed while ${phase}; inspect the checkout and index for partial edits: ${String(e)}`); }
  const msg = formatMessage({ type: "chore", scope: "specplane", summary: `finish ${id}`, trailers: cliTrailers("finish", id) });
  const head = git(["rev-parse", "HEAD"], root);
  const raw = (args: string[]) => run("git", args, { cwd: root });
  const status = raw(["status", "--porcelain", "-z"]);
  const cached = raw(["diff", "--cached", "--binary"]);
  const unstaged = raw(["diff", "--binary"]);
  const expectedTree = git(["write-tree"], root);
  const sourceEntries = raw(["ls-tree", "-r", "-z", head, "--", dir]).split('\0').filter(Boolean);
  const sourcePaths = sourceEntries.map(entry => entry.slice(entry.indexOf('\t') + 1));
  const dest = `${config.plans.dir}/archive/${id}`;
  const planFile = `${config.plans.archive_done ? dest : dir}/PLAN.md`;
  const expectedPaths = [...(config.plans.archive_done ? sourcePaths.flatMap(source => [source, `${dest}${source.slice(dir.length)}`]) : [`${dir}/PLAN.md`]), ...(index.before === index.after ? [] : [index.path])].sort();
  const actualPaths = raw(["diff", "--cached", "--name-only", "--no-renames", "-z", head]).split('\0').filter(Boolean).sort();
  const normalizedEntries = (ref: string, location: string) => raw(["ls-tree", "-r", "-z", ref, "--", location]).split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    return `${entry.slice(0, tab)}\t${entry.slice(tab + 1).slice(location.length + 1)}`;
  }).filter(entry => !entry.endsWith('\tPLAN.md')).sort();
  if (!isDeepStrictEqual(actualPaths, expectedPaths) || raw(["show", `:${planFile}`]) !== after || raw(["show", `:${index.path}`]) !== index.after ||
      git(["ls-tree", expectedTree, "--", index.path], root).split(' ')[0] !== index.mode ||
      !isDeepStrictEqual(normalizedEntries(head, dir), normalizedEntries(expectedTree, config.plans.archive_done ? dest : dir)) ||
      git(["ls-tree", head, "--", `${dir}/PLAN.md`], root).split(' ')[0] !== git(["ls-tree", expectedTree, "--", planFile], root).split(' ')[0])
    throw new PlanStateError('Finalization index differs from the exact prospective changes; retain checkout and staging for inspection.');
  const expectedBranch = git(["symbolic-ref", "HEAD"], root);
  const clearIntent = retainFinishIntent(root, id, head, expectedBranch, expectedTree, msg);
  try { run("git", ["commit", "-F", "-"], { cwd: root, input: msg }); }
  catch (e) {
    const dest = `${config.plans.dir}/archive/${id}`;
    const safe = git(["rev-parse", "HEAD"], root) === head && git(["symbolic-ref", "HEAD"], root) === expectedBranch && raw(["status", "--porcelain", "-z"]) === status &&
      raw(["diff", "--cached", "--binary"]) === cached && raw(["diff", "--binary"]) === unstaged &&
      fs.existsSync(path.join(root, index.path)) && fs.readFileSync(path.join(root, index.path), 'utf8') === index.after &&
      (!config.plans.archive_done || (!fs.existsSync(path.join(root, dir)) && fs.existsSync(path.join(root, dest))));
    if (!safe) throw new PlanStateError(`Finish edits were retained because the checkout or index changed unexpectedly: ${String(e)}`);
    try {
      git(["reset", "-q", "HEAD", "--", dir, ...(config.plans.archive_done ? [dest] : []), index.path], root);
      if (config.plans.archive_done) fs.renameSync(path.join(root, dest), path.join(root, dir));
      fs.writeFileSync(file, text);
      if (index.before === null) fs.unlinkSync(path.join(root, index.path));
      else fs.writeFileSync(path.join(root, index.path), index.before);
      clearIntent();
    } catch (restore) { throw new PlanStateError(`Finish edit restoration was incomplete; inspect the checkout and index: ${String(restore)}; original failure: ${String(e)}`); }
    throw new PlanStateError(`Operation-owned finish edits were restored after commit failure: ${String(e)}`);
  }
  // Hooks can commit different bytes while preserving the finish trailers and a
  // clean checkout. Retain that commit, but never proceed to merge consent.
  const committed = git(["rev-parse", "HEAD"], root);
  const object = raw(["cat-file", "commit", committed]);
  const message = object.slice(object.indexOf("\n\n") + 2);
  if (git(["symbolic-ref", "HEAD"], root) !== expectedBranch ||
      git(["rev-list", "--parents", "-n", "1", committed], root) !== `${committed} ${head}` ||
      git(["rev-parse", `${committed}^{tree}`], root) !== expectedTree || message !== msg || !clean(root) ||
      !fs.existsSync(path.join(root, index.path)) || fs.readFileSync(path.join(root, index.path), 'utf8') !== index.after) {
    throw new PlanStateError(`Finalization commit ${committed} differs from the prepared tree, message or branch; retain it for inspection before retrying.`);
  }
  clearIntent();
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
  const branch = `plan/${id}`;
  const trees = listWorktrees(main);
  const lease = acquireWriterLease({ repository: true, plans: [id], checkouts: trees.filter(t => !t.bare).map(t => t.path), requestId: `cleanup-${randomUUID()}` });
  try {
    const result: CleanupResult = { planId: id, worktreeRemoved: false, branchSwitched: false, branchDeleted: false };
    const hasBranch = branchExists(branch, main);
    if (!hasBranch) {
      if (remoteBranchExists(branch, main)) throw new PlanStateError("Cannot clean up: remote plan branch remains; reconcile it first.");
      if (!listPlans(config, root).some(p => p.id === id)) throw new PlanNotFoundError(id); return result;
    }
    const report = planReport(id, config, main, null);
    if (!report.target_branch || report.target_status !== "done" || report.integration_status !== "integrated")
      throw new PlanStateError(`Cannot clean up plan: integration into its recorded target is unverified; ${report.integration_reasons.join(" ")}`);
    const refs = report.ref_freshness;
    if (!refs.plan_local || (refs.plan_remote && refs.plan_remote !== refs.plan_local) || !refs.target_local || (refs.target_remote && refs.target_remote !== refs.target_local))
      throw new PlanStateError("Cannot clean up: plan or target refs require reconciliation.");
    const wt = planWorktree(branch, main);
    requireCleanWorktree(wt, "clean up plan", opts.force === true);
    // Git's forced removal also deletes ignored files; never discard them silently.
    if (wt && (tryRun(["ls-files", "--others", "--ignored", "--exclude-standard"], wt) ?? "").trim())
      throw new PlanStateError(`Cannot clean up plan: ignored files exist in \`${wt}\`; preserve them before removal.`);
    const onBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], main) === branch;
    if (onBranch && !clean(main)) throw new PlanStateError(`Cannot clean up plan: checkout has uncommitted changes.`);
    let expectedTrees = trees;
    const verify = () => {
      lease.assertOwned();
      const fresh = planReport(id, config, main, null);
      if (!isDeepStrictEqual(refs, fresh.ref_freshness) || fresh.integration_status !== "integrated") throw new PlanStateError("Target or plan refs changed during cleanup; retry.");
      if (!isDeepStrictEqual(expectedTrees, listWorktrees(main))) throw new PlanStateError("Checkout set changed during cleanup; retry.");
      const current = planWorktree(branch, main);
      requireCleanWorktree(current, "clean up plan", opts.force === true);
      if (current && ignoredFiles(current).length) throw new PlanStateError("Cannot clean up plan: ignored files exist; preserve them before removal.");
      if (onBranch && !result.branchSwitched) {
        if (!clean(main)) throw new PlanStateError("Cannot clean up plan: checkout has uncommitted changes.");
        protectIgnoredCollisions(main, branch, report.target_branch!);
      }
      return current;
    };
    if (wt) { verify(); dropWorktree(wt, opts.force === true, main); result.worktreeRemoved = true; expectedTrees = expectedTrees.filter(t => !samePath(t.path, wt)); }
    if (onBranch) { verify(); run("git", ["switch", "--no-overwrite-ignore", report.target_branch], { cwd: main }); result.branchSwitched = true; expectedTrees = expectedTrees.map(t => samePath(t.path, main) ? { ...t, branch: report.target_branch, head: refs.target_local } : t); }
    verify(); deleteBranch(branch, main); result.branchDeleted = true;
    return result;
  } finally { lease.release(); }
}

export interface AbandonPreview {
  checkout: string;
  target: string;
  parent: string;
  changes: { path: string; before: string | null; after: string | null }[];
  archive: { from: string; to: string } | null;
  removeWorktree: string | null;
  deleteBranch: string | null;
  publish: boolean;
}

export interface AbandonOptions {
  /** Internal adapter: retain the already-held complete lease through human review. */
  lease?: WriterLease;
  /** Internal adapter: report exact prospective output and return before writes. */
  preview?: (value: AbandonPreview) => void;
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


/** Only rewrite a simple, unique top-level status field in frontmatter. */
function abandonedText(text: string): string {
  const end = text.indexOf("\n---", 3);
  if (!text.startsWith("---\n") || end < 0) throw new PlanStateError('Cannot abandon: unsupported plan frontmatter layout.');
  const head = text.slice(0, end);
  if ((head.match(/^status:[^\r\n]*$/gm) ?? []).length !== 1 || (head.match(/^shelved_from:[^\r\n]*$/gm) ?? []).length > 1)
    throw new PlanStateError('Cannot abandon: unsupported plan status layout.');
  const changed = head.replace(/^status:[^\r\n]*$/m, 'status: abandoned').replace(/^shelved_from:[^\r\n]*(?:\r?\n|$)/m, '');
  const result = changed + text.slice(end);
  const data = lenientFrontmatter(result);
  if (data?.status !== 'abandoned' || Object.hasOwn(data, 'shelved_from')) throw new PlanStateError('Cannot abandon: unsupported plan status layout.');
  return result;
}

type AbandonPending = { version: 1; id: string; target: string; parent: string; tree: string; planLocal: string | null; planRemote: string | null; deleteBranch: boolean; force: boolean; logLength: number; logHash: string };
const hashBytes = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function pendingPath(main: string, id: string): string {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], main);
  return path.join(common, 'specplane-abandon', createHash('sha256').update(id).digest('hex') + '.json');
}
function headLog(main: string): string {
  return path.join(git(['rev-parse', '--absolute-git-dir'], main), 'logs', 'HEAD');
}
function pendingCommit(main: string, record: AbandonPending): string {
  const log = fs.readFileSync(headLog(main));
  if (log.length <= record.logLength || hashBytes(log.subarray(0, record.logLength)) !== record.logHash)
    throw new PlanStateError('Pending abandonment HEAD log changed; reconcile the retained operation.');
  const first = log.subarray(record.logLength).toString('utf8').split('\n')[0];
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) [^\n]*\tcommit: /.exec(first);
  if (!match || match[1] !== record.parent || match[2].length !== record.parent.length)
    throw new PlanStateError('Pending abandonment HEAD transition is ambiguous; reconcile the retained operation.');
  return match[2];
}
function validatePendingCommit(main: string, record: AbandonPending, commit: string): void {
  const parents = git(['rev-list', '--parents', '-n', '1', commit], main).split(' ');
  const trailers = readTrailers(commit, main);
  if (parents.length !== 2 || parents[1] !== record.parent || git(['rev-parse', `${commit}^{tree}`], main) !== record.tree ||
      trailers.get('Specplane-Workflow')?.join() !== 'abandon' || trailers.get('Specplane-Plan')?.join() !== record.id)
    throw new PlanStateError(`Abandonment commit ${commit} retained; its parent, tree or trailers changed during recording.`);
}

/** `specplane plan abandon <id>` (feature/plan-execution § Abandoning a plan). Re-running finishes any leftover steps. */
export function abandonPlan(id: string, config: Config, root: string, opts: AbandonOptions = {}): AbandonResult {
  const trees = listWorktrees(root);
  const lease = opts.lease ?? acquireWriterLease({ repository: true, plans: [id], checkouts: trees.filter(t => !t.bare).map(t => t.path), requestId: `abandon-${randomUUID()}` });
  try {
  lease.assertOwned();
  const identities = trees.filter(t => !t.bare).map(t => checkoutIdentity(t.path));
  if (!lease.keys.some(k => k.kind === 'plan' && k.identity === id) ||
      !lease.keys.some(k => k.kind === 'repository' && k.identity === identities[0]?.commonDir) ||
      identities.some(identity => !lease.keys.some(k => k.kind === 'checkout' && k.identity === identity.gitDir)))
    throw new PlanStateError('Abandonment requires repository, plan and every relevant checkout lease.');
  const report = planReport(id, config, root, null);
  if (!report.target_branch || report.target_status === null) throw new PlanStateError('Cannot abandon: authoritative target is unavailable.');
  const def = report.target_branch;
  const main = trees.find(t => !t.bare && t.branch === def)?.path;
  if (!main || git(['rev-parse', 'HEAD'], main) !== report.ref_freshness.target_local) throw new PlanStateError('Cannot abandon: provide an up-to-date target checkout.');
  const branch = `plan/${id}`;
  const targetRecord = targetPlanRecord(id, config, root, report);
  if (!targetRecord || targetRecord.ref !== report.ref_freshness.target_local) throw new PlanStateError('Cannot abandon: target record is unavailable or stale.');
  config = targetRecord.config;
  const rec = listPlans(config, main).find((p) => p.id === id);
  if (!rec) throw new PlanNotFoundError(id);
  const status = String(lenientFrontmatter(fs.readFileSync(rec.planFile, "utf8"))?.status ?? "unknown");
  const verifyPlanIndex = (commit: string) => {
    const current = capturePlanSnapshot(main, 'head');
    const expected = generatePlansMd(current);
    if (current.identity !== commit || current.outputBytes?.toString('utf8') !== expected ||
        !fs.existsSync(path.join(main, current.outputPath)) || fs.readFileSync(path.join(main, current.outputPath), 'utf8') !== expected ||
        run('git', ['show', `:${current.outputPath}`], { cwd: main }) !== expected)
      throw new PlanStateError(`Abandonment commit ${commit} retained; plan index changed before publication or cleanup.`);
  };
  const finishAbandonCleanup = (commit: string, archived: boolean, committed: boolean, verifyJournal: () => void): AbandonResult => {
    const baseline = planReport(id, config, main, null).ref_freshness;
    if (baseline.target_local !== commit || baseline.plan_local !== report.ref_freshness.plan_local || baseline.plan_remote !== report.ref_freshness.plan_remote)
      throw new PlanStateError(`Abandonment commit ${commit} retained; refs changed before cleanup.`);
    let expectedTrees = trees.map(t => samePath(t.path, main) ? { ...t, head: commit } : t);
    const verify = () => {
      lease.assertOwned();
      verifyJournal();
      verifyPlanIndex(commit);
      if (!isDeepStrictEqual(expectedTrees, listWorktrees(main)) || !isDeepStrictEqual(baseline, planReport(id, config, main, null).ref_freshness) ||
          git(['rev-parse', 'HEAD'], main) !== commit || git(['rev-parse', '--abbrev-ref', 'HEAD'], main) !== def)
        throw new PlanStateError(`Abandonment commit ${commit} retained; refs or checkouts changed before cleanup.`);
      const current = planWorktree(branch, main);
      if (current && ignoredFiles(current).length) throw new PlanStateError(`Abandonment commit ${commit} retained; worktree contains ignored files.`);
      requireCleanWorktree(current, 'abandon plan', opts.force === true);
      return current;
    };
    let removed = false, deleted = false;
    const current = verify();
    if (current) { dropWorktree(current, opts.force === true, main); removed = true; expectedTrees = expectedTrees.filter(t => !samePath(t.path, current)); }
    if (opts.deleteBranch && branchExists(branch, main)) { verify(); deleteBranch(branch, main); deleted = true; }
    return { planId: id, committed, archived, worktreeRemoved: removed, branchDeleted: deleted };
  };
  const journal = pendingPath(main, id);
  const journalDir = path.dirname(journal);
  if (fs.existsSync(journalDir) && !fs.lstatSync(journalDir).isDirectory()) throw new PlanStateError('Invalid pending abandonment directory; reconcile it before continuing.');
  if (fs.lstatSync(journal, { throwIfNoEntry: false })?.isSymbolicLink()) throw new PlanStateError('Invalid pending abandonment record; reconcile it before continuing.');
  if (opts.preview && status === 'abandoned') throw new PlanStateError('Retained abandonment requires explicit reconciliation before preparing new consent.');
  if (status === "abandoned" && fs.existsSync(journal)) {
    const bytes = fs.readFileSync(journal, 'utf8');
    let pending: AbandonPending;
    try { pending = JSON.parse(bytes) as AbandonPending; } catch { throw new PlanStateError('Invalid pending abandonment record; reconcile it before retrying.'); }
    if (!pending || pending.version !== 1 || pending.id !== id || pending.target !== def || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pending.parent) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pending.tree) || !Number.isSafeInteger(pending.logLength) || pending.logLength < 0 || !/^[0-9a-f]{64}$/.test(pending.logHash) || typeof pending.deleteBranch !== 'boolean' || typeof pending.force !== 'boolean' || (pending.planLocal !== report.ref_freshness.plan_local && !(pending.deleteBranch && pending.planLocal !== null && report.ref_freshness.plan_local === null)) || pending.planRemote !== report.ref_freshness.plan_remote || pending.deleteBranch !== (opts.deleteBranch === true) || pending.force !== (opts.force === true))
      throw new PlanStateError('Pending abandonment record or requested cleanup differs; reconcile it before retrying.');
    const verifyJournal = () => { if (!fs.existsSync(journal) || fs.readFileSync(journal, 'utf8') !== bytes) throw new PlanStateError('Pending abandonment record changed; reconcile before continuing.'); };
    const recorded = pendingCommit(main, pending);
    validatePendingCommit(main, pending, recorded);
    const local = report.ref_freshness.target_local!;
    if (recorded !== local) throw new PlanStateError(`Abandonment commit ${recorded} retained; HEAD moved to ${local}; reconcile before publication.`);
    const trailers = readTrailers(local, main);
    if (trailers.get('Specplane-Workflow')?.join() === 'abandon' && trailers.get('Specplane-Plan')?.join() === id) {
      const parent = git(['rev-parse', `${local}^`], main);
      const activeDir = `${config.plans.dir}/${id}`, archivedDir = `${config.plans.dir}/archive/${id}`;
      const sourceDir = showFile(parent, `${activeDir}/PLAN.md`, main) !== null ? activeDir : archivedDir;
      const prior = showFile(parent, `${sourceDir}/PLAN.md`, main);
      const previous = prior ? lenientFrontmatter(prior) : null;
      const expected = prior ? abandonedText(prior) : null;
      const changedPaths = git(['diff', '--name-only', '--no-renames', '-z', parent, local], main).split('\0').filter(Boolean);
      const treeEntries = (ref: string, dir: string) => git(['ls-tree', '-r', '-z', ref, '--', dir], main).split('\0').filter(Boolean).map(entry => {
        const tab = entry.indexOf('\t');
        return `${entry.slice(0, tab)}\t${entry.slice(tab + 1).slice(dir.length + 1)}`;
      }).filter(entry => !entry.endsWith('\tPLAN.md')).sort();
      const destinationDir = rec.archived ? archivedDir : activeDir;
      if (!isDeepStrictEqual(treeEntries(parent, sourceDir), treeEntries(local, destinationDir))) throw new PlanStateError(`Cannot abandon: retained commit ${local} changed unrelated plan files.`);
      const retrySnapshot = capturePlanSnapshot(main, 'head');
      const indexRel = retrySnapshot.outputPath;
      const expectedIndex = generatePlansMd(retrySnapshot);
      if (retrySnapshot.identity !== local || showFile(local, indexRel, main) !== expectedIndex || !fs.existsSync(path.join(main, indexRel)) || fs.readFileSync(path.join(main, indexRel), 'utf8') !== expectedIndex)
        throw new PlanStateError(`Cannot abandon: retained commit ${local} has an invalid prospective plan index.`);
      if (!previous || previous.id !== id || ['done', 'abandoned'].includes(String(previous.status)) || expected !== targetRecord.text || changedPaths.some(f => f !== indexRel && !f.startsWith(`${config.plans.dir}/${id}/`) && !f.startsWith(`${config.plans.dir}/archive/${id}/`)))
        throw new PlanStateError(`Cannot abandon: retained commit ${local} is not an authenticated transition.`);
      verifyPlanIndex(local);
      if (hasRemote(main)) {
        const published = git(['ls-remote', '--heads', 'origin', `refs/heads/${def}`], main).split(/\s+/)[0];
        if (published === parent) {
          lease.assertOwned();
          verifyJournal();
          if (git(['rev-parse', 'HEAD'], main) !== local) throw new PlanStateError(`Publication pending for ${local}: target changed.`);
          try { git(['push', 'origin', `${local}:refs/heads/${def}`], main); }
          catch (e) { throw new PlanStateError(`Publication pending for ${local}: ${String(e)}`); }
        } else if (published !== local) throw new PlanStateError(`Cannot abandon: publication of ${local} needs reconciliation.`);
      }
      const finished = finishAbandonCleanup(local, rec.archived, false, verifyJournal);
      if (fs.readFileSync(journal, 'utf8') !== bytes) throw new PlanStateError(`Abandonment commit ${local} retained; pending record changed before completion.`);
      fs.unlinkSync(journal);
      return finished;

    }
  }
  if (status === "done" || status === "abandoned") {
    throw new PlanStateError(`Cannot abandon plan: \`${id}\` is \`${status}\`.`);
  }
  if (report.ref_freshness.target_remote && report.ref_freshness.target_remote !== report.ref_freshness.target_local) throw new PlanStateError('Cannot abandon: target publication requires reconciliation.');
  if (fs.readFileSync(rec.planFile, 'utf8') !== targetRecord.text) throw new PlanStateError('Cannot abandon: target plan has uncommitted changes.');
  const relDir = path.relative(main, rec.dir);
  const archiveRel = `${config.plans.dir}/archive/${id}`;
  const moves = config.plans.archive_done && !rec.archived;

  // 1. Validate.
  const planTree = trees.find(t => t.branch === branch);
  if (planTree && samePath(planTree.path, mainRoot(root))) throw new PlanStateError('Cannot abandon: the plan is checked out in the main worktree; preserve it and switch it before retrying.');
  if (git(['diff', '--cached', '--name-only'], main)) throw new PlanStateError('Cannot abandon: index has staged changes.');
  if (git(['status', '--porcelain', '--untracked-files=all', '--ignored', '--', config.plans.dir, '.specplane/config.yaml'], main)) throw new PlanStateError('Cannot abandon: administrative inputs are dirty or untracked.');
  const wt = planWorktree(branch, main);
  if (wt && (tryRun(['ls-files', '--others', '--ignored', '--exclude-standard'], wt) ?? '').trim()) throw new PlanStateError('Cannot abandon: ignored files exist in the worktree; preserve them before removal.');
  requireCleanWorktree(wt, "abandon plan", opts.force === true);
  const cur = git(["rev-parse", "--abbrev-ref", "HEAD"], main);
  if (cur !== def) {
    throw new PlanStateError(`Cannot abandon plan \`${id}\`: the main checkout is on \`${cur}\`, not \`${def}\`. Switch to \`${def}\` and run abandon again.`);
  }
  if ((tryRun(["status", "--porcelain", "--", relDir], main) ?? "").trim() !== "") {
    throw new PlanStateError(`Cannot abandon plan \`${id}\`: \`${relDir}\` has uncommitted changes in the main checkout. Commit or discard them and run abandon again.`);
  }
  if (moves && fs.lstatSync(path.join(main, archiveRel), { throwIfNoEntry: false })) {
    throw new PlanStateError(`Cannot abandon plan \`${id}\`: \`${archiveRel}\` already exists.`);
  }

  // Reserve the mechanical operation before changing the worktree.
  if (fs.existsSync(journal)) throw new PlanStateError('Pending abandonment record exists; reconcile it before continuing.');
  if (tryRun(['config', '--bool', '--get', 'core.logAllRefUpdates'], main)?.trim() === 'false') throw new PlanStateError('HEAD reflog recording is disabled; enable it before abandonment.');
  const initialLog = fs.readFileSync(headLog(main));
  if (initialLog.length && initialLog[initialLog.length - 1] !== 10) throw new PlanStateError('Incomplete HEAD reflog; reconcile before abandonment.');

  // 2. Write.
  if (!isDeepStrictEqual(report.ref_freshness, planReport(id, config, root, null).ref_freshness)) throw new PlanStateError('Target or plan refs changed during abandonment; retry.');
  lease.assertOwned();
  const result: AbandonResult = { planId: id, committed: false, archived: false, worktreeRemoved: false, branchDeleted: false };
  const original = fs.readFileSync(rec.planFile, 'utf8');
  const changed = abandonedText(original);
  const outputStat = fs.lstatSync(path.join(main, config.plans.dir, 'PLANS.md'), { throwIfNoEntry: false });
  if (outputStat && (!outputStat.isFile() || outputStat.nlink !== 1)) throw new PlanStateError('Cannot abandon: plan index must be a regular file with one link.');
  const snapshot = capturePlanSnapshot(main, 'head');
  const indexRel = snapshot.outputPath;
  const indexFile = path.join(main, indexRel);
  const indexOriginal = snapshot.outputBytes ?? null;
  const outputPresent = fs.existsSync(indexFile);
  if (snapshot.identity !== targetRecord.ref || !snapshot.plans.some(p => p.path === `${relDir}/PLAN.md` && p.bytes.toString('utf8') === original) ||
      (indexOriginal === null ? outputPresent : !outputPresent || !fs.readFileSync(indexFile).equals(indexOriginal)))
    throw new PlanStateError('Cannot abandon: target snapshot or plan index differs from HEAD.');
  const edits = new Map<string, Buffer | null>([[`${relDir}/PLAN.md`, moves ? null : Buffer.from(changed)]]);
  if (moves) edits.set(`${archiveRel}/PLAN.md`, Buffer.from(changed));
  const generated = generatePlansMd(prospectivePlanSnapshot(main, snapshot, edits));
  if (opts.preview) {
    recheckPlanSnapshot(main, snapshot);
    lease.assertOwned();
    opts.preview({ checkout: main, target: def, parent: snapshot.identity,
      changes: [
        { path: `${relDir}/PLAN.md`, before: original, after: moves ? null : changed },
        ...(moves ? [{ path: `${archiveRel}/PLAN.md`, before: null, after: changed }] : []),
        { path: indexRel, before: indexOriginal?.toString('utf8') ?? null, after: generated },
      ], archive: moves ? { from: relDir, to: archiveRel } : null,
      removeWorktree: wt, deleteBranch: opts.deleteBranch ? branch : null, publish: hasRemote(main),
    });
    return result;
  }
  const paths = [relDir, ...(moves ? [archiveRel] : []), indexRel];
  const before = git(['rev-parse', 'HEAD'], main);
  let staged: string | null = null;
  let expectedTree: string | null = null;
  let pending: AbandonPending | null = null;
  let journalBytes: string | null = null;
  let journalCreated = false;
  let journalFd: number | null = null;
  let outputWritten = false;
  try {
    recheckPlanSnapshot(main, snapshot);
    fs.mkdirSync(journalDir, { recursive: true });
    if (!fs.lstatSync(journalDir).isDirectory()) throw new PlanStateError('Invalid pending abandonment directory.');
    journalFd = fs.openSync(journal, 'wx', 0o600);
    journalCreated = true;
    journalBytes = JSON.stringify({ version: 1, id, state: 'preparing' }) + '\n';
    fs.writeFileSync(journalFd, journalBytes);
    fs.writeFileSync(rec.planFile, changed);
    if (moves) {
      fs.mkdirSync(path.join(main, config.plans.dir, 'archive'), { recursive: true });
      git(['mv', relDir, archiveRel], main);
      result.archived = true;
    }
    fs.writeFileSync(indexFile, generated);
    outputWritten = true;
    staged = run('git', ['diff', '--cached', '--binary'], { cwd: main });
    const writtenFile = path.join(main, moves ? `${archiveRel}/PLAN.md` : `${relDir}/PLAN.md`);
    const otherAdmin = git(['status', '--porcelain', '--untracked-files=all', '--ignored', '--', config.plans.dir, '.specplane/config.yaml', `:(exclude)${relDir}`, `:(exclude)${archiveRel}`, `:(exclude)${indexRel}`], main);
    if (otherAdmin || !isDeepStrictEqual(trees, listWorktrees(root)) || !isDeepStrictEqual(report.ref_freshness, planReport(id, config, root, null).ref_freshness) || git(['rev-parse', 'HEAD'], main) !== before || fs.readFileSync(writtenFile, 'utf8') !== changed || fs.readFileSync(indexFile, 'utf8') !== generated)
      throw new PlanStateError('Administrative inputs or refs changed during abandonment; retry.');
    lease.assertOwned();
    git(['add', '--', `${moves ? archiveRel : relDir}/PLAN.md`, indexRel], main);
    staged = run('git', ['diff', '--cached', '--binary'], { cwd: main });
    const stagedFiles = git(['diff', '--cached', '--name-only', '--no-renames', '-z'], main).split('\0').filter(Boolean);
    const sourceFiles = git(['ls-tree', '-r', '--name-only', '-z', before, '--', relDir], main).split('\0').filter(Boolean);
    const expectedFiles = [...(moves ? sourceFiles.flatMap(f => [f, `${archiveRel}/${f.slice(relDir.length + 1)}`]) : [`${relDir}/PLAN.md`]),
      ...(indexOriginal?.toString('utf8') === generated ? [] : [indexRel])].sort();
    const treeEntries = (ref: string, dir: string) => git(['ls-tree', '-r', '-z', ref, '--', dir], main).split('\0').filter(Boolean).map(entry => { const tab = entry.indexOf('\t'); return `${entry.slice(0, tab)}\t${entry.slice(tab + 1).slice(dir.length + 1)}`; }).filter(entry => !entry.endsWith('\tPLAN.md')).sort();
    const indexTree = git(['write-tree'], main);
    expectedTree = indexTree;
    if (!isDeepStrictEqual(stagedFiles.sort(), expectedFiles) || !isDeepStrictEqual(treeEntries(before, relDir), treeEntries(indexTree, moves ? archiveRel : relDir)) ||
        git(['ls-tree', before, '--', `${relDir}/PLAN.md`], main).split(' ')[0] !== git(['ls-tree', indexTree, '--', `${moves ? archiveRel : relDir}/PLAN.md`], main).split(' ')[0] ||
        git(['status', '--porcelain', '--untracked-files=all', '--ignored', '--', moves ? archiveRel : relDir], main).split('\n').some(line => line && (line[1] !== ' ' || line.startsWith('??') || line.startsWith('!!'))) ||
        run('git', ['show', `:${moves ? archiveRel : relDir}/PLAN.md`], { cwd: main }) !== changed || fs.readFileSync(writtenFile, 'utf8') !== changed ||
        run('git', ['show', `:${indexRel}`], { cwd: main }) !== generated || fs.readFileSync(indexFile, 'utf8') !== generated) throw new PlanStateError('Abandonment index or plan files changed; inspect before retrying.');
    const msg = formatMessage({ type: 'chore', scope: 'specplane', summary: `abandon ${id}`, trailers: cliTrailers('abandon', id) });
    const log = fs.readFileSync(headLog(main));
    pending = { version: 1, id, target: def, parent: before, tree: indexTree, planLocal: report.ref_freshness.plan_local, planRemote: report.ref_freshness.plan_remote, deleteBranch: opts.deleteBranch === true, force: opts.force === true, logLength: log.length, logHash: hashBytes(log) };
    const preparingBytes = journalBytes;
    journalBytes = JSON.stringify(pending) + '\n';
    if (journalFd === null || !fs.existsSync(journal) || fs.lstatSync(journal).isSymbolicLink() || fs.statSync(journal).ino !== fs.fstatSync(journalFd).ino || fs.readFileSync(journal, 'utf8') !== preparingBytes) throw new PlanStateError('Pending abandonment record changed; reconcile it.');
    fs.ftruncateSync(journalFd, 0);
    fs.writeSync(journalFd, journalBytes, 0, 'utf8');
    fs.closeSync(journalFd); journalFd = null;
    run('git', ['commit', '-m', msg], { cwd: main });
    result.committed = true;
  } catch (e) {
    if (journalFd !== null) { fs.closeSync(journalFd); journalFd = null; }
    const head = git(['rev-parse', 'HEAD'], main);
    const logMoved = pending !== null && (!fs.existsSync(headLog(main)) || fs.readFileSync(headLog(main)).length !== pending.logLength || hashBytes(fs.readFileSync(headLog(main))) !== pending.logHash);
    if (head !== before || logMoved) {
      let actual = 'unknown';
      try { if (pending) actual = pendingCommit(main, pending); } catch { /* retain ambiguous state */ }
      throw new PlanStateError(`Recording failed; HEAD moved to ${head}; first recorded commit ${actual} retained for reconciliation: ${String(e)}`);
    }
    if (!journalCreated) throw e;
    const writtenFile = path.join(main, moves ? `${archiveRel}/PLAN.md` : `${relDir}/PLAN.md`);
    const current = run('git', ['diff', '--cached', '--binary'], { cwd: main });
    const outputSafe = outputWritten ? fs.existsSync(indexFile) && fs.readFileSync(indexFile, 'utf8') === generated :
      indexOriginal === null ? !fs.existsSync(indexFile) : fs.existsSync(indexFile) && fs.readFileSync(indexFile).equals(indexOriginal);
    if (!outputSafe || !fs.existsSync(writtenFile) || fs.readFileSync(writtenFile, 'utf8') !== changed || (staged === null ? current !== '' : staged !== current) || git(['status', '--porcelain', '--untracked-files=all', '--ignored', '--', ...paths], main).split('\n').some(line => line && (line[1] !== ' ' || line.startsWith('??') || line.startsWith('!!'))) || (moves && fs.existsSync(path.join(main, relDir)))) throw new PlanStateError(`Abandonment edits retained for inspection: ${String(e)}`);
    git(['reset', '-q', 'HEAD', '--', ...paths], main);
    if (moves) fs.renameSync(path.join(main, archiveRel), path.join(main, relDir));
    fs.writeFileSync(rec.planFile, original);
    if (outputWritten) { if (indexOriginal === null) fs.unlinkSync(indexFile); else fs.writeFileSync(indexFile, indexOriginal); }
    if (journalCreated && journalBytes !== null && fs.existsSync(journal) && fs.readFileSync(journal, 'utf8') === journalBytes) fs.unlinkSync(journal);
    throw e;
  }
  if (!pending) throw new PlanStateError('Pending abandonment record missing; reconcile the operation.');
  const commit = pendingCommit(main, pending);
  validatePendingCommit(main, pending, commit);
  const movedHead = git(['rev-parse', 'HEAD'], main);
  if (movedHead !== commit) throw new PlanStateError(`Abandonment commit ${commit} retained; HEAD moved to ${movedHead}; reconcile before publication.`);
  if (!expectedTree || git(['rev-parse', `${commit}^{tree}`], main) !== expectedTree) throw new PlanStateError(`Abandonment commit ${commit} retained; committed tree changed during recording.`);
  const verifyJournal = () => { if (!fs.existsSync(journal) || fs.readFileSync(journal, 'utf8') !== journalBytes) throw new PlanStateError(`Abandonment commit ${commit} retained; pending record changed before continuing.`); };
  verifyJournal();
  verifyPlanIndex(commit);
  const beforePublication = planReport(id, config, main, null).ref_freshness;
  if (beforePublication.target_local !== commit || beforePublication.target_remote !== report.ref_freshness.target_remote || beforePublication.plan_local !== report.ref_freshness.plan_local || beforePublication.plan_remote !== report.ref_freshness.plan_remote) throw new PlanStateError(`Abandonment commit ${commit} retained; refs changed before publication.`);
  lease.assertOwned();
  if (hasRemote(main)) try {
    verifyJournal();
    if (git(['rev-parse', 'HEAD'], main) !== commit) throw new PlanStateError('Target changed.');
    git(['push', 'origin', `${commit}:refs/heads/${def}`], main);
  } catch (e) { throw new PlanStateError(`Publication pending for ${commit}: ${String(e)}`); }
  const finished = finishAbandonCleanup(commit, result.archived, true, verifyJournal);
  if (fs.readFileSync(journal, 'utf8') !== journalBytes) throw new PlanStateError(`Abandonment commit ${commit} retained; pending record changed before completion.`);
  fs.unlinkSync(journal);
  return finished;
  } finally { if (!opts.lease) lease.release(); }
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
  if (fs.lstatSync(path.join(root, dest), { throwIfNoEntry: false })) throw new PlanStateError(`Cannot archive plan: \`${dest}\` already exists.`);
  if ((tryRun(["status", "--porcelain", "--", relDir], root) ?? "").trim() !== "") {
    throw new PlanStateError(`Cannot archive plan: \`${relDir}\` has uncommitted changes. Commit or discard them first.`);
  }
  if (git(['diff', '--cached', '--name-only'], root)) throw new PlanStateError('Cannot archive plan: index has staged changes.');
  const ignored = ignoredFiles(root).find(f => f.startsWith(`${relDir}/`));
  if (ignored) throw new PlanStateError(`Cannot archive plan: ignored file \`${ignored}\` would move.`);
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
