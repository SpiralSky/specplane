import { extractBodyCites, parseCite, type Cite } from "../spec/cites.js";
import type { Project, SpecDoc } from "../spec/project.js";
import { dependencyCites } from "../spec/status.js";

/**
 * Specification coverage (`architecture/reference-cli` §6.4, `verification R64`): which feature specs cover each
 * requirement and which architecture specs cover each feature spec, from the spec's listed and cited references.
 */

export interface CoverageItem {
  /** `R12` for a requirement, `feature/<slug>` for a feature spec. */
  id: string;
  kind: "requirement" | "feature";
  title: string;
  /** Spec IDs that cover the item; several are all kept and none is an error. */
  coveredBy: string[];
  /** Listed in `coverage.requirement_only`: annotated, but still uncovered and still warned about. */
  requirementOnly: boolean;
}

export interface Coverage {
  /** Every item with its coverers. */
  items: CoverageItem[];
  /** The items nothing covers. */
  uncovered: CoverageItem[];
  /** For each spec, the items it covers. */
  covers: { spec: string; items: string[] }[];
  /** Layers that do not exist, so their items were not assessed. */
  skipped: string[];
}

/** Every cite of a spec: the listed references, covers and implements, and the cites in the body. */
function citesOf(project: Project, doc: SpecDoc): Cite[] {
  const out: Cite[] = [];
  for (const raw of dependencyCites(doc.fm.data)) { const c = parseCite(raw); if (c) out.push(c); }
  if (doc.fm.data) {
    const isKnown = (layer: string, slug: string) => project.specs.has(`${layer}/${slug}`);
    for (const b of extractBodyCites(doc.lines, doc.fm.bodyStartLine, doc.index, { layer: doc.layer, slug: doc.slug }, isKnown)) out.push(b.cite);
  }
  return out;
}

const inRoot = (c: Cite): boolean => !("project" in c) || c.project === null || c.project === "root";

/** A requirement cited as `R5` also covers `R5.1`: a cite includes the sub-requirements (`file-formats` §1.2). */
const isSelfOrAncestor = (cited: string, id: string): boolean => cited === id || id.startsWith(`${cited}.`);

export function computeCoverage(project: Project, requirementOnly: readonly string[] = []): Coverage {
  const docs = [...project.specs.values()];
  const features = docs.filter((d) => d.layer === "feature");
  const architectures = docs.filter((d) => d.layer === "architecture");
  const cites = new Map(docs.map((d) => [d.id, citesOf(project, d)]));
  const only = new Set(requirementOnly);
  const skipped: string[] = [];
  const items: CoverageItem[] = [];
  const covers = new Map<string, string[]>();
  const note = (spec: string, item: string): void => { const l = covers.get(spec) ?? []; if (!l.includes(item)) l.push(item); covers.set(spec, l); };

  // Requirements are covered by feature specs; with no feature layer, by architecture specs; with neither, skipped.
  const reqCoverers = features.length ? features : architectures;
  const reqs = new Map<string, string>();
  for (const f of project.requirements.files) for (const r of f.requirements) if (!reqs.has(r.id)) reqs.set(r.id, r.title);
  if (reqs.size && !reqCoverers.length) skipped.push("feature");
  else for (const [id, title] of reqs) {
    const coveredBy = reqCoverers.filter((d) => cites.get(d.id)!.some((c) => (c.kind === "req" || c.kind === "file-req") && inRoot(c) && isSelfOrAncestor(c.reqId, id))).map((d) => d.id);
    for (const s of coveredBy) note(s, id);
    items.push({ id, kind: "requirement", title, coveredBy, requirementOnly: only.has(id) });
  }

  // Feature specs are covered by architecture specs; with no architecture layer they are not assessed.
  if (features.length && !architectures.length) skipped.push("architecture");
  else for (const f of features) {
    const coveredBy = architectures.filter((a) => cites.get(a.id)!.some((c) => (c.kind === "spec" || c.kind === "section") && inRoot(c) && c.layer === "feature" && c.slug === f.slug)).map((a) => a.id);
    for (const s of coveredBy) note(s, f.id);
    items.push({ id: f.id, kind: "feature", title: typeof f.fm.data?.title === "string" ? f.fm.data.title : f.slug, coveredBy, requirementOnly: false });
  }

  return {
    items,
    uncovered: items.filter((i) => i.coveredBy.length === 0),
    covers: [...covers].map(([spec, list]) => ({ spec, items: list })).sort((a, b) => (a.spec < b.spec ? -1 : 1)),
    skipped: [...new Set(skipped)],
  };
}

/** One text line per item: `R12  Title  <- feature/a, feature/b`. */
export function formatCoverage(c: Coverage, uncoveredOnly: boolean): string[] {
  const rows = uncoveredOnly ? c.uncovered : c.items;
  const lines = rows.map((i) => `${i.id}  ${i.title}  ${i.coveredBy.length ? `covered by ${i.coveredBy.join(", ")}` : "uncovered"}${i.requirementOnly ? " (requirement-only by configuration)" : ""}`);
  if (!rows.length) lines.push(uncoveredOnly ? "Nothing is uncovered." : "No items to cover.");
  if (c.skipped.length) lines.push(`Not assessed: no ${c.skipped.join(" or ")} specs exist.`);
  return lines;
}
