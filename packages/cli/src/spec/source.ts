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

const HEX40 = /^[0-9a-f]{40}$/;
/** Blob text at a full commit id: immutable, so it is kept for the process. Key: `root \0 sha:path`; null when the file is absent. */
const blobs = new Map<string, string | null>();

/**
 * Read `sha:path` blobs for many commits with one `git cat-file --batch` instead of one `git show` each. Only full
 * commit ids are used, and only blobs are kept (a path that is a directory is left to the normal read).
 */
export function prefetchBlobs(root: string, refs: readonly string[]): void {
  const want = [...new Set(refs)].filter((r) => HEX40.test(r.slice(0, 40)) && r[40] === ":" && !blobs.has(`${root}\0${r}`));
  if (want.length < 2) return;
  let out: Buffer;
  try { out = run("git", ["cat-file", "--batch"], { cwd: root, input: want.join("\n") + "\n", binary: true }); } catch { return; }
  let pos = 0;
  for (const ref of want) {
    const nl = out.indexOf(10, pos);
    if (nl < 0) return;
    const header = out.subarray(pos, nl).toString("utf8");
    if (header.endsWith(" missing")) { blobs.set(`${root}\0${ref}`, null); pos = nl + 1; continue; }
    const [, type, size] = header.split(" ");
    const n = Number(size);
    if (type === undefined || !Number.isInteger(n)) return;
    if (type === "blob") blobs.set(`${root}\0${ref}`, out.subarray(nl + 1, nl + 1 + n).toString("utf8"));
    pos = nl + 1 + n + 1;
  }
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
      if (!cache.has(f)) {
        const pre = HEX40.test(rev) ? blobs.get(`${root}\0${rev}:${f}`) : undefined;
        cache.set(f, pre !== undefined ? pre : git(["show", `${rev}:${f}`]));
      }
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

/** The index (what `git commit` would record), read with `git show :<path>` (`architecture/reference-cli` §14.2). */
export function indexSource(root: string): Source {
  const git = (args: string[]): string | null => {
    try { return run("git", args, { cwd: root }); } catch (e) { if (e instanceof GitError) return null; throw e; }
  };
  const files = (dir: string): string[] => (git(["ls-files", "-z", "--", `${norm(dir)}/`]) ?? "").split("\0").filter(Boolean);
  return {
    kind: "worktree",
    read(file) { return git(["show", `:${norm(file)}`]); },
    list(dir) {
      const d = norm(dir);
      return files(d).map((p) => p.slice(d.length + 1)).filter((n) => !n.includes("/")).sort();
    },
    exists(file) { const f = norm(file); return files(f).length > 0 || git(["ls-files", "--error-unmatch", "--", f]) !== null; },
    listDirs(dir) {
      const d = norm(dir);
      return [...new Set(files(d).map((p) => p.slice(d.length + 1)).filter((n) => n.includes("/")).map((n) => n.split("/")[0]))].sort();
    },
  };
}

/** Repository-relative paths staged for the next commit (added, copied, modified, renamed). */
export function stagedFiles(root: string): string[] {
  return run("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], { cwd: root }).split("\0").filter(Boolean);
}
