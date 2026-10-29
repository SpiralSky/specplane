import { GitError } from "../errors.js";
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
