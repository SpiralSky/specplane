import { specFingerprint } from "./fingerprint.js";
import type { Project, SpecDoc } from "./project.js";

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A result is current when its fingerprints equal those computed now (`architecture/file-formats` §11.1). */
function isCurrent(r: Record<string, unknown>, doc: SpecDoc, head: Project): boolean {
  if (r.fingerprint !== specFingerprint(doc.text)) return false;
  if (r.against === undefined) return true;
  if (!isMap(r.against)) return false;
  return Object.entries(r.against).every(([id, fp]) => {
    const other = head.specs.get(id);
    return other !== undefined && specFingerprint(other.text) === fp;
  });
}

/** Tests whose latest current result is `failed`; these block approval (`verification R61.1`). */
export function failedTests(doc: SpecDoc, head: Project): string[] {
  const results = doc.fm.data?.results;
  if (!Array.isArray(results)) return [];
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of results) {
    if (isMap(r) && typeof r.test === "string" && isCurrent(r, doc, head)) latest.set(r.test, r);
  }
  return [...latest.entries()].filter(([, r]) => r.outcome === "failed").map(([t]) => t);
}
