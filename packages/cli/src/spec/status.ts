import { parseCite } from "./cites.js";
import { specFingerprint } from "./fingerprint.js";
import { byAtRid, isApproving, NotesView, type Stored, type Subject } from "./notes.js";
import { resolveCite, targetFingerprint, type Project, type SpecDoc, findDoc, projectOf } from "./project.js";
import { committedSource } from "./source.js";

/** Effective status of a spec, computed from committed content and the notes store (`architecture/file-formats` §4.5). */

export interface EffectiveStatus {
  status: "approved" | "awaiting-review";
  reasons: string[];
  notes: string[];
  warnings: string[];
}

/** Dependency cites of a spec as written: `covers`, `implements`, `references`, deduplicated. */
export function dependencyCites(data: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  for (const key of ["covers", "implements", "references"]) {
    const v = data?.[key];
    if (Array.isArray(v)) for (const item of v) if (typeof item === "string" && !out.includes(item)) out.push(item);
  }
  return out;
}

/** What status is read against: the checkout, the committed project at one revision and one read of the notes ref. */
export class StatusCtx {
  readonly notes: NotesView;
  private decisions = new Map<string, Stored | null>();
  constructor(readonly root: string, readonly head: Project, readonly rev: string = "HEAD") { this.notes = new NotesView(root, rev); }

  /**
   * Kind of the newest approval, override or reopen record of a spec, whatever content it was for: step 5 reads only
   * this, so an edit elsewhere in the cited spec does not reach the citing spec (`specifications R11.2`; `file-formats`
   * §2.5 lists never approved, reopened and overridden, not edited).
   */
  newestOf(doc: SpecDoc): Stored | null {
    if (doc.layer === "requirement") return null;
    return this.notes.records(doc.id).filter((st) => ["approval", "reopen"].includes(st.rec.kind) || (st.rec.kind === "override" && st.rec.target === "status")).sort(byAtRid).at(-1) ?? null;
  }

  /** Decisive record of a spec in the project (null for a requirement file: it has none). */
  decisiveOf(doc: SpecDoc): Stored | null {
    if (doc.layer === "requirement") return null;
    if (!this.decisions.has(doc.id)) this.decisions.set(doc.id, this.notes.decisive(specSubject(this, doc)));
    return this.decisions.get(doc.id)!;
  }
}

export function specSubject(ctx: StatusCtx, doc: SpecDoc): Subject {
  return {
    id: doc.id,
    paths: [doc.file],
    fingerprint: specFingerprint(doc.text),
    fingerprintAt(rev) {
      const t = committedSource(ctx.root, rev).read(doc.file);
      return t === null ? null : specFingerprint(t);
    },
  };
}

/** Steps 2 to 4 for a subject: the decisive record and the reasons; `reasons` is empty when approved. */
export function recordState(ctx: StatusCtx, s: Subject, own: Project = ctx.head): { decisive: Stored | null; reasons: string[] } {
  const { applicable, other } = ctx.notes.lookup(s);
  const decisive = ctx.notes.decisive(s);
  if (!decisive) return { decisive, reasons: [applicable.length || other.length ? "edited" : "never-approved"] };
  if (!isApproving(decisive)) return { decisive, reasons: ["edited"] };
  const reasons: string[] = [];
  for (const [raw, expected] of Object.entries(decisive.rec.cited ?? {})) {
    const cite = parseCite(raw);
    if (!cite) continue;
    const res = resolveCite(own, cite);
    const now = res.ok ? targetFingerprint(res.target) : null;
    if (now === null || now !== expected) reasons.push(`outdated: ${raw}`);
  }
  return { decisive, reasons };
}

export function computeStatus(head: Project, doc: SpecDoc, ctx: StatusCtx, workingText?: string | null): EffectiveStatus {
  const notes: string[] = [];
  const warnings: string[] = [];
  if (workingText != null && workingText !== doc.text) notes.push("uncommitted changes are ignored");
  // Step 1: a requirement file is always approved.
  if (doc.layer === "requirement") return { status: "approved", reasons: [], notes, warnings };
  if (!doc.fm.data || specFingerprint(doc.text) === null) return { status: "awaiting-review", reasons: ["never-approved"], notes, warnings };
  const state = recordState(ctx, specSubject(ctx, doc), projectOf(head, doc));
  const reasons = [...state.reasons];
  // Step 5: dependencies on other specs that are not approved.
  {
    for (const raw of dependencyCites(doc.fm.data)) {
      const cite = parseCite(raw);
      if (!cite) continue;
      const res = resolveCite(projectOf(head, doc), cite);
      const id = res.ok ? res.target.specId : undefined;
      if (!id || id === doc.id) continue;
      const dep = findDoc(head, id);
      if (dep && dep.layer !== "requirement" && !isApproving(ctx.newestOf(dep))) reasons.push(`unapproved-dependency: ${raw}`);
    }
  }
  return { status: reasons.length ? "awaiting-review" : "approved", reasons, notes, warnings };
}
