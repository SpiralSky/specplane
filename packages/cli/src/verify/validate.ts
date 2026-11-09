import { citeKey, extractBodyCites, parseCite, type Layer } from "../spec/cites.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveCite, type Project, type SpecDoc } from "../spec/project.js";
import { checkRequirementIds } from "../spec/requirements.js";
import { CommitProjects, computeStatus, dependencyCites } from "../spec/status.js";
import { committedSource, headCommit, worktreeSource } from "../spec/source.js";

/** Validation rules over the project snapshot (`architecture/reference-cli` §6). Read-only. */

export type Severity = "error" | "warning" | "note";

export interface Finding {
  severity: Severity;
  /** Rule family: `config`, `requirements`, `spec-format`, `cites`, `status`. */
  rule: string;
  message: string;
  file: string;
  line?: number;
  /** Section ID the finding is in, when known. */
  section?: string;
  /** `worktree` when the file differs from HEAD (or is not committed), else `committed`. */
  source: "committed" | "worktree";
}

export interface Report {
  findings: Finding[];
  counts: { errors: number; warnings: number; notes: number };
  /** IDs of the specs that were checked. */
  checked: string[];
  /** Effective status of each checked spec, computed from HEAD. */
  statuses: { id: string; stored: string | null; effective: string; reasons: string[] }[];
}

const KNOWN_KEYS = new Set(["id", "title", "status", "approval", "review-reason", "authors", "covers", "implements", "references", "results", "implementation"]);
const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Emit = (severity: Severity, rule: string, message: string, file: string, line?: number, section?: string) => void;

function checkAuthorItem(v: unknown, where: string, allowDelegated: boolean): string | null {
  if (!isMap(v)) return `${where} must be a mapping with \`human\` or \`llm\``;
  const keys = Object.keys(v);
  const who = ["human", "llm"].filter((k) => k in v);
  if (who.length !== 1) return `${where} needs exactly one of \`human\` or \`llm\``;
  if (typeof v[who[0]] !== "string" || !(v[who[0]] as string).trim()) return `${where}.${who[0]} must be a non-empty string`;
  const extra = keys.filter((k) => k !== who[0] && k !== "contribution" && !(allowDelegated && k === "delegated-by"));
  if (extra.length) return `${where} has unknown field \`${extra[0]}\``;
  if ("contribution" in v && typeof v.contribution !== "string") return `${where}.contribution must be a string`;
  if ("delegated-by" in v && (typeof v["delegated-by"] !== "string" || !v["delegated-by"])) return `${where}.delegated-by must be a non-empty string`;
  if ("delegated-by" in v && !("llm" in v)) return `${where}.delegated-by is only valid on an LLM approver`;
  return null;
}

/** Frontmatter and heading rules for one spec (`architecture/file-formats` §2.1). */
function checkSpecFormat(doc: SpecDoc, emit: Emit): void {
  const f = doc.file;
  const err = (m: string) => emit("error", "spec-format", m, f, 1);
  if (doc.fm.error || !doc.fm.data) { err(doc.fm.error ?? "frontmatter is missing"); return; }
  const d = doc.fm.data;
  if (d.id !== doc.id) err(`id is ${JSON.stringify(d.id)} but the path gives ${doc.id}`);
  if (typeof d.title !== "string" || !d.title.trim() || d.title.includes("\n")) err("title must be a non-empty single line");
  if (d.status !== "awaiting-review" && d.status !== "approved") err(`status must be \`awaiting-review\` or \`approved\`, not ${JSON.stringify(d.status)}`);
  if (!Array.isArray(d.authors)) err("authors is required and must be a list (it may be empty)");
  else d.authors.forEach((a, i) => { const m = checkAuthorItem(a, `authors[${i}]`, false); if (m) err(m); });
  for (const k of ["covers", "implements", "references"] as const) {
    const v = d[k];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) { err(`${k} must be a list of cite strings`); continue; }
    for (const item of v as string[]) if (!parseCite(item)) err(`${k} item ${JSON.stringify(item)} is not a valid cite`);
  }
  if (doc.layer === "architecture" && d.covers !== undefined) err("`covers` is only for feature specs; an architecture spec uses `implements`");
  if (doc.layer === "feature" && d.implements !== undefined) err("`implements` is only for architecture specs; a feature spec uses `covers`");
  if (doc.layer !== "architecture" && d.implementation !== undefined) err("`implementation` is only valid on an architecture spec");
  for (const k of Object.keys(d)) if (!KNOWN_KEYS.has(k)) emit("warning", "spec-format", `unknown frontmatter field \`${k}\` (it counts as content)`, f, 1);
  const status = d.status;
  if (status === "approved") {
    const a = d.approval;
    if (!isMap(a)) err("status is approved but `approval` is missing or not a mapping");
    else {
      const m = checkAuthorItem(a.by, "approval.by", true);
      if (m) err(m);
      if (typeof a.date !== "string" || !DATE.test(a.date)) err("approval.date must be YYYY-MM-DD");
      if (typeof a.commit !== "string" || !/^[0-9a-f]{40}$/.test(a.commit)) err("approval.commit must be a 40-character commit hash");
      if (a.fingerprint !== undefined && (typeof a.fingerprint !== "string" || !/^spec-v2:sha256:[0-9a-f]{64}$/.test(a.fingerprint))) err("approval.fingerprint must look like spec-v2:sha256:<hex>");
      if (a.cited !== undefined) {
        if (!isMap(a.cited) || Object.values(a.cited).some((x) => typeof x !== "string")) err("approval.cited must map cite strings to part fingerprints");
      }
      if (a.note !== undefined && typeof a.note !== "string") err("approval.note must be a string");
      for (const k of Object.keys(a)) if (!["by", "date", "commit", "fingerprint", "cited", "note", "override"].includes(k)) emit("warning", "spec-format", `unknown approval field \`${k}\``, f, 1);
    }
    if (d["review-reason"] !== undefined) emit("warning", "spec-format", "review-reason is present on an approved spec", f, 1);
  } else if (status === "awaiting-review") {
    if (d.approval !== undefined) err("`approval` is present but status is awaiting-review");
    const rr = d["review-reason"];
    if (rr !== undefined && !(typeof rr === "string" || (Array.isArray(rr) && rr.every((x) => typeof x === "string")))) err("review-reason must be a string or a list of strings");
  }
  for (const s of doc.index.duplicates) emit("error", "spec-format", `duplicate section ${s.id} (first at line ${s.first})`, f, s.second, s.id);
  for (const s of doc.index.wrongParent) emit("error", "spec-format", `section ${s.id} is nested under ${s.foundUnder}, not its parent ${s.parentId}`, f, s.line, s.id);
}

/** Cite rules for one spec (`architecture/reference-cli` §4.3). */
function checkSpecCites(project: Project, doc: SpecDoc, emit: Emit): void {
  if (!doc.fm.data) return;
  const f = doc.file;
  const isKnown = (layer: Layer, slug: string) => project.specs.has(`${layer}/${slug}`);
  const body = extractBodyCites(doc.lines, doc.fm.bodyStartLine, doc.index, { layer: doc.layer, slug: doc.slug }, isKnown);
  const listed = new Set(dependencyCites(doc.fm.data).map(citeKey));
  const used = new Set<string>();
  const resolveAndReport = (raw: string, line: number | undefined, where: string) => {
    const cite = parseCite(raw);
    if (!cite) return;
    const r = resolveCite(project, cite);
    if (r.ok) return;
    if (r.code === "later-release") emit("warning", "cites", `${where} \`${raw}\`: ${r.reason}`, f, line);
    else emit("error", "cites", `unresolved cite \`${raw}\` in ${where}: ${r.reason}`, f, line);
  };
  const seen = new Set<string>();
  for (const b of body) {
    const key = citeKey(b.raw);
    used.add(key);
    // A subproject cite cannot be resolved yet (later release), so listing it is not enforced either.
    const subproject = "project" in b.cite && b.cite.project !== null && b.cite.project !== "root";
    if (!listed.has(key) && !seen.has(key) && !subproject) {
      seen.add(key);
      if (b.cite.kind === "spec") emit("warning", "cites", `whole-spec cite \`${b.raw}\` in the body is not listed in references; cite a section or list it`, f, b.line);
      else emit("error", "cites", `cite \`${b.raw}\` is used in the body but missing from references, covers and implements`, f, b.line);
    }
    const bodyKey = `${key}@body`;
    if (!seen.has(bodyKey)) { seen.add(bodyKey); resolveAndReport(b.raw, b.line, "the body"); }
  }
  const ownKeys = new Set(["covers", "implements"].flatMap((k) => (Array.isArray(doc.fm.data![k]) ? (doc.fm.data![k] as unknown[]) : []).filter((x): x is string => typeof x === "string").map(citeKey)));
  for (const raw of listed) {
    resolveAndReport(raw, 1, "the frontmatter");
    if (!used.has(raw) && !ownKeys.has(raw)) emit("warning", "cites", `references lists \`${raw}\`, which the body never cites`, f, 1);
  }
}

export interface ValidateOptions { ids?: string[] }

/** Run every rule and return the report. `root` is the checkout root. */
export function validateProject(root: string, opts: ValidateOptions = {}): Report {
  const findings: Finding[] = [];
  const { paths, findings: cfg } = loadSpecPaths(root);
  const head = headCommit(root);
  const wt = loadProject(worktreeSource(root), paths);
  const headProject = head ? loadProject(committedSource(root, head), paths) : null;
  const sourceOf = (file: string): "committed" | "worktree" => {
    const then = headProject?.source.read(file) ?? null;
    return then !== null && then === wt.source.read(file) ? "committed" : "worktree";
  };
  const emit: Emit = (severity, rule, message, file, line, section) => {
    findings.push({ severity, rule, message, file, ...(line !== undefined ? { line } : {}), ...(section ? { section } : {}), source: sourceOf(file) });
  };
  for (const c of cfg) emit(c.severity, "config", c.message, ".specplane/config.yaml");

  // Requirements.
  const req = wt.requirements;
  for (const p of req.problems) emit("error", "requirements", p.message, p.file);
  for (const u of req.unlisted) emit("warning", "requirements", `${u} is not listed in the central requirements file`, `${paths.requirements}/${u}`);
  for (const p of checkRequirementIds(req.files, req.central)) emit("error", "requirements", p.message, p.file, p.line);

  // Specs.
  const wanted = opts.ids?.length ? new Set(opts.ids) : null;
  for (const s of wt.strayFiles) emit("error", "spec-format", s.reason, s.file);
  const checked: string[] = [];
  for (const doc of wt.specs.values()) {
    if (wanted && !wanted.has(doc.id)) continue;
    checked.push(doc.id);
    checkSpecFormat(doc, emit);
    checkSpecCites(wt, doc, emit);
  }

  // Status from committed content.
  const statuses: Report["statuses"] = [];
  if (headProject) {
    const commits = new CommitProjects(root, headProject);
    for (const doc of headProject.specs.values()) {
      if (wanted && !wanted.has(doc.id)) continue;
      if (!doc.fm.data) continue;
      const st = computeStatus(headProject, doc, commits, wt.source.read(doc.file));
      const stored = typeof doc.fm.data.status === "string" ? doc.fm.data.status : null;
      statuses.push({ id: doc.id, stored, effective: st.status, reasons: st.reasons });
      for (const w of st.warnings) emit("warning", "status", w, doc.file, 1);
      for (const n of st.notes) emit("note", "status", n, doc.file);
      if (st.status === "awaiting-review" && stored === "approved") emit("warning", "status", `stored status is approved but the effective status is awaiting-review (${st.reasons.join("; ")})`, doc.file, 1);
      else if (st.status === "approved" && stored !== "approved") emit("warning", "status", "stored status disagrees with the effective status approved", doc.file, 1);
    }
  } else emit("note", "status", "the repository has no commits; effective status is not computed", ".");

  findings.sort((a, b) => (a.file === b.file ? (a.line ?? 0) - (b.line ?? 0) : a.file < b.file ? -1 : 1));
  const counts = { errors: 0, warnings: 0, notes: 0 };
  for (const f of findings) counts[f.severity === "error" ? "errors" : f.severity === "warning" ? "warnings" : "notes"]++;
  return { findings, counts, checked, statuses };
}

/** Plain-text report: one line per finding and a summary. */
export function formatReport(r: Report): string {
  const lines = r.findings.map((f) => `[${f.severity}] ${f.file}${f.line !== undefined ? `:${f.line}` : ""} (${f.rule}${f.source === "worktree" ? ", worktree" : ""}): ${f.message}`);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  lines.push(`Summary: ${plural(r.checked.length, "spec")} checked, ${plural(r.counts.errors, "error")}, ${plural(r.counts.warnings, "warning")}, ${plural(r.counts.notes, "note")}`);
  return lines.join("\n") + "\n";
}
