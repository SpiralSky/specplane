import { parseCite, type Cite, type Layer } from "./cites.js";
import { partFingerprint, specFingerprint } from "./fingerprint.js";
import { splitFrontmatter, type FrontmatterResult } from "./frontmatter.js";
import { listedFiles, parseRequirementFile, type RequirementFile } from "./requirements.js";
import { indexSections, type SectionIndex } from "./sections.js";
import type { SpecPaths } from "./paths.js";
import type { Source } from "./source.js";

/** The project snapshot for one `Source` (`architecture/reference-cli` §4.5). */

export interface SpecDoc {
  /** Path-derived ID: `feature/<slug>` or `architecture/<slug>`. */
  id: string;
  layer: Layer;
  slug: string;
  /** Repository-relative path. */
  file: string;
  text: string;
  lines: string[];
  fm: FrontmatterResult;
  index: SectionIndex;
}

export interface RequirementSet {
  files: RequirementFile[];
  central: string | null;
  /** Problems finding the central file or reading listed files. */
  problems: { message: string; file: string }[];
  /** Files in the directory that the central file does not list. */
  unlisted: string[];
  retired: Set<string>;
}

export interface Project {
  source: Source;
  paths: SpecPaths;
  requirements: RequirementSet;
  specs: Map<string, SpecDoc>;
  /** Markdown files in a spec directory that are not specs (slug problems) or INFO.md with frontmatter. */
  strayFiles: { file: string; reason: string }[];
  planIds: Set<string>;
}

const SLUG_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export function makeSpecDoc(layer: Layer, slug: string, file: string, text: string): SpecDoc {
  const fm = splitFrontmatter(text);
  const lines = text.split("\n");
  return { id: `${layer}/${slug}`, layer, slug, file, text, lines, fm, index: indexSections(lines, fm.bodyStartLine) };
}

function loadRequirements(source: Source, paths: SpecPaths): RequirementSet {
  const dir = paths.requirements;
  const mdFiles = source.list(dir).filter((f) => f.endsWith(".md") && f !== "INFO.md");
  const problems: RequirementSet["problems"] = [];
  let central: string | null = null;
  let readAll = false;
  if (paths.requirementsIndex) {
    if (mdFiles.includes(paths.requirementsIndex)) central = paths.requirementsIndex;
    else { problems.push({ file: dir, message: `paths.requirements_index names ${paths.requirementsIndex}, which does not exist in ${dir}` }); readAll = true; }
  } else if (mdFiles.length === 1) central = mdFiles[0];
  else if (mdFiles.includes("index.md")) central = "index.md";
  else if (mdFiles.includes("README.md")) central = "README.md";
  else if (mdFiles.length > 1) { problems.push({ file: dir, message: `cannot tell which requirements file is central; candidates: ${mdFiles.join(", ")}; set paths.requirements_index` }); readAll = true; }
  else if (source.exists(dir) && mdFiles.length === 0) problems.push({ file: dir, message: "the requirements directory has no markdown files" });
  const files: RequirementFile[] = [];
  const read = (name: string) => {
    const text = source.read(`${dir}/${name}`);
    if (text !== null) files.push(parseRequirementFile(`${dir}/${name}`, text));
  };
  let unlisted: string[] = [];
  if (readAll) mdFiles.forEach(read);
  else if (central) {
    read(central);
    const text = source.read(`${dir}/${central}`) ?? "";
    const listed = listedFiles(text);
    for (const name of listed) {
      if (name === central) continue;
      if (!mdFiles.includes(name)) problems.push({ file: `${dir}/${central}`, message: `lists requirements file ${name}, which does not exist` });
      else read(name);
    }
    unlisted = mdFiles.filter((f) => f !== central && !listed.includes(f));
  }
  const retired = new Set<string>();
  const centralFile = central ? files.find((f) => f.file === `${dir}/${central}`) : files.find((f) => f.retired);
  centralFile?.retired?.ids.forEach((id) => retired.add(id));
  return { files, central: central ? `${dir}/${central}` : null, problems, unlisted, retired };
}

export function loadProject(source: Source, paths: SpecPaths): Project {
  const specs = new Map<string, SpecDoc>();
  const strayFiles: Project["strayFiles"] = [];
  for (const [layer, dir] of [["feature", paths.features], ["architecture", paths.architecture]] as const) {
    for (const name of source.list(dir)) {
      if (!name.endsWith(".md")) continue;
      const file = `${dir}/${name}`;
      const text = source.read(file);
      if (text === null) continue;
      if (name === "INFO.md") {
        if (splitFrontmatter(text).data !== null || text.startsWith("---")) strayFiles.push({ file, reason: "INFO.md has frontmatter; it is documentation, not a spec, and is probably a misnamed spec" });
        continue;
      }
      if (!SLUG_FILE.test(name)) { strayFiles.push({ file, reason: `file name is not a valid slug ([a-z0-9]+(-[a-z0-9]+)*.md)` }); continue; }
      const doc = makeSpecDoc(layer, name.slice(0, -3), file, text);
      specs.set(doc.id, doc);
    }
  }
  const planIds = new Set<string>();
  for (const base of [paths.plansDir, `${paths.plansDir}/archive`]) {
    for (const name of listDirs(source, base)) if (name !== "archive") planIds.add(name);
  }
  return { source, paths, requirements: loadRequirements(source, paths), specs, strayFiles, planIds };
}

/** Directory names inside `base`. */
function listDirs(source: Source, base: string): string[] {
  return source.listDirs(base);
}

/** What a cite points at. */
export interface Target {
  kind: "requirement" | "section" | "spec" | "requirement-file" | "plan" | "file";
  file: string;
  startLine?: number;
  endLine?: number;
  text: string;
  /** Path-derived ID of the spec the target is in, for spec and section targets. */
  specId?: string;
}

export type Resolution = { ok: true; target: Target } | { ok: false; code: "later-release" | "error"; reason: string };

const fail = (reason: string): Resolution => ({ ok: false, code: "error", reason });

/** Resolve a cite in a project (`architecture/file-formats` §3.4). `ownProject` is the project the citing spec is in. */
export function resolveCite(project: Project, cite: Cite): Resolution {
  if ("project" in cite && cite.project !== null && cite.project !== "root") {
    return { ok: false, code: "later-release", reason: `cite into subproject \`${cite.project}\` is resolved in a later release` };
  }
  switch (cite.kind) {
    case "file": {
      if (!project.source.exists(cite.path)) return fail(`file ${cite.path} does not exist`);
      return { ok: true, target: { kind: "file", file: cite.path, text: project.source.read(cite.path) ?? "" } };
    }
    case "plan": {
      if (!project.planIds.has(cite.planId)) return fail(`plan ${cite.planId} does not exist`);
      const dir = [project.paths.plansDir, `${project.paths.plansDir}/archive`].find((d) => project.source.exists(`${d}/${cite.planId}`))!;
      const file = `${dir}/${cite.planId}/PLAN.md`;
      return { ok: true, target: { kind: "plan", file, text: project.source.read(file) ?? "" } };
    }
    case "req":
    case "file-req": {
      const id = cite.reqId;
      const files = cite.kind === "file-req" ? project.requirements.files.filter((f) => f.file.endsWith(`/${cite.file}`)) : project.requirements.files;
      const hits = files.flatMap((f) => f.requirements.filter((r) => r.id === id));
      if (hits.length === 0) return fail(project.requirements.retired.has(id) ? `requirement ${id} is retired` : `requirement not found: ${id}`);
      if (hits.length > 1) return fail(`duplicate requirement ${id} (${hits.map((h) => `${h.file}:${h.startLine}`).join(", ")})`);
      const h = hits[0];
      return { ok: true, target: { kind: "requirement", file: h.file, startLine: h.startLine, endLine: h.endLine, text: h.text } };
    }
    case "req-file": {
      const file = `${project.paths.requirements}/${cite.slug}.md`;
      const text = project.source.read(file);
      return text === null ? fail(`requirements file ${cite.slug}.md not found`) : { ok: true, target: { kind: "requirement-file", file, text } };
    }
    case "spec":
    case "section": {
      const doc = project.specs.get(`${cite.layer}/${cite.slug}`);
      if (!doc) return fail(`spec not found: ${cite.layer}/${cite.slug}`);
      if (cite.kind === "spec") return { ok: true, target: { kind: "spec", file: doc.file, text: doc.text, specId: doc.id } };
      const sec = doc.index.byId.get(cite.sectionId);
      if (!sec) return fail(`section not found: ${cite.sectionId} in ${doc.id}`);
      return { ok: true, target: { kind: "section", file: doc.file, startLine: sec.startLine, endLine: sec.endLine, text: doc.lines.slice(sec.startLine - 1, sec.endLine).join("\n"), specId: doc.id } };
    }
  }
}

/** The part fingerprint of a resolved target (`architecture/file-formats` §4.3). */
export function targetFingerprint(t: Target): string {
  if (t.kind === "spec" || t.kind === "requirement-file") return specFingerprint(t.text) ?? partFingerprint(t.text);
  return partFingerprint(t.text);
}

/** Parse and resolve a cite given as written; null when the text is not a cite at all. */
export function resolveRaw(project: Project, raw: string): { cite: Cite; resolution: Resolution } | null {
  const cite = parseCite(raw);
  return cite ? { cite, resolution: resolveCite(project, cite) } : null;
}
