import { randomBytes } from "node:crypto";
import { GitError } from "../errors.js";
import { run } from "../git/exec.js";

/**
 * Notes store (`architecture/file-formats` §13, `architecture/reference-cli` §5.5): records are JSON Lines in git
 * notes on `refs/notes/specplane`. Read the whole ref, look records up by content, append by a notes commit.
 */

export const NOTES_NAME = "specplane";
export const NOTES_REF = `refs/notes/${NOTES_NAME}`;

export type RecordKind = "approval" | "reopen" | "override" | "test-result" | "implementation";

export interface NoteRecord {
  rid: string;
  at: string;
  spec: string;
  kind: RecordKind | string;
  fingerprint: string;
  by?: Record<string, unknown>;
  date?: string;
  cited?: Record<string, string>;
  note?: string;
  target?: string;
  value?: unknown;
  [key: string]: unknown;
}

/** A record with the commit its note is attached to. */
export interface Stored { commit: string; rec: NoteRecord }

const FP = /^(spec-v3|plan-v1):sha256:[0-9a-f]{64}$/;
const gitTry = (root: string, args: string[], input?: string): string | null => {
  try { return run("git", args, { cwd: root, ...(input === undefined ? {} : { input }) }); } catch (e) { if (e instanceof GitError) return null; throw e; }
};

export interface NotesIndex {
  bySpec: Map<string, Stored[]>;
  /** Lines that were skipped, reported as validation warnings (never silently dropped). */
  warnings: string[];
}

/** Parse one note (`commit` is where it is attached) into records and warnings. */
function parseNote(commit: string, text: string, index: NotesIndex): void {
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const where = `note on ${commit.slice(0, 7)} line ${i + 1}`;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { index.warnings.push(`${where}: not valid JSON; skipped`); return; }
    const r = rec as Partial<NoteRecord>;
    if (!r || typeof r !== "object" || ["rid", "at", "spec", "kind", "fingerprint"].some((k) => typeof (r as Record<string, unknown>)[k] !== "string")) {
      index.warnings.push(`${where}: record lacks rid, at, spec, kind or fingerprint; skipped`);
      return;
    }
    if (!FP.test(r.fingerprint!)) { index.warnings.push(`${where}: unknown fingerprint version ${r.fingerprint}; skipped`); return; }
    const list = index.bySpec.get(r.spec!) ?? [];
    list.push({ commit, rec: r as NoteRecord });
    index.bySpec.set(r.spec!, list);
  });
}

/** Every record of a notes ref, including notes on commits that are no longer reachable. */
export function readNotes(root: string, ref: string = NOTES_REF): NotesIndex {
  const index: NotesIndex = { bySpec: new Map(), warnings: [] };
  const listing = gitTry(root, ["notes", `--ref=${ref}`, "list"]);
  if (!listing) return index;
  const pairs = listing.split("\n").filter(Boolean).map((l) => l.split(" "));
  if (!pairs.length) return index;
  // Notes are UTF-8, so the text round-trips to the exact bytes the batch sizes count.
  const out = Buffer.from(run("git", ["cat-file", "--batch"], { cwd: root, input: pairs.map((p) => p[0]).join("\n") + "\n" }), "utf8");
  let pos = 0;
  for (const [, commit] of pairs) {
    const nl = out.indexOf(10, pos);
    const [, , size] = out.subarray(pos, nl).toString().split(" ");
    const n = Number(size);
    parseNote(commit, out.subarray(nl + 1, nl + 1 + n).toString("utf8"), index);
    pos = nl + 1 + n + 1;
  }
  return index;
}

/** Newest first-class decision order: by `at`, then `rid` (`file-formats` §13.2). */
export const byAtRid = (a: Stored, b: Stored): number => (a.rec.at < b.rec.at ? -1 : a.rec.at > b.rec.at ? 1 : a.rec.rid < b.rec.rid ? -1 : a.rec.rid > b.rec.rid ? 1 : 0);

export function newRid(): string { return randomBytes(16).toString("hex"); }

/** Build a record with a fresh `rid` and `at`. Key order: rid, at, spec, kind, by, date, fingerprint, then the rest. */
export function makeRecord(kind: RecordKind, spec: string, fingerprint: string, fields: Record<string, unknown>, now: Date = new Date()): NoteRecord {
  const { by, date, ...rest } = fields;
  return { rid: newRid(), at: now.toISOString(), spec, kind, ...(by !== undefined ? { by: by as Record<string, unknown> } : {}), ...(date !== undefined ? { date: date as string } : {}), fingerprint, ...rest };
}

/**
 * Append records to the note on `commit` and commit the note on the notes ref only. A write that loses the ref to
 * another writer reads again and appends again (`file-formats` §13.3).
 */
export function appendRecords(root: string, commit: string, records: NoteRecord[], ref: string = NOTES_REF): void {
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const existing = gitTry(root, ["notes", `--ref=${ref}`, "show", commit]) ?? "";
    const text = (existing && !existing.endsWith("\n") ? existing + "\n" : existing) + lines;
    try { run("git", ["notes", `--ref=${ref}`, "add", "-f", "-F", "-", commit], { cwd: root, input: text }); return; } catch (e) { last = e; }
  }
  throw last;
}

/** Commit at the tip of the notes ref, or null when the ref does not exist. */
export function notesTip(root: string, ref: string = NOTES_REF): string | null {
  return gitTry(root, ["rev-parse", "--verify", "--quiet", ref])?.trim() || null;
}

const DECIDING = new Set(["approval", "reopen", "override"]);

/** The subject of a lookup: a spec or a plan, how to find its history, and its fingerprint now. */
export interface Subject {
  id: string;
  /** Pathspecs whose changes count as changes of the subject. */
  paths: string[];
  /** Fingerprint of the committed content at the revision being read; null when it cannot be computed. */
  fingerprint: string | null;
  /** Fingerprint of the subject as committed at another revision; null when absent. */
  fingerprintAt(rev: string): string | null;
}

export interface Lookup {
  /** Records that apply (`file-formats` §13.2), oldest first. */
  applicable: Stored[];
  /** Approval, reopen and override records of the subject that do not apply. */
  other: Stored[];
}

/** Lookup by content over one read of the notes ref, at a revision of the current branch (default HEAD). */
export class NotesView {
  private index: NotesIndex | null = null;
  private tip: string | null | undefined;
  private reach = new Map<string, boolean>();
  private unchanged = new Map<string, boolean>();
  constructor(private root: string, private rev: string = "HEAD", private ref: string = NOTES_REF) {}

  get notes(): NotesIndex { return (this.index ??= readNotes(this.root, this.ref)); }
  records(spec: string): Stored[] { return this.notes.bySpec.get(spec) ?? []; }

  private revSha(): string | null {
    if (this.tip === undefined) this.tip = gitTry(this.root, ["rev-parse", "--verify", "--quiet", `${this.rev}^{commit}`])?.trim() || null;
    return this.tip;
  }

  private reachable(commit: string): boolean {
    let v = this.reach.get(commit);
    if (v === undefined) { v = gitTry(this.root, ["merge-base", "--is-ancestor", commit, this.rev]) !== null; this.reach.set(commit, v); }
    return v;
  }

  /** Rule 2 of `file-formats` §13.2: no commit after the attached one changed the subject's fingerprint. */
  private holds(s: Subject, st: Stored): boolean {
    if (!this.reachable(st.commit) || st.commit === this.revSha()) return true;
    const key = `${s.id}\0${st.commit}\0${st.rec.fingerprint}`;
    let v = this.unchanged.get(key);
    if (v === undefined) {
      const hashes = (gitTry(this.root, ["log", "--format=%H", `${st.commit}..${this.rev}`, "--", ...s.paths]) ?? "").split("\n").filter(Boolean);
      v = hashes.every((h) => s.fingerprintAt(h) === st.rec.fingerprint);
      this.unchanged.set(key, v);
    }
    return v;
  }

  lookup(s: Subject): Lookup {
    const applicable: Stored[] = [], other: Stored[] = [];
    for (const st of this.records(s.id)) {
      if (!DECIDING.has(st.rec.kind)) continue;
      if (s.fingerprint !== null && st.rec.fingerprint === s.fingerprint && this.holds(s, st)) applicable.push(st); else other.push(st);
    }
    return { applicable: applicable.sort(byAtRid), other };
  }

  /** Newest approval, override or reopen that applies (`target: status` for an override). */
  decisive(s: Subject): Stored | null {
    const { applicable } = this.lookup(s);
    const deciding = applicable.filter((st) => st.rec.kind !== "override" || st.rec.target === "status");
    return deciding.at(-1) ?? null;
  }
}

/** True when a decisive record means approved: an approval, or an override of status to approved. */
export function isApproving(st: Stored | null): boolean {
  return !!st && (st.rec.kind === "approval" || (st.rec.kind === "override" && st.rec.target === "status" && st.rec.value === "approved"));
}

/** Commit of the newest approval record of a spec whose commit exists here: the last version a person approved. */
export function lastApprovalCommit(root: string, spec: string): string | null {
  const recs = (readNotes(root).bySpec.get(spec) ?? []).filter((r) => isApproving(r)).sort(byAtRid);
  for (const r of recs.reverse()) if (gitTry(root, ["cat-file", "-e", `${r.commit}^{commit}`]) !== null) return r.commit;
  return null;
}
