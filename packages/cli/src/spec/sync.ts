import { SpecplaneError } from "../errors.js";
import { GitError } from "../errors.js";
import { run } from "../git/exec.js";
import { NOTES_REF, notesTip, readNotes } from "./notes.js";

/** Notes sync: fetch refspec, fetch, merge, push (`architecture/file-formats` §13.4, `architecture/reference-cli` §5.6). */

export class SyncError extends SpecplaneError {
  readonly exitCode = 1;
  constructor(message: string) { super(message); }
}

const gitTry = (root: string, args: string[]): string | null => {
  try { return run("git", args, { cwd: root }); } catch (e) { if (e instanceof GitError) return null; throw e; }
};

export const remoteNotesRef = (remote: string): string => `refs/notes/remotes/${remote}/specplane`;
export const notesRefspec = (remote: string): string => `+${NOTES_REF}:${remoteNotesRef(remote)}`;

export function listRemotes(root: string): string[] {
  return (gitTry(root, ["remote"]) ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

const hasRefspec = (root: string, remote: string): boolean =>
  (gitTry(root, ["config", "--get-all", `remote.${remote}.fetch`]) ?? "").split("\n").includes(notesRefspec(remote));

/** Set the notes fetch refspec on every remote that lacks it (idempotent); returns one line per remote changed. */
export function ensureNotesRefspecs(root: string): string[] {
  const lines: string[] = [];
  for (const remote of listRemotes(root)) {
    if (hasRefspec(root, remote)) continue;
    run("git", ["config", "--add", `remote.${remote}.fetch`, notesRefspec(remote)], { cwd: root });
    lines.push(`Set the notes fetch refspec of remote ${remote}`);
  }
  return lines;
}

/** The remote a sync talks to: the one named, else the single remote, else `origin`. */
export function chooseRemote(root: string, named?: string): string {
  const remotes = listRemotes(root);
  if (named) {
    if (!remotes.includes(named)) throw new SyncError(`There is no remote named ${named}. Remotes: ${remotes.join(", ") || "(none)"}.`);
    return named;
  }
  if (remotes.length === 1) return remotes[0];
  if (remotes.includes("origin")) return "origin";
  throw new SyncError(remotes.length ? `Name a remote to sync with: ${remotes.join(", ")}.` : "This repository has no remote to sync with.");
}

/** Fetch, merge, push, in that order; a step that fails stops the command and names the step. */
export function syncNotes(root: string, named?: string): string[] {
  const remote = chooseRemote(root, named);
  const tracking = remoteNotesRef(remote);
  const step = (name: string, fn: () => void) => {
    try { fn(); } catch (e) { if (e instanceof GitError) throw new SyncError(`Sync stopped at ${name}: ${e.message}`); throw e; }
  };
  const lines: string[] = [];
  const remoteHas = (gitTry(root, ["ls-remote", remote, NOTES_REF]) ?? "").trim() !== "";
  if (remoteHas) {
    step("fetch", () => run("git", ["fetch", "-q", remote, notesRefspec(remote)], { cwd: root }));
    lines.push(`Fetched notes from ${remote}.`);
    step("merge", () => {
      if (!notesTip(root)) run("git", ["update-ref", NOTES_REF, tracking], { cwd: root });
      else run("git", ["notes", "--ref=specplane", "merge", "-s", "cat_sort_uniq", tracking], { cwd: root });
    });
    lines.push("Merged the remote notes into refs/notes/specplane.");
  } else lines.push(`${remote} has no notes yet; nothing to fetch or merge.`);
  if (notesTip(root)) {
    step("push", () => run("git", ["push", "-q", remote, NOTES_REF], { cwd: root }));
    lines.push(`Pushed refs/notes/specplane to ${remote}.`);
  } else lines.push("There are no local records to push.");
  return lines;
}

/** Validation warnings about notes sync state; local only, no network (`file-formats` §13.4). */
export function notesSyncWarnings(root: string): string[] {
  const out: string[] = [];
  const local = readNotes(root);
  const localRids = new Set([...local.bySpec.values()].flat().map((s) => s.rec.rid));
  for (const remote of listRemotes(root)) {
    if (!hasRefspec(root, remote)) out.push(`remote ${remote} has no notes fetch refspec; run \`specplane init\``);
    const tracking = remoteNotesRef(remote);
    if (gitTry(root, ["rev-parse", "--verify", "--quiet", tracking]) === null) {
      if (localRids.size) out.push(`local records exist but ${remote} has no notes copy here (${tracking}); run \`specplane sync\``);
      continue;
    }
    const missing = [...readNotes(root, tracking).bySpec.values()].flat().filter((s) => !localRids.has(s.rec.rid)).length;
    if (missing) out.push(`${missing} record(s) in ${tracking} are not merged into ${NOTES_REF}; run \`specplane sync\``);
  }
  return out;
}
