import { ForgeError, GitError } from "../errors.js";
import type { Config } from "../types.js";
import { run } from "./exec.js";

/** Where a forge call runs: the checkout and the configured `plans.forge` mode. */
export interface ForgeOpts {
  cwd: string;
  forge: Config["plans"]["forge"];
}

/**
 * Resolves the usable forge for `opts`: true (use `gh`), or false (calls return null).
 * `github` throws ForgeError when GitHub or `gh` is unavailable.
 */
function available(opts: ForgeOpts): boolean {
  if (opts.forge === "none") return false;
  const strict = opts.forge === "github";
  let url = "";
  try {
    url = run("git", ["config", "--get", "remote.origin.url"], { cwd: opts.cwd }).trim();
  } catch {
    // no origin remote
  }
  if (!/github\.com[:/]/i.test(url)) {
    if (strict) throw new ForgeError("the `origin` remote does not point to GitHub.");
    return false;
  }
  try {
    run("gh", ["--version"], { cwd: opts.cwd });
  } catch {
    if (strict) throw new ForgeError("the `gh` CLI is not installed or not on PATH.");
    return false;
  }
  return true;
}

function gh(args: string[], cwd: string): string {
  try {
    return run("gh", args, { cwd });
  } catch (e) {
    throw new ForgeError(e instanceof GitError ? e.message.replace(/^Git command failed: /, "") : String(e));
  }
}

/** `gh pr create`; returns the PR URL, or null when no forge is available. */
export function createPR(branch: string, base: string, title: string, body: string, opts: ForgeOpts): string | null {
  if (!available(opts)) return null;
  const out = gh(["pr", "create", "--head", branch, "--base", base, "--title", title, "--body", body], opts.cwd);
  const url = out.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  if (!url) throw new ForgeError("`gh pr create` printed no URL.");
  return url;
}

/** `gh pr list --head <branch> --state open --json url`; returns the first URL, or null. */
export function getOpenPR(branch: string, opts: ForgeOpts): string | null {
  if (!available(opts)) return null;
  const out = gh(["pr", "list", "--head", branch, "--state", "open", "--json", "url"], opts.cwd);
  let list: unknown;
  try {
    list = JSON.parse(out || "[]");
  } catch {
    throw new ForgeError("`gh pr list` returned invalid JSON.");
  }
  const first = Array.isArray(list) ? (list[0] as { url?: unknown } | undefined) : undefined;
  return typeof first?.url === "string" ? first.url : null;
}

/** Read-only status query: true when an open PR exists; any forge failure counts as "no PR". */
export function hasOpenPR(branch: string, opts: ForgeOpts): boolean {
  try {
    return getOpenPR(branch, opts) !== null;
  } catch {
    return false;
  }
}
