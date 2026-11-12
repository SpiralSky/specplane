import { findDoc } from "./project.js";
import { specFingerprint } from "./fingerprint.js";
import { byAtRid, KIND_TEST_RESULT, type NoteRecord } from "./notes.js";
import { specSubject, type StatusCtx } from "./status.js";
import type { SpecDoc } from "./project.js";

/**
 * Test results are `test-result` records in the notes store (`architecture/file-formats` §11.1, §13). A result is
 * current when the tested spec's fingerprint and each `against` fingerprint equal those computed now.
 */

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function againstHolds(rec: NoteRecord, ctx: StatusCtx): boolean {
  const against = rec.against;
  if (against === undefined) return true;
  if (!isMap(against)) return false;
  return Object.entries(against).every(([id, fp]) => {
    const other = findDoc(ctx.head, id);
    return other !== undefined && specFingerprint(other.text) === fp;
  });
}

/** Latest current record per test ID, including `cleared` marks (an override clear), oldest to newest. */
export function currentResults(ctx: StatusCtx, doc: SpecDoc): Map<string, NoteRecord> {
  const latest = new Map<string, NoteRecord>();
  for (const st of ctx.notes.lookup(specSubject(ctx, doc), KIND_TEST_RESULT).applicable.sort(byAtRid)) {
    const test = st.rec.test;
    if (typeof test === "string" && againstHolds(st.rec, ctx)) latest.set(test, st.rec);
  }
  return latest;
}

/** Tests whose latest current result is `failed`; these block approval (`verification R61.1`). */
export function failedTests(ctx: StatusCtx, doc: SpecDoc): string[] {
  return [...currentResults(ctx, doc).entries()].filter(([, r]) => r.outcome === "failed").map(([t]) => t);
}
