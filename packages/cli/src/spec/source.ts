import * as fs from "node:fs";
import * as path from "node:path";
import { GitError } from "../errors.js";
import { run } from "../git/exec.js";

/** Where file text is read from: the working tree or a committed revision (`architecture/reference-cli` §4.3). */
export interface Source {
  kind: "worktree" | "committed";
  rev?: string;
  /** File text, or null when the file does not exist there. */
  read(file: string): string | null;
  /** Names of the files directly inside a directory (sorted); empty when the directory is absent. */
  list(dir: string): string[];
  /** True for an existing file or directory. */
  exists(file: string): boolean;
  /** Names of the sub-directories directly inside a directory (sorted). */
  listDirs(dir: string): string[];
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

export function worktreeSource(root: string): Source {
  return {
    kind: "worktree",
    read(file) {
      try { return fs.readFileSync(path.join(root, file), "utf8"); } catch { return null; }
    },
    list(dir) {
      try {
        return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort();
      } catch { return []; }
    },
    exists(file) { return fs.existsSync(path.join(root, file)); },
    listDirs(dir) {
      try {
        return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
      } catch { return []; }
    },
  };
}

export function committedSource(root: string, rev: string): Source {
  const cache = new Map<string, string | null>();
  const git = (args: string[]): string | null => {
    try { return run("git", args, { cwd: root }); } catch (e) { if (e instanceof GitError) return null; throw e; }
  };
  return {
    kind: "committed",
    rev,
    read(file) {
      const f = norm(file);
      if (!cache.has(f)) cache.set(f, git(["show", `${rev}:${f}`]));
      return cache.get(f) ?? null;
    },
    list(dir) {
      const d = norm(dir);
      const out = git(["ls-tree", "-z", "--name-only", rev, `${d}/`]);
      if (!out) return [];
      return out.split("\0").filter(Boolean).map((p) => p.slice(d.length + 1)).filter((n) => !n.includes("/")).sort();
    },
    exists(file) { return git(["rev-parse", "--verify", "--quiet", `${rev}:${norm(file)}`]) !== null; },
    listDirs(dir) {
      const d = norm(dir);
      const out = git(["ls-tree", "-d", "-z", "--name-only", rev, `${d}/`]);
      if (!out) return [];
      return out.split("\0").filter(Boolean).map((p) => p.slice(d.length + 1)).sort();
    },
  };
}

/** True when the commit exists in this repository. */
export function commitExists(root: string, rev: string): boolean {
  try { run("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: root }); return true; } catch { return false; }
}

/** Hash of HEAD, or null in a repository with no commits. */
export function headCommit(root: string): string | null {
  try { return run("git", ["rev-parse", "--verify", "HEAD"], { cwd: root }).trim(); } catch { return null; }
}
