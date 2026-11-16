import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Per-process cache for read-only git calls. Two kinds of entry:
 *  - immutable: the command names objects only by 40-hex id (e.g. `show <sha>:path`), so the output
 *    can never change and is kept until evicted;
 *  - stateful: the command reads HEAD or a notes ref (`show HEAD:path`, `ls-tree HEAD`, `notes list`),
 *    so the entry is keyed by a token built from stat() of the ref files. A commit, checkout or note
 *    write (by this or another process) changes a ref file's inode/mtime and so the token.
 * Any non-read git command run through `run()` also drops every stateful entry.
 */

const MAX_ENTRIES = 4000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

type Stored = { ok: true; value: string | Buffer } | { ok: false; error: unknown };
type Entry = { stored: Stored; size: number; token: string | null };

const entries = new Map<string, Entry>();
let totalBytes = 0;
const gitDirs = new Map<string, { gitDir: string; commonDir: string } | null>();

const HEX40 = /^[0-9a-f]{40}$/;
const SHA_REV = /^[0-9a-f]{40}(\^\{commit\}|:.*)?$/;
const READ_ONLY = new Set(["show", "ls-tree", "log", "merge-base", "cat-file", "rev-parse", "ls-files", "diff", "status", "remote", "config", "symbolic-ref", "show-ref", "for-each-ref", "check-ignore", "var"]);

export const cacheStats = { hits: 0, misses: 0 };

function isHeadArg(a: string): boolean { return a === "HEAD" || a.startsWith("HEAD:") || a.startsWith("HEAD^") || a.startsWith("HEAD~"); }

/** "immutable", "state", or null when the command must not be cached. */
function classify(args: string[], hasInput: boolean): "immutable" | "state" | null {
  const cmd = args[0];
  if (cmd === "notes") {
    // Only `notes [--ref=X] list|show`, which read the notes ref (covered by the state token).
    const rest = args.slice(1).filter((a) => !a.startsWith("--ref="));
    return rest[0] === "list" || rest[0] === "show" ? "state" : null;
  }
  if (cmd === "cat-file" && args[1] === "--batch") return "immutable";
  if (cmd !== "show" && cmd !== "ls-tree" && cmd !== "log" && cmd !== "merge-base" && cmd !== "cat-file") return null;
  if (hasInput) return null;
  const sep = args.indexOf("--");
  const head = sep === -1 ? args.slice(1) : args.slice(1, sep);
  const positional = head.filter((a) => !a.startsWith("-"));
  // `ls-tree rev dir/` and `log rev` keep the path after rev; for the others every positional is a rev.
  const revs = cmd === "ls-tree" ? positional.slice(0, 1) : positional;
  if (revs.length === 0) return null;
  let usesHead = false;
  for (const r of revs) {
    if (isHeadArg(r)) usesHead = true;
    else if (!SHA_REV.test(r)) return null;
  }
  if (cmd === "cat-file" && !(args[1] === "-e" && revs.length === 1)) return null;
  return usesHead ? "state" : "immutable";
}

function dirsFor(cwd: string): { gitDir: string; commonDir: string } | null {
  const hit = gitDirs.get(cwd);
  if (hit !== undefined) return hit;
  let info: { gitDir: string; commonDir: string } | null = null;
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd, encoding: "utf8", env: { ...process.env }, stdio: ["ignore", "pipe", "ignore"] }).split("\n");
    if (out[0] && out[1]) info = { gitDir: out[0], commonDir: out[1] };
  } catch { info = null; }
  gitDirs.set(cwd, info);
  return info;
}

function sig(file: string): string {
  try { const s = fs.statSync(file); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return "-"; }
}

function stateToken(cwd: string): string | null {
  const d = dirsFor(cwd);
  if (!d) return null;
  const parts: string[] = [];
  const headFile = path.join(d.gitDir, "HEAD");
  parts.push(sig(headFile));
  try {
    const m = /^ref:\s*(\S+)/.exec(fs.readFileSync(headFile, "utf8"));
    if (m?.[1]) { parts.push(sig(path.join(d.commonDir, m[1]))); parts.push(sig(path.join(d.gitDir, m[1]))); }
  } catch { /* unreadable HEAD: token still differs via sig */ }
  parts.push(sig(path.join(d.commonDir, "packed-refs")));
  const walk = (dir: string): void => {
    let names: fs.Dirent[];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const n of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, n.name);
      if (n.isDirectory()) walk(p); else parts.push(`${p}=${sig(p)}`);
    }
  };
  walk(path.join(d.commonDir, "refs", "notes"));
  return parts.join("|");
}

function store(key: string, e: Entry): void {
  if (e.size > MAX_ENTRY_BYTES) return;
  const old = entries.get(key);
  if (old) { totalBytes -= old.size; entries.delete(key); }
  entries.set(key, e);
  totalBytes += e.size;
  while (entries.size > MAX_ENTRIES || totalBytes > MAX_BYTES) {
    const first = entries.keys().next().value as string | undefined;
    if (first === undefined) break;
    totalBytes -= entries.get(first)!.size;
    entries.delete(first);
  }
}

function clone(v: string | Buffer): string | Buffer { return typeof v === "string" ? v : Buffer.from(v); }

/** Run `compute`, serving from / filling the cache when the git command is a cacheable read. */
export function cachedGit(
  args: string[],
  opts: { cwd: string; input?: string | Buffer; binary?: boolean },
  compute: () => string | Buffer,
): string | Buffer {
  if (process.env.SPECPLANE_NO_GIT_CACHE) return compute();
  const cmd = args[0] ?? "";
  if (!READ_ONLY.has(cmd) && !(cmd === "notes" && classify(args, false) !== null)) {
    // A write (commit, notes add, branch, ...): drop every stateful entry.
    for (const [k, e] of entries) if (e.token !== null) { totalBytes -= e.size; entries.delete(k); }
    return compute();
  }
  const input = opts.input === undefined ? undefined : typeof opts.input === "string" ? opts.input : opts.input.toString("latin1");
  const kind = classify(args, input !== undefined && !(cmd === "cat-file" && args[1] === "--batch"));
  if (kind === null) return compute();
  if (kind === "immutable" && cmd === "cat-file" && args[1] === "--batch") {
    const ids = (input ?? "").split("\n").filter(Boolean);
    if (ids.length === 0 || !ids.every((i) => HEX40.test(i))) return compute();
  }
  let token: string | null = null;
  if (kind === "state") {
    token = stateToken(opts.cwd);
    if (token === null) return compute();
  }
  const key = `${kind === "state" ? token : "i"}\0${opts.cwd}\0${opts.binary ? "b" : "s"}\0${args.join("\0")}\0${input ?? ""}`;
  const hit = entries.get(key);
  if (hit) {
    entries.delete(key); entries.set(key, hit); // LRU touch
    cacheStats.hits++;
    if (hit.stored.ok) return clone(hit.stored.value);
    throw hit.stored.error;
  }
  cacheStats.misses++;
  let stored: Stored;
  try {
    const value = compute();
    // An object that is missing now may appear later; never cache that answer.
    if (cmd === "cat-file" && args[1] === "--batch" && /\smissing\n/.test(value.toString("latin1"))) return value;
    stored = { ok: true, value: clone(value) };
  } catch (error) {
    if (kind === "immutable") throw error; // a missing object may be fetched later
    stored = { ok: false, error };
  }
  store(key, { stored, size: stored.ok ? Buffer.byteLength(stored.value as string) + key.length : key.length + 200, token });
  if (stored.ok) return stored.value;
  throw stored.error;
}

/** Drop everything (tests, or after something outside git changed the repo). */
export function clearGitCache(): void { entries.clear(); totalBytes = 0; gitDirs.clear(); }
