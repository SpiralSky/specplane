import { readRecords } from "../decisions/decisions.js";
import { loadPlans } from "../plan/model.js";
import { plansDir } from "../plan/ctx.js";
import { allSpecs, loadProject } from "./project.js";
import { loadSpecPaths } from "./paths.js";
import { committedSource, headCommit } from "./source.js";

/**
 * Mechanical matching of a typed name against the specification, plan and decision indexes (`harness R70`). No model
 * is involved: words are compared case-insensitively against each ID and title.
 */

export interface Candidate { kind: "specification" | "plan" | "decision"; id: string; title: string }

export const MAX_MATCHES = 10;

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);

/** Every approvable ID with its title, read from the committed state (decisions from the working tree). */
export function candidates(root: string, rev = "HEAD"): Candidate[] {
  const out: Candidate[] = [];
  if (headCommit(root)) {
    const src = committedSource(root, rev);
    const project = loadProject(src, loadSpecPaths(root).paths);
    for (const d of allSpecs(project)) out.push({ kind: "specification", id: d.id, title: String((d.fm.data as { title?: unknown } | null)?.title ?? "") });
    try {
      for (const p of loadPlans(src, plansDir(root))) out.push({ kind: "plan", id: p.id, title: String((p.fm?.data as { title?: unknown } | null)?.title ?? "") });
    } catch { /* no plans folder */ }
  }
  try {
    for (const r of readRecords(root).records) out.push({ kind: "decision", id: r.id, title: r.title });
  } catch { /* decisions are off */ }
  return out;
}

/** Whether `name` is exactly the ID of a candidate. */
export const isExactId = (all: Candidate[], name: string): boolean => all.some((c) => c.id === name || c.id === `root:${name}`);

/**
 * The best matches for `name`, at most `MAX_MATCHES`: a candidate needs every word of the name in its ID or title
 * (a word counts when it is a prefix of, or contained in, one of theirs); more word hits on the ID rank first.
 */
export function bestMatches(all: Candidate[], name: string): Candidate[] {
  const want = words(name);
  if (!want.length) return [];
  const scored: { c: Candidate; score: number }[] = [];
  for (const c of all) {
    const idText = c.id.toLowerCase(), idWords = words(c.id), titleWords = words(c.title);
    let score = 0, ok = true;
    for (const w of want) {
      const inId = idText.includes(w), inTitle = titleWords.some((t) => t.includes(w));
      if (!inId && !inTitle) { ok = false; break; }
      score += (idWords.some((i) => i === w) ? 3 : 0) + (inId ? 2 : 0) + (inTitle ? 1 : 0);
    }
    if (ok) scored.push({ c, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id)).slice(0, MAX_MATCHES).map((s) => s.c);
}

/** The lines for a typed name that is not an exact ID, grouped by kind. */
export function matchListing(name: string, matches: Candidate[]): string[] {
  if (!matches.length) return [`\`${name}\` matches no specification, plan or decision. Nothing was approved.`];
  const lines = [`\`${name}\` is not an exact ID. Nothing was approved; run approve again with one of these IDs:`];
  for (const [kind, label] of [["specification", "Specifications"], ["plan", "Plans"], ["decision", "Decisions"]] as const) {
    const of = matches.filter((m) => m.kind === kind);
    if (!of.length) continue;
    lines.push(`${label}:`);
    for (const m of of) lines.push(`  ${m.id}${m.title ? ` — ${m.title}` : ""}`);
  }
  return lines;
}
