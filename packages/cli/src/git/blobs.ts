import { GitError } from "../errors.js";
import { run } from "./exec.js";

const git = (args: string[], cwd: string): string => run("git", args, { cwd }).trim();

/** Blob hash of `path` (relative to `cwd`) at `ref`; null when the path is not committed there. */
export function committedBlob(path: string, cwd: string, ref = "HEAD"): string | null {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}:${path}`], cwd) || null;
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

/** True when `path` has staged, unstaged, or untracked changes. */
export function hasUncommittedChanges(path: string, cwd: string): boolean {
  return run("git", ["status", "--porcelain", "--", path], { cwd }).trim() !== "";
}

/** Contents of a blob; null when the object is missing (for example in a shallow clone). */
export function readBlob(hash: string, cwd: string): string | null {
  try {
    return run("git", ["cat-file", "blob", hash], { cwd });
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

/** Blob hash of the working-tree file `path`, without writing to the object store. */
export function workingBlob(path: string, cwd: string): string {
  return git(["hash-object", "--", path], cwd);
}

/** Abbreviate a hash to 7 characters, longer only if ambiguous. */
export function abbrev(hash: string, cwd: string): string {
  try {
    return git(["rev-parse", "--short=7", hash], cwd);
  } catch (e) {
    if (e instanceof GitError) return hash.slice(0, 7);
    throw e;
  }
}
