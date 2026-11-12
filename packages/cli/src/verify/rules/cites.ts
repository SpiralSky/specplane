import { citeKey, extractBodyCites, parseCite, type Layer } from "../../spec/cites.js";
import { resolveCite, type Project, type SpecDoc } from "../../spec/project.js";
import { dependencyCites } from "../../spec/status.js";
import { collector, type Emit, type Rule } from "./types.js";

/** Cite rules for one spec (`architecture/reference-cli` §4.3). */
export function checkSpecCites(project: Project, doc: SpecDoc, emit: Emit): void {
  if (!doc.fm.data) return;
  const f = doc.file;
  const inSub = project.name !== "root";
  const isKnown = (layer: Layer, slug: string) => project.specs.has(`${layer}/${slug}`);
  const body = extractBodyCites(doc.lines, doc.fm.bodyStartLine, doc.index, { layer: doc.layer, slug: doc.slug }, isKnown);
  const listed = new Set(dependencyCites(doc.fm.data).map((c) => citeKey(c, inSub)));
  const used = new Set<string>();
  const resolveAndReport = (raw: string, line: number | undefined, where: string) => {
    const cite = parseCite(raw);
    if (!cite) return;
    const r = resolveCite(project, cite);
    if (r.ok) return;
    emit("error", "cites", `unresolved cite \`${raw}\` in ${where}: ${r.reason}`, f, line);
  };
  const seen = new Set<string>();
  for (const b of body) {
    if (doc.layer === "requirement") {
      // Retired declarations and references within this requirements file are not dependencies on another spec.
      if (/^Retired IDs:/.test(doc.lines[b.line - 1])) continue;
      const resolved = resolveCite(project, b.cite);
      if (resolved.ok && resolved.target.file === doc.file) continue;
    }
    const key = citeKey(b.raw, inSub);
    used.add(key);
    if (!listed.has(key) && !seen.has(key)) {
      seen.add(key);
      if (b.cite.kind === "spec") emit("warning", "cites", `whole-spec cite \`${b.raw}\` in the body is not listed in references; cite a section or list it`, f, b.line);
      else emit("error", "cites", `cite \`${b.raw}\` is used in the body but missing from references, covers and implements`, f, b.line);
    }
    const bodyKey = `${key}@body`;
    if (!seen.has(bodyKey)) { seen.add(bodyKey); resolveAndReport(b.raw, b.line, "the body"); }
  }
  const ownKeys = new Set(["covers", "implements"].flatMap((k) => (Array.isArray(doc.fm.data![k]) ? (doc.fm.data![k] as unknown[]) : []).filter((x): x is string => typeof x === "string").map((c) => citeKey(c, inSub))));
  for (const raw of listed) {
    resolveAndReport(raw, 1, "the frontmatter");
    if (!used.has(raw) && !ownKeys.has(raw)) emit("warning", "cites", `references lists \`${raw}\`, which the body never cites`, f, 1);
  }
}


export const rules: Rule[] = [{
  id: "cites",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    for (const doc of ctx.wt.specs.values()) {
      if (ctx.wanted && !ctx.wanted.has(doc.id)) continue;
      checkSpecCites(ctx.wt, doc, emit);
    }
    return items;
  },
}];
