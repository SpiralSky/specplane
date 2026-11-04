import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "../config.js";
import { AlreadyExistsError, SpecNotFoundError, SpecplaneError, UnknownRootError, reportError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { withCheckoutLeaseAsync } from "../core/checkout-coordination.js";
import { formatHuman } from "../output/human.js";
import { formatJson } from "../output/json.js";
import { makeReport } from "../report.js";
import { ID_PATTERN } from "../schemas.js";
import { resolveSpecId } from "../spec/resolve.js";
import { assessContent, completionSnapshot } from "../spec/completion.js";
import { parseSpecContent } from "../spec/parse.js";
import type { ImplementationAssessment } from "../core/completion.js";
import { loadSpecs, validateSpecs } from "../spec/validate.js";
import { withContainedDirectory } from "../core/contained-files.js";
import { assertRecordingPaths } from "../plan/recording-set.js";
import type { Config, SpecRootConfig, ValidationReport } from "../types.js";

/** Usage errors that have no dedicated error class (exit 1). */
class SpecUsageError extends SpecplaneError {
  readonly exitCode = 1;
}

const TYPE_DIRS: Record<string, string> = { feature: "features", architecture: "architecture" };
const toPosix = (p: string) => p.split(path.sep).join("/");
export const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function load(root: string): Config {
  const { config, warnings } = loadConfig(root);
  for (const w of warnings) process.stderr.write(`${w.message}\n`);
  return config;
}

function findRoot(config: Config, name: string): SpecRootConfig {
  const r = config.spec_roots.find((x) => x.name === name);
  if (!r) throw new UnknownRootError(name);
  return r;
}

function checkType(type: string): void {
  if (!(type in TYPE_DIRS)) throw new SpecUsageError(`Unknown spec type \`${type}\`: expected \`feature\` or \`architecture\`.`);
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export const interactive = () => Boolean(process.stdin.isTTY);

/** De-slugged default title: hyphens (and slashes) to spaces, first letter capitalised. */
export function defaultTitle(slug: string): string {
  const t = slug.replace(/[-/]+/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Body scaffold from the `architecture/file-formats` §1.3 and §1.4 templates (headings only). */
function scaffold(type: string, title: string): string {
  const sections =
    type === "feature"
      ? ["Rules", "Acceptance scenarios", "Edge cases"]
      : ["Components", "Data structures", "Error handling"];
  return `# ${title}\n\n` + sections.map((s) => `---\n\n## ${s}\n`).join("\n");
}

export interface SpecNewOptions {
  root?: string;
  title?: string;
  implements?: string;
  extends?: string;
}

export interface CreationScaffold {
  operation: 'spec.new' | 'plan.new' | 'decision.new';
  identity: string;
  path: string;
  files: { path: string; content: string }[];
  directories: string[];
}

/** Shared dedicated-creation writer; previews never call this function. */
export function applyCreationScaffold(plan: CreationScaffold, root: string): void {
  const files = structuredClone(plan.files);
  if (!files.length || new Set(files.map(file => file.path)).size !== files.length) throw new SpecUsageError('Invalid creation scaffold.');
  assertRecordingPaths(root, files.map(file => file.path));
  for (const file of files) {
    try { fs.lstatSync(path.join(root, file.path)); throw new AlreadyExistsError(plan.operation === 'spec.new' ? 'Spec' : plan.operation === 'plan.new' ? 'Plan' : 'Decision', file.path); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  for (const file of files) {
    const parent = path.posix.dirname(file.path);
    withContainedDirectory(root, parent === '.' ? null : parent, true, directory => directory.writeExclusive(path.posix.basename(file.path), file.content));
  }
}

function newSpecIdentity(type: string, rawSlug: string, opts: SpecNewOptions, root: string, config: Config) {
  checkType(type);
  const rootCfg = findRoot(config, opts.root ?? 'base'), slug = rawSlug.toLowerCase(), id = `${type}/${slug}`;
  if (!new RegExp(ID_PATTERN).test(id)) throw new SpecUsageError(`Invalid slug \`${rawSlug}\`: use lowercase letters, digits, and hyphens.`);
  let exists = true;
  try { resolveSpecId(id, config, rootCfg.name, root); }
  catch (e) { if (e instanceof SpecplaneError) exists = false; else throw e; }
  if (exists) throw new AlreadyExistsError('Spec', id);
  return { rootCfg, slug, id };
}

/** Deterministic, noninteractive preview of the dedicated spec creation operation. */
export function renderSpecNew(type: string, rawSlug: string, opts: SpecNewOptions, root: string, config: Config): CreationScaffold {
  const { rootCfg, slug, id } = newSpecIdentity(type, rawSlug, opts, root, config);
  const impl = csv(opts.implements), ext = csv(opts.extends), title = opts.title?.trim() || defaultTitle(slug);
  if (type === 'architecture' && !impl.length) throw new SpecUsageError('Architecture spec needs `--implements`.');
  const lines = [`id: ${id}`, `title: ${JSON.stringify(title)}`, 'status: draft', 'author: user'];
  if (impl.length) lines.push(`implements: ${JSON.stringify(impl)}`);
  if (ext.length) lines.push(`extends: ${ext.length === 1 ? JSON.stringify(ext[0]) : JSON.stringify(ext)}`);
  const relative = toPosix(path.join(rootCfg.path, TYPE_DIRS[type], ...`${slug}.md`.split('/')));
  assertRecordingPaths(root, [relative]);
  return { operation: 'spec.new', identity: `${rootCfg.name}:${id}`, path: relative, directories: [path.posix.dirname(relative)], files: [{ path: relative, content: `---\n${lines.join('\n')}\n---\n${scaffold(type, title)}` }] };
}

export function applySpecNew(plan: CreationScaffold, root: string): void {
  if (plan.operation !== 'spec.new') throw new SpecUsageError('Expected a spec creation scaffold.');
  applyCreationScaffold(plan, root);
}

/** Create a spec file; returns its repository-relative path. */
export async function specNew(type: string, rawSlug: string, opts: SpecNewOptions, root: string, config: Config): Promise<string> {
  const { slug } = newSpecIdentity(type, rawSlug, opts, root, config);

  let impl = csv(opts.implements);
  if (type === "architecture" && impl.length === 0 && interactive()) impl = csv(await ask("Feature spec IDs implemented (comma-separated): "));
  if (type === "architecture" && impl.length === 0) throw new SpecUsageError("Architecture spec needs `--implements`.");

  let title = opts.title?.trim();
  if (!title && interactive()) title = await ask("Title: ");
  if (!title) title = defaultTitle(slug);

  const plan = renderSpecNew(type, rawSlug, { ...opts, title, implements: impl.join(',') }, root, config);
  applySpecNew(plan, root);
  return plan.path;
}

export async function specNewCommand(type: string, slug: string, opts: SpecNewOptions): Promise<void> {
  try {
    const root = checkoutRoot();
    const rel = await withCheckoutLeaseAsync(root, "spec-new", false, () => specNew(type, slug, opts, root, load(root)));
    process.stdout.write(`Created ${rel}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

export interface SpecListRow extends ImplementationAssessment {
  id: string;
  title: string;
  status: string;
  author: string;
  root: string;
}

export interface SpecListOptions {
  status?: string;
  type?: string;
  root?: string;
  json?: boolean;
}

/** Rows sorted by ID then root, plus notes for specs with invalid frontmatter. */
export function specList(opts: SpecListOptions, root: string, config: Config): { rows: SpecListRow[]; problems: string[] } {
  const only = opts.root === undefined ? undefined : findRoot(config, opts.root);
  if (opts.type !== undefined) checkType(opts.type);
  const { specs, findings, contents } = loadSpecs(config, root);
  const snapshot = completionSnapshot(config, root, contents);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const rows = specs
    .filter((s) => (only === undefined || s.root.name === only.name) && (opts.type === undefined || s.id.startsWith(`${opts.type}/`)) && (opts.status === undefined || s.frontmatter.status === opts.status))
    .map((s) => ({ id: s.id, title: s.frontmatter.title, status: s.frontmatter.status, author: s.frontmatter.author, root: s.root.name, ...assessContent(s.id, s.root.name, s.content!, snapshot) }))
    .sort((a, b) => cmp(a.id, b.id) || cmp(a.root, b.root));
  const problems = findings
    .filter((f) => f.type === "schema" && f.spec !== undefined && (only === undefined || f.file.startsWith(`${toPosix(only.path)}/`)))
    .map((f) => `Skipped ${f.file}: ${f.message}`);
  return { rows, problems };
}

export function formatList(rows: SpecListRow[]): string {
  const w1 = Math.max(0, ...rows.map((r) => r.id.length));
  const w2 = Math.max(0, ...rows.map((r) => r.title.length));
  return rows.map((r) => `${r.id.padEnd(w1)}  ${r.title.padEnd(w2)}  ${r.status}  implementation: ${r.implementation_status ?? "unrecorded"}  assessment: ${r.assessment_status}\n${r.assessment_reasons.map(reason => `  ${reason.spec}: ${reason.message}\n`).join("")}`).join("");
}

export function specListCommand(opts: SpecListOptions): void {
  try {
    const root = checkoutRoot();
    const { rows, problems } = specList(opts, root, load(root));
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stdout.write(opts.json ? JSON.stringify(rows, null, 2) + "\n" : formatList(rows));
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

/** Absolute path of the spec for `id`, qualified by `--root` when the ID carries no prefix. */
export function specShowPath(id: string, opts: { root?: string }, root: string, config: Config): string {
  const raw = opts.root !== undefined && !id.includes(":") ? `${opts.root}:${id}` : id;
  return resolveSpecId(raw, config, undefined, root).path;
}

export function specShowCommand(id: string, opts: { root?: string; json?: boolean }): void {
  try {
    const root = checkoutRoot();
    const config = load(root);
    const raw = opts.root !== undefined && !id.includes(":") ? `${opts.root}:${id}` : id;
    const { contents } = loadSpecs(config, root);
    const hit = resolveSpecId(raw, config, undefined, root, file => contents.has(file));
    const content = contents.get(hit.path)!;
    parseSpecContent(content, hit.path);
    const assessment = assessContent(hit.id, hit.root, content, completionSnapshot(config, root, contents));
    if (opts.json) process.stdout.write(JSON.stringify({ id: hit.id, root: hit.root, path: toPosix(path.relative(root, hit.path)), content, ...assessment }, null, 2) + "\n");
    else process.stdout.write(`${content}${content.endsWith("\n") ? "" : "\n"}\nImplementation: ${assessment.implementation_status ?? "unrecorded"}\nAssessment: ${assessment.assessment_status}\n${assessment.assessment_reasons.map(r => `  ${r.spec}: ${r.message}\n`).join("")}Fingerprint matches do not verify code.\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

/** Spec checks only: all specs, or the named ones (findings filtered to their files). */
export function specValidate(ids: string[], root: string, config: Config): ValidationReport {
  const all = validateSpecs(config, root);
  if (ids.length === 0) return all;
  const { specs, findings } = loadSpecs(config, root);
  const rels = new Set<string>();
  const names: string[] = [];
  for (const id of ids) {
    const hit = resolveSpecId(id, config, undefined, root);
    const rel = toPosix(path.relative(root, hit.path));
    if (!specs.some((s) => s.rel === rel) && !findings.some((f) => f.file === rel)) throw new SpecNotFoundError(id);
    rels.add(rel);
    names.push(hit.id);
  }
  const report = makeReport([...all.errors, ...all.warnings].filter((f) => rels.has(f.file)), names);
  report.implementations = (all.implementations ?? []).filter(item => rels.has(item.path));
  return report;
}

export function specValidateCommand(ids: string[], opts: { json?: boolean }): void {
  try {
    const root = checkoutRoot();
    const report = specValidate(ids, root, load(root));
    if (opts.json) process.stdout.write(formatJson(report));
    else process.stderr.write(formatHuman(report));
    process.exitCode = report.valid ? 0 : 1;
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
