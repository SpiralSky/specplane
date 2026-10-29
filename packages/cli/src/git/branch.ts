import { GitError, RebaseConflictError } from "../errors.js";
import { run } from "./exec.js";

function refExists(ref: string, cwd: string): boolean {
  try {
    run("git", ["show-ref", "--verify", "--quiet", ref], { cwd });
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

/** True when the local branch `refs/heads/<name>` exists. */
export function branchExists(name: string, cwd: string = process.cwd()): boolean {
  return refExists(`refs/heads/${name}`, cwd);
}

/** True when `refs/remotes/origin/<name>` exists. */
export function remoteBranchExists(name: string, cwd: string = process.cwd()): boolean {
  return refExists(`refs/remotes/origin/${name}`, cwd);
}

/** `git branch <name> <from>`; does not switch any checkout. */
export function createBranch(name: string, from: string, cwd: string = process.cwd()): void {
  run("git", ["branch", name, from], { cwd });
}

/** `git branch -D <name>`; callers check the deletion precondition. */
export function deleteBranch(name: string, cwd: string = process.cwd()): void {
  run("git", ["branch", "-D", name], { cwd });
}

export interface RebaseOptions {
  /** What to do on conflict: abort (default, used by finish) or leave the checkout mid-rebase (restack). */
  onConflict?: "abort" | "leave";
}

/**
 * `git rebase --onto <newBase> <upstream> <branch>`, run in `cwd` (which checks `branch` out).
 * On conflict, aborts the rebase (the branch is left unchanged) unless `onConflict: "leave"`, and
 * throws `RebaseConflictError` listing the conflicting files.
 * A failure that left no rebase in progress is rethrown as the original GitError.
 */
export function rebaseOnto(
  newBase: string,
  upstream: string,
  branch: string,
  cwd: string = process.cwd(),
  opts: RebaseOptions = {},
): void {
  try {
    run("git", ["rebase", "--onto", newBase, upstream, branch], { cwd });
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    let files: string[] = [];
    try {
      files = run("git", ["diff", "--name-only", "--diff-filter=U"], { cwd }).split("\n").filter(Boolean);
    } catch {
      files = [];
    }
    if (opts.onConflict === "leave") throw new RebaseConflictError(branch.replace(/^plan\//, ""), newBase, files);
    try {
      run("git", ["rebase", "--abort"], { cwd });
    } catch {
      throw e;
    }
    throw new RebaseConflictError(branch.replace(/^plan\//, ""), newBase, files);
  }
}
