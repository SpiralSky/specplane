import { createHash } from "node:crypto";
import { splitFrontmatter } from "./frontmatter.js";

/** Content fingerprints (`architecture/file-formats` §4.2, §4.3, §5.2). */

const cmp = (a: string, b: string): number => {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

/** Compact JSON with mapping keys sorted by code point; fixed by the spec, not by a library. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort(cmp).map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
const lf = (s: string): string => s.replace(/\r\n?/g, "\n");

/** Keys that were record state in a spec file before the notes store (`architecture/file-formats` §2): ignored, never fingerprinted. */
export const LEGACY_RECORD_KEYS = ["status", "approval", "review-reason", "results", "implementation"] as const;

export const SPEC_EXCLUDED = ["status", "approval", "authors", "review-reason", "results", "implementation"] as const;

/** Metadata a spec fingerprint leaves out: a change to metadata alone is not an edit (`cli R17`, `specifications R11.3`). */
export const SPEC_FP_EXCLUDED = [...SPEC_EXCLUDED, "title", "covers", "implements", "references"] as const;

/** `spec-v3` fingerprint of a spec file, or null when its frontmatter cannot be read. */
export function specFingerprint(text: string): string | null {
  const fm = splitFrontmatter(text);
  if (!fm.data) return null;
  const frontmatter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm.data)) if (!(SPEC_FP_EXCLUDED as readonly string[]).includes(k)) frontmatter[k] = v;
  return `spec-v3:sha256:${sha(canonicalJson({ frontmatter, body: lf(fm.body) }))}`;
}

/** `sec-v1` fingerprint of a cited part: LF text with trailing blank lines removed. */
export function partFingerprint(text: string): string {
  const lines = lf(text).split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return `sec-v1:sha256:${sha(lines.join("\n"))}`;
}

/** A step file of a plan as the fingerprint sees it: path relative to the plan folder and full content. */
export interface PlanStepContent { path: string; content: string }

/**
 * `plan-v1` fingerprint of a plan: PLAN.md like `spec-v3` (but with title, covers, implements and references kept and
 * without the `commit` of each `implements` entry) plus every step file in path order (`architecture/file-formats` §5.2).
 */
export function planFingerprint(text: string, steps: PlanStepContent[] = []): string | null {
  const fm = splitFrontmatter(text);
  if (!fm.data) return null;
  const frontmatter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm.data)) if (!(SPEC_EXCLUDED as readonly string[]).includes(k)) frontmatter[k] = v;
  if (Array.isArray(frontmatter.implements)) {
    frontmatter.implements = frontmatter.implements.map((e) => {
      if (e && typeof e === "object" && !Array.isArray(e)) { const { commit: _c, ...rest } = e as Record<string, unknown>; return rest; }
      return e;
    });
  }
  const ordered = [...steps].sort((a, b) => cmp(a.path, b.path)).map((s) => ({ path: s.path, content: lf(s.content) }));
  return `plan-v1:sha256:${sha(canonicalJson({ frontmatter, body: lf(fm.body), steps: ordered }))}`;
}
