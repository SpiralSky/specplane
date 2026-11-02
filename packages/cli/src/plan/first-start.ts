import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { acquireWriterLease, type WriterLease } from "../core/writer-leases.js";
import { PlanStateError } from "../errors.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { mainRoot } from "../git/repo.js";
import { createWorktree, listWorktrees, removeWorktree } from "../git/worktree.js";
import type { Config } from "../types.js";
import { getPlanActivity, hasRemote, showFile } from "./activity.js";
import { runSetupHook } from "./hooks.js";
import { bindFrontmatter, claimFrontmatter } from "./start-frontmatter.js";
import { prepareStart, type PreparedStart, type LegacyDefaultEvidence } from "./prepare-start.js";
import { mergedStackBase, type StartResult } from "./flows.js";

function ref(cwd: string, name: string): string | null {
  try { return run("git", ["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd }).trim(); } catch { return null; }
}
function message(workflow: string, id: string, summary: string, extra: Record<string, string> = {}): string {
  return formatMessage({ type: "chore", scope: "specplane", summary, trailers: { ...cliTrailers(workflow, id), ...extra } });
}
function bindingCommit(cwd: string, base: string, file: string, id: string, target: string, startBase: string): string {
  const original = showFile(base, file, cwd);
  if (original === null) throw new PlanStateError(`Plan file ${file} is absent from the start base.`);
  const updated = bindFrontmatter(original, target, startBase);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-start-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(tmp, "index") };
    const git = (args: string[], input?: string) => execFileSync("git", args, { cwd, env, encoding: "utf8", ...(input === undefined ? {} : { input }), stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }).trim();
    git(["read-tree", base]);
    const blob = git(["hash-object", "-w", "--stdin"], updated);
    const mode = /^(\d+) blob /.exec(git(["ls-tree", base, "--", file]))?.[1];
    if (!mode) throw new PlanStateError("Cannot determine plan file mode.");
    git(["update-index", "--add", "--cacheinfo", `${mode},${blob},${file}`]);
    return git(["commit-tree", git(["write-tree"]), "-p", base, "-F", "-"], message("start", id, `start ${id}`));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function checkCheckout(p: PreparedStart, root: string, trees: ReturnType<typeof listWorktrees>): void {
  const targetTree = trees.find(w => w.branch === p.context.targetBranch);
  const file = `${p.config.plans.dir}/${p.plan.id}/PLAN.md`;
  if (p.config.plans.status_source === "frontmatter") {
    if (!targetTree || ref(root, `refs/heads/${p.context.targetBranch}`) !== p.context.targetCommit || ref(targetTree.path, "HEAD") !== p.context.targetCommit) throw new PlanStateError(`Claim requires a local checkout of ${p.context.targetBranch} at the selected target commit.`);
    if (run("git", ["diff", "--cached", "--name-only"], { cwd: targetTree.path }).trim() || run("git", ["status", "--porcelain", "--", file], { cwd: targetTree.path }).trim()) throw new PlanStateError("Claim requires a clean plan file and index in the target checkout.");
  }
  if (p.config.execution.backend === "branch" && run("git", ["status", "--porcelain"], { cwd: root }).trim()) throw new PlanStateError("Cannot start plan: the working tree has uncommitted changes. Commit or stash them first.");
}
export function recheckStartRefs(cwd: string, refs: Record<string, string | null>): void {
  for (const [name, value] of Object.entries(refs)) if (ref(cwd, name) !== value) throw new PlanStateError(`Ref ${name} changed during preparation; retry.`);
}
/** Reacquire a complete ordered lease set after registering a new checkout. */
export function acquireStartCheckouts(id: string, plans: string[], checkouts: string[]): WriterLease {
  return acquireWriterLease({ repository: true, plans: [id, ...plans], checkouts, requestId: `start-${randomUUID()}` });
}
function checkResumeRef(p: PreparedStart): void {
  const local = p.refs[`refs/heads/plan/${p.plan.id}`];
  if (!p.first && local && local !== p.base) throw new PlanStateError("Local plan branch differs from the selected recorded history; reconcile it before resuming.");
}
export interface FirstStartOptions { fetch?: boolean; target?: string; dryRun?: boolean; /** Trusted caller attestation of an independently verified historical-default record. */ legacyEvidence?: LegacyDefaultEvidence }
export function firstStart(id: string, discovery: Config, root: string, opts: FirstStartOptions = {}): StartResult {
  const main = mainRoot(root);
  if (opts.dryRun) {
    const p = prepareStart(id, discovery, root, { target: opts.target, legacyEvidence: opts.legacyEvidence });
    checkResumeRef(p);
    if (p.first) checkCheckout(p, root, listWorktrees(main));
    else if (p.config.execution.backend === "branch" && run("git", ["status", "--porcelain"], { cwd: root }).trim()) throw new PlanStateError("Cannot resume plan: the working tree has uncommitted changes. Commit or stash them first.");
    return { planId: id, branch: `plan/${id}`, backend: p.config.execution.backend, resumed: !p.first, path: null, nextCommand: null, next: null, notices: [], checkoutCreated: null, dryRun: true, target: p.context.targetBranch, startBase: p.first ? p.base : p.context.binding?.start_base ?? null, freshness: p.context.freshness, target_branch: p.context.targetBranch, start_base: p.first ? p.base : p.context.binding?.start_base ?? null, legacy: p.context.legacy, comparison_base: p.context.comparisonBase, ref_freshness: p.context.freshness };
  }
  const initialTrees = listWorktrees(main);
  const planIds = run("git", ["for-each-ref", "--format=%(refname)", "refs/heads/plan/", "refs/remotes/origin/plan/"], { cwd: main }).split("\n").map(name => name.replace(/^refs\/(?:heads|remotes\/origin)\/plan\//, "")).filter(Boolean);
  let lease: WriterLease | null = acquireStartCheckouts(id, planIds, initialTrees.filter(w => !w.bare).map(w => w.path));
  let claim: string | null = null; let binding: string | null = null; let branchCreated = false; let resumed = false; let published = false;
  try {
    lease.assertOwned();
    if (hasRemote(main) && opts.fetch !== false) run("git", ["fetch", "origin", "+refs/heads/*:refs/remotes/origin/*"], { cwd: main });
    const p = prepareStart(id, discovery, root, { target: opts.target, freshness: hasRemote(main) && opts.fetch !== false ? "fetched" : "local", legacyEvidence: opts.legacyEvidence });
    resumed = !p.first;
    checkResumeRef(p);
    if (p.context.targetBranch.startsWith("plan/") && !planIds.includes(p.context.targetBranch.slice(5))) throw new PlanStateError("Target plan appeared during fetch; retry to acquire its lease.");
    if (p.stackId && !planIds.includes(p.stackId)) throw new PlanStateError("Stack dependency appeared during fetch; retry to acquire its lease.");
    const trees = listWorktrees(main);
    if (JSON.stringify(trees) !== JSON.stringify(initialTrees)) throw new PlanStateError("Checkout set changed during preparation; retry.");
    const targetTree = trees.find(w => w.branch === p.context.targetBranch);
    const file = `${p.config.plans.dir}/${id}/PLAN.md`;
    const frontmatter = p.config.plans.status_source === "frontmatter";
    if (p.first) checkCheckout(p, root, trees);
    else if (p.config.execution.backend === "branch" && run("git", ["status", "--porcelain"], { cwd: root }).trim()) throw new PlanStateError("Cannot resume plan: the working tree has uncommitted changes. Commit or stash them first.");
    lease.assertOwned();
    recheckStartRefs(main, p.refs);
    let base = p.base;
    if (p.first && frontmatter && targetTree && !p.recoveryClaim) {
      const filename = path.join(targetTree.path, file); const before = fs.readFileSync(filename, "utf8");
      const edited = claimFrontmatter(before);
      fs.writeFileSync(filename, edited);
      try { run("git", ["commit", "-F", "-", "--", file], { cwd: targetTree.path, input: message("claim", id, `claim ${id} in_progress`) }); }
      catch (e) {
        const after = ref(targetTree.path, "HEAD");
        if (after !== p.context.targetCommit) throw new PlanStateError(`Target HEAD changed to ${after ?? "unavailable"} while claim commit failed; inspect checkout and index: ${String(e)}`);
        const current = fs.readFileSync(filename, "utf8");
        const index = run("git", ["show", `:${file}`], { cwd: targetTree.path });
        if (current === edited) fs.writeFileSync(filename, before);
        if (index === edited) run("git", ["reset", "-q", "HEAD", "--", file], { cwd: targetTree.path });
        if (current !== edited || (index !== edited && index !== before)) throw new PlanStateError(`Claim commit failed and claim file or index changed unexpectedly; inspect ${filename}: ${String(e)}`);
        throw e;
      }
      claim = ref(targetTree.path, "HEAD");
    }
    if (p.first && frontmatter && targetTree) {
      if (p.recoveryClaim) claim = p.recoveryClaim;
      if (hasRemote(main)) { run("git", ["push", "origin", p.context.targetBranch], { cwd: targetTree.path }); published = true; }
      if (!p.stackId) base = claim!;
    }
    const startBase = p.first ? base : p.context.binding?.start_base ?? null;
    if (p.first && p.stackId) base = run("git", ["commit-tree", `${base}^{tree}`, "-p", base, "-F", "-"], { cwd: main, input: message("stack", id, `stack ${id} on ${p.stackId}`, { "Specplane-Stack-Base": base }) }).trim();
    if (p.first) {
      binding = bindingCommit(main, base, file, id, p.context.targetBranch, startBase ?? base);
      run("git", ["update-ref", `refs/heads/plan/${id}`, binding, ""], { cwd: main });
      branchCreated = true;
    } else {
      const local = p.refs[`refs/heads/plan/${id}`];
      if (!local) { run("git", ["branch", "--track", `plan/${id}`, `refs/remotes/origin/plan/${id}`], { cwd: main }); branchCreated = true; }
      binding = p.base;
    }
    const branch = `plan/${id}`; let checkout: string | null = null; let checkoutCreated: boolean | null = null;
    if (p.config.execution.backend === "worktree") {
      const worktree = createWorktree(id, branch, p.config, main, { noCheckout: true });
      checkout = worktree.path; checkoutCreated = worktree.created;
      if (!worktree.created && !initialTrees.some(w => w.path === checkout)) throw new PlanStateError(`Existing checkout ${checkout} was not leased; retained for recovery.`);
      if (worktree.created) {
        // Never upgrade a lease: release, reacquire the entire ordered set, and
        // revalidate the exposed checkout before running any writer in it.
        const postMutationRefs = { ...p.refs, [`refs/heads/${branch}`]: binding };
        if (claim) {
          postMutationRefs[`refs/heads/${p.context.targetBranch}`] = claim;
          if (published) postMutationRefs[`refs/remotes/origin/${p.context.targetBranch}`] = claim;
        }
        recheckStartRefs(main, postMutationRefs);
        lease.release(); lease = null;
        const currentTrees = listWorktrees(main);
        lease = acquireStartCheckouts(id, planIds, currentTrees.filter(w => !w.bare).map(w => w.path));
        lease.assertOwned();
        recheckStartRefs(main, postMutationRefs);
        const checkedTrees = listWorktrees(main);
        if (JSON.stringify(checkedTrees) !== JSON.stringify(currentTrees)) throw new PlanStateError(`Checkout set changed during coordination; ${checkout} retained for recovery.`);
        const selected = checkedTrees.find(w => w.path === checkout);
        if (!selected || selected.branch !== branch || ref(main, `refs/heads/${branch}`) !== binding || ref(checkout, "HEAD") !== binding || fs.readdirSync(checkout).some(name => name !== ".git") || run("git", ["ls-files", "--stage", "-z"], { cwd: checkout }) !== "") throw new PlanStateError(`New checkout ${checkout} changed during coordination; retained for recovery.`);
        run("git", ["read-tree", "-m", "-u", "HEAD"], { cwd: checkout });
        if (run("git", ["status", "--porcelain", "--ignored"], { cwd: checkout }).trim()) throw new PlanStateError(`New checkout ${checkout} changed during population; retained for recovery.`);
      }
      if (worktree.created && p.config.plans.setup_hook.trim()) {
        try { runSetupHook(p.config.plans.setup_hook, checkout); }
        catch (e) { try { removeWorktree(id, p.config, { force: true }, main); } catch (cleanup) { throw new PlanStateError(`Setup failed; checkout ${checkout} retained for recovery: ${String(cleanup)}`); } throw e; }
      }
    } else if (p.config.execution.backend === "branch") run("git", ["switch", branch], { cwd: root });
    const next = getPlanActivity(id, p.config, main).steps.next;
    const stackBase = !p.first ? mergedStackBase(id, p.config, main, p.context.targetBranch) : null;
    const notices = stackBase ? [`Base plan \`${stackBase}\` has merged; run \`specplane plan restack ${id}\`.`] : [];
    return { planId: id, branch, backend: p.config.execution.backend, resumed: !p.first, path: checkout, checkoutCreated, nextCommand: null, next, notices, target: p.context.targetBranch, startBase, freshness: p.context.freshness, target_branch: p.context.targetBranch, start_base: startBase, legacy: p.context.legacy, comparison_base: p.context.comparisonBase, ref_freshness: p.context.freshness };
  } catch (e) {
    if (claim || binding) throw new PlanStateError(`${String(e)}\nRecovery: ${claim ? `claim commit ${claim}${published ? " published" : hasRemote(main) ? "; publication pending" : ""}. ` : ""}${binding ? resumed ? `plan branch retains commit ${binding}; inspect checkout before retry.` : branchCreated ? `start commit ${binding} is on plan branch; inspect checkout before retry.` : `orphan start commit ${binding}; no plan branch was created by this invocation.` : ""}`);
    throw e;
  } finally { if (lease) lease.release(); }
}
