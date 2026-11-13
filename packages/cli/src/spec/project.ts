import { parseCite, type Cite, type Layer } from "./cites.js";
import { partFingerprint, specFingerprint } from "./fingerprint.js";
import { splitFrontmatter, type FrontmatterResult } from "./frontmatter.js";
import { listedFiles, parseRequirementFile, type RequirementFile } from "./requirements.js";
import { indexSections, type SectionIndex } from "./sections.js";
import type { SpecPaths } from "./paths.js";
import type { Source } from "./source.js";

/** The project snapshot for one `Source` (`architecture/reference-cli` §4.5). */

export interface SpecDoc {
  /**
   * Path-derived ID: `requirement/<stem>`, `feature/<slug>` or `architecture/<slug>`; in a subproject it is
   * prefixed with the subproject name, `<name>:feature/<slug>` (`architecture/file-formats` §12.4).
   */
  id: string;
  /** `root` or the name of the subproject the spec is in. */
  project: string;
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
  /** `root` for the root project, else the subproject's name (`later-releases R39`). */
  name: string;
  /** The root project; the project itself for the root. */
  root: Project;
  /** The subprojects by name; empty inside a subproject. */
  subprojects: Map<string, Project>;
  /** Problems with a declared subproject, such as a missing folder (root project only). */
  subprojectProblems: { name: string; dir: string; message: string }[];
  source: Source;
  paths: SpecPaths;
  requirements: RequirementSet;
  specs: Map<string, SpecDoc>;
  /** Markdown files in a spec directory that are not specs (slug problems) or INFO.md with frontmatter. */
  strayFiles: { file: string; reason: string }[];
  planIds: Set<string>;
}

const SLUG_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** The ID of a spec in a project: the local `<layer>/<slug>`, prefixed with the subproject name outside the root. */
export const qualifyId = (project: string, local: string): string => (project === "root" ? local : `${project}:${local}`);

export function makeSpecDoc(layer: Layer, slug: string, file: string, text: string, project = "root"): SpecDoc {
  const fm = splitFrontmatter(text);
  const lines = text.split("\n");
  return { id: qualifyId(project, `${layer}/${slug}`), project, layer, slug, file, text, lines, fm, index: indexSections(lines, fm.bodyStartLine) };
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

/** The layout of a subproject folder: `requirements/`, `features/` and `architecture/` (`architecture/file-formats` §12.4). */
function subprojectPaths(dir: string, root: SpecPaths): SpecPaths {
  return { requirements: `${dir}/requirements`, requirementsIndex: null, features: `${dir}/features`, architecture: `${dir}/architecture`, plansDir: root.plansDir, subprojects: [] };
}

export function loadProject(source: Source, paths: SpecPaths): Project {
  const project = loadOne(source, paths, "root");
  project.root = project;
  for (const sub of paths.subprojects) {
    if (!source.exists(sub.dir)) {
      project.subprojectProblems.push({ name: sub.name, dir: sub.dir, message: `subproject \`${sub.name}\` has no folder ${sub.dir}` });
      continue;
    }
    const child = loadOne(source, subprojectPaths(sub.dir, paths), sub.name);
    child.root = project;
    project.subprojects.set(sub.name, child);
  }
  return project;
}

/** Every spec of the root project and of its subprojects, root first, by qualified ID. */
export function allSpecs(root: Project): SpecDoc[] {
  return [...root.specs.values(), ...[...root.subprojects.values()].flatMap((p) => [...p.specs.values()])];
}

/** The project a qualified spec ID belongs to, and the ID inside it: `<name>:<layer>/<slug>` or a root ID. */
export function splitSpecId(root: Project, id: string): { project: Project; local: string } | null {
  const m = /^([a-z0-9][a-z0-9-]*):(.+)$/.exec(id);
  if (!m) return { project: root, local: id };
  const project = m[1] === "root" ? root : root.subprojects.get(m[1]);
  return project ? { project, local: m[2] } : null;
}

/** Look a spec up by qualified ID; `root:<id>` names a root spec like the plain ID does. */
export function findDoc(root: Project, id: string): SpecDoc | undefined {
  const at = splitSpecId(root, id);
  return at?.project.specs.get(at.local);
}

/** The project that owns a spec. */
export function projectOf(root: Project, doc: SpecDoc): Project {
  return doc.project === "root" ? root : root.subprojects.get(doc.project) ?? root;
}

function loadOne(source: Source, paths: SpecPaths, projectName: string): Project {
  const name = projectName;
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
      const doc = makeSpecDoc(layer, name.slice(0, -3), file, text, projectName);
      specs.set(`${layer}/${doc.slug}`, doc);
    }
  }
  const planIds = new Set<string>();
  for (const base of [paths.plansDir, `${paths.plansDir}/archive`]) {
    for (const name of listDirs(source, base)) if (name !== "archive") planIds.add(name);
  }
  const requirements = loadRequirements(source, paths);
  for (const req of requirements.files) {
    const stem = req.file.slice(req.file.lastIndexOf("/") + 1, -3);
    const doc = makeSpecDoc("requirement", stem, req.file, req.text, projectName);
    specs.set(`requirement/${stem}`, doc);
  }
  return { name, root: undefined as unknown as Project, subprojects: new Map(), subprojectProblems: [], source, paths, requirements, specs, strayFiles, planIds };
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
  /** Path-derived ID of the owning spec, including requirement files. */
  specId?: string;
}

export type Resolution = { ok: true; target: Target } | { ok: false; code: "error"; reason: string };

const fail = (reason: string): Resolution => ({ ok: false, code: "error", reason });

/** Resolve a cite in a project (`architecture/file-formats` §3.4). `ownProject` is the project the citing spec is in. */
export function resolveCite(own: Project, cite: Cite): Resolution {
  let project = own;
  if ("project" in cite && cite.project !== null) {
    const found = cite.project === "root" ? own.root : own.root.subprojects.get(cite.project);
    if (!found) return fail(`subproject \`${cite.project}\` is not declared in the subprojects setting`);
    project = found;
  }
  const resolved = resolveIn(project, cite);
  if (!resolved.ok && own.name !== "root" && "project" in cite && cite.project === null && resolveIn(own.root, cite).ok) {
    return fail(`reference resolves only in the root project; use \`root:${cite.raw}\` to name the project`);
  }
  return resolved;
}

function resolveIn(project: Project, cite: Cite): Resolution {
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
      const specId = qualifyId(project.name, `requirement/${h.file.slice(h.file.lastIndexOf("/") + 1, -3)}`);
      return { ok: true, target: { kind: "requirement", file: h.file, startLine: h.startLine, endLine: h.endLine, text: h.text, specId } };
    }
    case "req-file": {
      const file = `${project.paths.requirements}/${cite.slug}.md`;
      const doc = project.specs.get(`requirement/${cite.slug}`);
      return !doc ? fail(`requirements file ${cite.slug}.md not found in the project`) : { ok: true, target: { kind: "requirement-file", file, text: doc.text, specId: doc.id } };
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
