import * as path from "node:path";
import { GitError, NotARepoError } from "../errors.js";
import { run } from "./exec.js";

function git(args: string[], cwd: string): string {
  try {
    return run("git", args, { cwd }).trim();
  } catch (e) {
    if (e instanceof GitError && /not a git repository|ENOENT/i.test(e.message)) {
      throw new NotARepoError();
    }
    throw e;
  }
}

/** Root of the checkout the command runs in (`git rev-parse --show-toplevel`). */
export function checkoutRoot(cwd: string = process.cwd()): string {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

/** Root of the main checkout: the parent of the common git dir. Same from every linked worktree. */
export function mainRoot(cwd: string = process.cwd()): string {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return path.dirname(common);
}

/** Default branch: `origin/HEAD` if set, otherwise `main`, otherwise `master`. */
export function defaultBranch(cwd: string = process.cwd()): string {
  try {
    const ref = run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd }).trim();
    if (ref) return ref.replace(/^origin\//, "");
  } catch {
    // origin/HEAD not set
  }
  for (const name of ["main", "master"]) {
    try {
      run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { cwd });
      return name;
    } catch {
      // try next
    }
  }
  return "main";
}
