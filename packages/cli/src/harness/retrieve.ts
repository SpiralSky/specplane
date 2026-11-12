import * as fs from "node:fs";
import * as path from "node:path";
import { loadSettings } from "../config.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveRaw, findDoc } from "../spec/project.js";
import { worktreeSource } from "../spec/source.js";
import { computeStatus, dependencyCites } from "../spec/status.js";
import { headContext } from "../verify/implementation.js";
import { currentResults } from "../spec/results.js";
import { computeCoverage } from "../verify/coverage.js";
import { collectWarnings, narrowWarnings } from "../verify/warnings.js";

export interface RetrievedPart {
  cite: string; sources: string[]; found: boolean; text?: string; file?: string;
  status?: "approved" | "awaiting-review"; notes?: string[]; reason?: string;
}

/** Internal read primitive: the action registry guards it, including request acceptance. */
export function retrieveSpecs(root: string, ids: string[], includeReferences?: boolean): RetrievedPart[] {
  const source = worktreeSource(root);
  const safe = (file: string): boolean => {
    try {
      const relative = path.relative(fs.realpathSync(root), fs.realpathSync(path.resolve(root, file)));
      return !path.isAbsolute(file) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    } catch { return false; }
  };
  const working = loadProject({ ...source, read: (file) => safe(file) ? source.read(file) : null, exists: (file) => safe(file) && source.exists(file) }, loadSpecPaths(root).paths);
  const { project: head, ctx } = headContext(root);
  const include = includeReferences ?? loadSettings(root).config.values["harness.retrieval_include_references"] === true;
  const parts = new Map<string, RetrievedPart>();
  const add = (cite: string, source: string): void => {
    const resolved = resolveRaw(working, cite)?.resolution;
    if (!resolved?.ok) {
      parts.set(`missing:${cite}`, { cite, sources: [source], found: false, reason: `not found: ${resolved && !resolved.ok ? resolved.reason : "invalid cite"}` });
      return;
    }
    const t = resolved.target;
    const key = `${t.file}:${t.startLine ?? ""}:${t.endLine ?? ""}`;
    const existing = parts.get(key);
    if (existing) { if (!existing.sources.includes(source)) existing.sources.push(source); return; }
    const doc = t.specId ? findDoc(head, t.specId) : undefined;
    const current = t.specId ? findDoc(working, t.specId)?.text : undefined;
    const state = doc ? computeStatus(head, doc, ctx, current) : null;
    parts.set(key, { cite, sources: [source], found: true, text: t.text, file: t.file,
      ...(t.specId ? { status: state?.status ?? (t.kind === "requirement-file" || t.kind === "requirement" ? "approved" : "awaiting-review"),
        notes: state?.notes ?? ["Not present at HEAD; text is uncommitted."] } : {}) });
  };
  for (const id of ids) {
    add(id, id);
    if (include) for (const cite of dependencyCites(findDoc(working, id)?.fm.data ?? null)) add(cite, id);
  }
  return [...parts.values()];
}

export function reviewContext(root: string, ids: string[], includeReferences?: boolean) {
  const { project, ctx } = headContext(root);
  const coverage = computeCoverage(project, loadSettings(root).config.values["coverage.requirement_only"] as string[]);
  return { parts: retrieveSpecs(root, ids, includeReferences),
    coverage: { items: coverage.items.filter((x) => ids.includes(x.id) || x.coveredBy.some((id) => ids.includes(id))), covers: coverage.covers.filter((x) => ids.includes(x.spec)) },
    warnings: collectWarnings(root, { ids }).filter((w) => ids.some((id) => narrowWarnings([w], id).length)),
    results: ids.flatMap((id) => { const doc = findDoc(project, id); return doc ? [...currentResults(ctx, doc)].map(([test, result]) => ({ spec: id, test, result })) : []; }) };
}
