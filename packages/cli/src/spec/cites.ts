import { fencedLines, sectionAt, type SectionIndex } from "./sections.js";

/** Cite grammar, extraction and parsing (`architecture/file-formats` §3.1, §3.2). Resolution is in `project.ts`. */

export type Layer = "requirement" | "feature" | "architecture";

export type Cite =
  | { kind: "req"; raw: string; project: string | null; reqId: string }
  | { kind: "section"; raw: string; project: string | null; layer: Layer; slug: string; sectionId: string; layerGiven: boolean }
  | { kind: "spec"; raw: string; project: string | null; layer: Layer; slug: string; layerGiven: boolean }
  | { kind: "req-file"; raw: string; project: string | null; slug: string }
  | { kind: "file-req"; raw: string; project: string | null; file: string; reqId: string }
  | { kind: "plan"; raw: string; planId: string }
  | { kind: "file"; raw: string; path: string };

const REQ = /^R\d+(?:\.\d+)*$/;
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SECTION = new RegExp(`^(?:(feature|architecture)/)?(${SLUG}) (R\\d+(?:\\.\\d+)*|§\\d+(?:\\.\\d+)*)$`);
const SPEC = new RegExp(`^(?:(feature|architecture)/)?(${SLUG})$`);
const REQFILE = new RegExp(`^requirement/(${SLUG})$`);
const FILEREQ = /^([^\s#:]+)#(R\d+(?:\.\d+)*)$/;
const PLAN = /^plan\/(\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const PROJECT = /^([a-z0-9][a-z0-9-]*):(\S.*)$/;

export const normalizeCite = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Comparison key: in the root project, `root:<cite>` and `<cite>` name the same thing. */
export const citeKey = (s: string): string => normalizeCite(s).replace(/^root:/, "");

/** Parse a cite string; null when the text is not a cite. */
export function parseCite(input: string): Cite | null {
  const raw = normalizeCite(input);
  if (raw.startsWith("file:")) { const p = raw.slice(5); return p && !/[\s<>]/.test(p) ? { kind: "file", raw, path: p } : null; }
  const plan = PLAN.exec(raw);
  if (plan) return { kind: "plan", raw, planId: plan[1] };
  let project: string | null = null;
  let target = raw;
  const pm = PROJECT.exec(raw);
  if (pm && pm[1] !== "file") { project = pm[1]; target = pm[2].trim(); }
  if (REQ.test(target)) return { kind: "req", raw, project, reqId: target };
  let m = SECTION.exec(target);
  if (m) return { kind: "section", raw, project, layer: (m[1] as Layer | undefined) ?? "feature", slug: m[2], sectionId: m[3], layerGiven: !!m[1] };
  m = REQFILE.exec(target);
  if (m) return { kind: "req-file", raw, project, slug: m[1] };
  m = FILEREQ.exec(target);
  if (m) return { kind: "file-req", raw, project, file: m[1], reqId: m[2] };
  m = SPEC.exec(target);
  if (m) return { kind: "spec", raw, project, layer: (m[1] as Layer | undefined) ?? "feature", slug: m[2], layerGiven: !!m[1] };
  return null;
}

export interface FoundCite { cite: Cite; raw: string; line: number }

/** The id (`R11`, `§2`) a cite points at inside a spec, if it names one. */
function targetId(c: Cite): string | null {
  if (c.kind === "req") return c.reqId;
  if (c.kind === "section") return c.sectionId;
  return null;
}

/**
 * Cites in a spec body: inline code spans, outside fenced blocks, whose whole content is a cite. A bare
 * single-word span counts only when it names an existing spec (so words like `approved` are not cites).
 * A cite inside the section whose own heading defines it is not a dependency and is dropped.
 */
export function extractBodyCites(
  lines: string[],
  bodyStartLine: number,
  index: SectionIndex,
  self: { layer: Layer; slug: string },
  isKnownSpec: (layer: Layer, slug: string) => boolean,
): FoundCite[] {
  const fenced = fencedLines(lines);
  const out: FoundCite[] = [];
  const re = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
  for (let i = bodyStartLine; i < lines.length; i++) {
    if (fenced[i]) continue;
    for (const m of lines[i].matchAll(re)) {
      const content = m[2];
      if (content !== content.trim() && m[1].length === 1) continue;
      const cite = parseCite(content.trim());
      if (!cite) continue;
      if (cite.kind === "spec" && !isKnownSpec(cite.layer, cite.slug)) continue;
      if (cite.kind === "req-file" || cite.kind === "file-req") { /* kept: explicit grammar */ }
      const id = targetId(cite);
      if (id) {
        const sec = sectionAt(index, i + 1);
        const same = cite.kind === "req" ? cite.project === null : cite.kind === "section" && cite.project === null && cite.layer === self.layer && cite.slug === self.slug;
        if (sec?.id === id && same) continue;
      }
      out.push({ cite, raw: normalizeCite(content), line: i + 1 });
    }
  }
  return out;
}
