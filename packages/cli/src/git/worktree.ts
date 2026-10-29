import * as path from "node:path";
import type { Config } from "../types.js";
import { run } from "./exec.js";
import { mainRoot } from "./repo.js";

export interface WorktreeInfo {
  path: string;
  head: string | null;
  /** Short branch name (`refs/heads/` stripped), null when detached or bare. */
  branch: string | null;
  bare: boolean;
  detached: boolean;
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreeList(porcelain: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    let info: WorktreeInfo | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        info = { path: line.slice(9), head: null, branch: null, bare: false, detached: false };
      } else if (!info) {
        continue;
      } else if (line.startsWith("HEAD ")) info.head = line.slice(5);
      else if (line.startsWith("branch ")) info.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare") info.bare = true;
      else if (line === "detached") info.detached = true;
    }
    if (info) result.push(info);
  }
  return result;
}

/** All worktrees of the repository (main checkout first). */
export function listWorktrees(cwd: string = process.cwd()): WorktreeInfo[] {
  return parseWorktreeList(run("git", ["worktree", "list", "--porcelain"], { cwd }));
}

/** Where the worktree for `planId` lives (architecture/reference-cli § `worktree.ts`). */
export function worktreePath(planId: string, config: Config, cwd: string = process.cwd()): string {
  const main = mainRoot(cwd);
  return path.resolve(main, config.execution.worktree_dir, path.basename(main), planId);
}
