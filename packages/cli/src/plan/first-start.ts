import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { acquireWriterLease } from "../core/writer-leases.js";
import { PlanStateError } from "../errors.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { mainRoot } from "../git/repo.js";
import { createWorktree, listWorktrees, removeWorktree } from "../git/worktree.js";
import type { Config } from "../types.js";
import { getPlanActivity, hasRemote, showFile } from "./activity.js";
import { runSetupHook } from "./hooks.js";
import { prepareStart, type PreparedStart } from "./prepare-start.js";
import type { StartResult } from "./flows.js";

function ref(cwd: string, name: string): string | null {
  try { return run("git", ["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd }).trim(); } catch { return null; }
}
function message(workflow: string, id: string, summary: string, extra: Record<string, string> = {}): string {
  return formatMessage({ type: "chore", scope: "specplane", summary, trailers: { ...cliTrailers(workflow, id), ...extra } });
}
function bindingCommit(cwd: string, base: string, file: string, id: string, target: string, startBase: string): string {
  const original = showFile(base, file, cwd);
  if (original === null) throw new PlanStateError(`Plan file ${file} is absent from the start base.`);
  const end = original.indexOf("\n---", 3);
  if (!original.startsWith("---\n") || end < 0 || /^execution:/m.test(original.slice(0, end))) throw new PlanStateError("Cannot add execution binding to plan frontmatter.");
  const encoded = JSON.stringify(target);
  const updated = `${original.slice(0, end)}\nexecution:\n  target_branch: ${encoded}\n  start_target_branch: ${encoded}\n  start_base: ${startBase}${original.slice(end)}`;
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
export interface FirstStartOptions { fetch?: boolean; target?: string; dryRun?: boolean }
export function firstStart(id: string, discovery: Config, root: string, opts: FirstStartOptions = {}): StartResult & { dryRun?: boolean; target: string; startBase: string; freshness: string } {
  const main = mainRoot(root);
  if (opts.dryRun) {
    const p = prepareStart(id, discovery, root, { target: opts.target });
    if (!p.first) throw new PlanStateError("Resume of an existing plan requires the next lifecycle implementation; no changes made.");
    checkCheckout(p, root, listWorktrees(main));
    return { planId: id, branch: `plan/${id}`, backend: p.config.execution.backend, resumed: false, path: null, nextCommand: null, next: null, notices: [], dryRun: true, target: p.context.targetBranch, startBase: p.base, freshness: p.context.freshness };
  }
  const initialTrees = listWorktrees(main);
  const planIds = run("git", ["for-each-ref", "--format=%(refname)", "refs/heads/plan/", "refs/remotes/origin/plan/"], { cwd: main }).split("\n").map(name => name.replace(/^refs\/(?:heads|remotes\/origin)\/plan\//, "")).filter(Boolean);
  const lease = acquireWriterLease({ repository: true, plans: [id, ...planIds], checkouts: initialTrees.filter(w => !w.bare).map(w => w.path), requestId: `start-${randomUUID()}` });
  let claim: string | null = null; let binding: string | null = null; let published = false;
  try {
    lease.assertOwned();
    if (hasRemote(main) && opts.fetch !== false) run("git", ["fetch", "origin", "+refs/heads/*:refs/remotes/origin/*"], { cwd: main });
    const p = prepareStart(id, discovery, root, { target: opts.target, freshness: hasRemote(main) && opts.fetch !== false ? "fetched" : "local" });
    if (!p.first) throw new PlanStateError("Resume of an existing plan requires the next lifecycle implementation; no changes made.");
    if (p.context.targetBranch.startsWith("plan/") && !planIds.includes(p.context.targetBranch.slice(5))) throw new PlanStateError("Target plan appeared during fetch; retry to acquire its lease.");
    const trees = listWorktrees(main);
    if (JSON.stringify(trees) !== JSON.stringify(initialTrees)) throw new PlanStateError("Checkout set changed during preparation; retry.");
    const targetTree = trees.find(w => w.branch === p.context.targetBranch);
    const file = `${p.config.plans.dir}/${id}/PLAN.md`;
    const frontmatter = p.config.plans.status_source === "frontmatter";
    checkCheckout(p, root, trees);
    lease.assertOwned();
    recheckStartRefs(main, p.refs);
    let base = p.base;
    if (frontmatter && targetTree) {
      const filename = path.join(targetTree.path, file); const before = fs.readFileSync(filename, "utf8");
      const end = before.indexOf("\n---", 3); const header = before.slice(0, end);
      if (end < 0 || !/^status:.*$/m.test(header)) throw new PlanStateError("Cannot safely edit claim status.");
      fs.writeFileSync(filename, header.replace(/^status:.*$/m, "status: in_progress") + before.slice(end));
      try { run("git", ["commit", "-F", "-", "--", file], { cwd: targetTree.path, input: message("claim", id, `claim ${id} in_progress`) }); }
      catch (e) { const after = ref(targetTree.path, "HEAD"); if (after === p.context.targetCommit) fs.writeFileSync(filename, before); else claim = after; throw e; }
      claim = ref(targetTree.path, "HEAD");
      if (hasRemote(main)) { run("git", ["push", "origin", p.context.targetBranch], { cwd: targetTree.path }); published = true; }
      if (!p.stackId) base = claim!;
    }
    const startBase = base;
    if (p.stackId) base = run("git", ["commit-tree", `${base}^{tree}`, "-p", base, "-F", "-"], { cwd: main, input: message("stack", id, `stack ${id} on ${p.stackId}`, { "Specplane-Stack-Base": base }) }).trim();
    binding = bindingCommit(main, base, file, id, p.context.targetBranch, startBase);
    run("git", ["update-ref", `refs/heads/plan/${id}`, binding, ""], { cwd: main });
    const branch = `plan/${id}`; let checkout: string | null = null;
    if (p.config.execution.backend === "worktree") {
      const worktree = createWorktree(id, branch, p.config, main);
      checkout = worktree.path;
      if (worktree.created && p.config.plans.setup_hook.trim()) {
        try { runSetupHook(p.config.plans.setup_hook, checkout); }
        catch (e) { try { removeWorktree(id, p.config, { force: true }, main); } catch (cleanup) { throw new PlanStateError(`Setup failed; checkout ${checkout} retained for recovery: ${String(cleanup)}`); } throw e; }
      }
    } else if (p.config.execution.backend === "branch") run("git", ["switch", branch], { cwd: root });
    const next = getPlanActivity(id, p.config, main).steps.next;
    return { planId: id, branch, backend: p.config.execution.backend, resumed: false, path: checkout, nextCommand: checkout ? `cd ${checkout} && claude` : p.config.execution.backend === "branch" ? "claude" : null, next, notices: [], target: p.context.targetBranch, startBase, freshness: p.context.freshness };
  } catch (e) {
    if (claim || binding) throw new PlanStateError(`${String(e)}\nRecovery: ${claim ? `claim commit ${claim}${published ? " published" : hasRemote(main) ? "; publication pending" : ""}. ` : ""}${binding ? `start commit ${binding}; inspect plan branch and checkout before retry.` : ""}`);
    throw e;
  } finally { lease.release(); }
}
