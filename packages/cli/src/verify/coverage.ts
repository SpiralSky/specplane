import { extractBodyCites, parseCite, type Cite } from "../spec/cites.js";
import { allSpecs, projectOf, qualifyId, type Project, type SpecDoc } from "../spec/project.js";
import { dependencyCites } from "../spec/status.js";

/**
 * Specification coverage (`architecture/reference-cli` §6.4, `verification R64`): which feature specs cover each
 * requirement and which architecture specs cover each feature spec, from the spec's listed and cited references.
 */

export interface CoverageItem {
  /** `R12` for a requirement, `feature/<slug>` for a feature spec; `<subproject>:` precedes the ID of a subproject item. */
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

/** The name of the project a cite points into, as seen from the citing spec's own project; null for plan and file cites. */
function targetProject(own: Project, c: Cite): string | null {
  if (c.kind === "plan" || c.kind === "file") return null;
  if (c.project !== null) return c.project;
  const bare = c.kind === "req" || c.kind === "file-req" || c.kind === "req-file";
  return bare && own.name !== "root" && own.requirements.files.length === 0 ? "root" : own.name;
}

/** A requirement cited as `R5` also covers `R5.1`: a cite includes the sub-requirements (`file-formats` §1.2). */
const isSelfOrAncestor = (cited: string, id: string): boolean => cited === id || id.startsWith(`${cited}.`);

/**
 * Coverage over the root project and every subproject. An item of a subproject is named with its subproject
 * (`<name>:R5`, `<name>:feature/<slug>`); a cite covers an item in the project it points into, so a subproject
 * feature spec can cover a root requirement and the reverse (`later-releases R39.2`).
 */
export function computeCoverage(root: Project, requirementOnly: readonly string[] = []): Coverage {
  const projects = [root, ...root.subprojects.values()];
  const docs = allSpecs(root);
  const features = docs.filter((d) => d.layer === "feature");
  const architectures = docs.filter((d) => d.layer === "architecture");
  const cites = new Map(docs.map((d) => [d.id, citesOf(projectOf(root, d), d).map((c) => ({ c, to: targetProject(projectOf(root, d), c) }))]));
  const only = new Set(requirementOnly);
  const skipped: string[] = [];
  const items: CoverageItem[] = [];
  const covers = new Map<string, string[]>();
  const note = (spec: string, item: string): void => { const l = covers.get(spec) ?? []; if (!l.includes(item)) l.push(item); covers.set(spec, l); };

  // Requirements are covered by feature specs; with no feature layer, by architecture specs; with neither, skipped.
  const reqCoverers = features.length ? features : architectures;
  const reqs: { project: Project; id: string; title: string }[] = [];
  for (const project of projects) {
    const seen = new Set<string>();
    for (const f of project.requirements.files) for (const r of f.requirements) if (!seen.has(r.id)) { seen.add(r.id); reqs.push({ project, id: r.id, title: r.title }); }
  }
  if (reqs.length && !reqCoverers.length) skipped.push("feature");
  else for (const { project, id, title } of reqs) {
    const coveredBy = reqCoverers.filter((d) => cites.get(d.id)!.some(({ c, to }) => (c.kind === "req" || c.kind === "file-req") && to === project.name && isSelfOrAncestor(c.reqId, id))).map((d) => d.id);
    const name = qualifyId(project.name, id);
    for (const sp of coveredBy) note(sp, name);
    items.push({ id: name, kind: "requirement", title, coveredBy, requirementOnly: only.has(name) });
  }

  // Feature specs are covered by architecture specs; with no architecture layer they are not assessed.
  if (features.length && !architectures.length) skipped.push("architecture");
  else for (const f of features) {
    const coveredBy = architectures.filter((a) => cites.get(a.id)!.some(({ c, to }) => (c.kind === "spec" || c.kind === "section") && to === f.project && c.layer === "feature" && c.slug === f.slug)).map((a) => a.id);
    for (const sp of coveredBy) note(sp, f.id);
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
