import * as fs from "node:fs";
import * as path from "node:path";
import { GitError } from "../errors.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { loadPlans, planReferences } from "../plan/model.js";
import { planRecordFingerprint } from "../plan/status.js";
import { parseCite } from "./cites.js";
import { editKeys } from "./fm-edit.js";
import { LEGACY_RECORD_KEYS, specFingerprint } from "./fingerprint.js";
import { appendRecords, makeRecord, readNotes, type NoteRecord } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, resolveCite, targetFingerprint, type Project, allSpecs, findDoc, projectOf } from "./project.js";
import { commitExists, committedSource, headCommit } from "./source.js";
import { dependencyCites } from "./status.js";

/** `specplane migrate status`: move frontmatter records to the notes store (`architecture/reference-cli` §5.7). */

export interface MigrationItem { spec: string; kind: string; commit: string }
export interface MigrationPlan {
  items: { item: MigrationItem; record: NoteRecord }[];
  /** Files that lose their legacy keys. */
  files: string[];
  warnings: string[];
  /** Records already present from an earlier run, not written again. */
  skipped: number;
}
export interface MigrationResult extends MigrationPlan { dryRun: boolean; notesCommit: string | null; commit: string | null }

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const FULL_SHA = /^[0-9a-f]{40}$/;
const gitTry = (root: string, args: string[]): string | null => { try { return run("git", args, { cwd: root }); } catch (e) { if (e instanceof GitError) return null; throw e; } };
const hasLegacy = (d: Record<string, unknown>) => LEGACY_RECORD_KEYS.some((k) => d[k] !== undefined);

/** Records of one spec or plan, computed at `at` (the recorded commit, or HEAD when it is missing). */
function plan(root: string, head: Project, opts: { now?: Date }): MigrationPlan {
  const out: MigrationPlan = { items: [], files: [], warnings: [], skipped: 0 };
  const headSha = headCommit(root)!;
  const paths = loadSpecPaths(root).paths;
  const existing = readNotes(root);
  const have = (rec: NoteRecord): boolean => (existing.bySpec.get(rec.spec) ?? []).some((s) => {
    const r = s.rec;
    if (r.kind !== rec.kind || r.fingerprint !== rec.fingerprint) return false;
    return rec.kind !== "test-result" || (r.test === rec.test && r.outcome === rec.outcome && r.date === rec.date);
  });
  const projectAt = new Map<string, Project>();
  const at = (c: string): Project => { if (!projectAt.has(c)) projectAt.set(c, c === headSha ? head : loadProject(committedSource(root, c), paths)); return projectAt.get(c)!; };
  const where = (c: unknown): string => (typeof c === "string" && FULL_SHA.test(c) && commitExists(root, c) ? c : headSha);
  // Records written in one run get consecutive millisecond stamps, so their order is the order they were made in.
  const base = (opts.now ?? new Date()).getTime();
  const push = (spec: string, commit: string, rec: NoteRecord) => {
    if (have(rec)) { out.skipped++; return; }
    out.items.push({ item: { spec, kind: rec.kind, commit }, record: { ...rec, at: new Date(base + out.items.length).toISOString() } });
  };

  const common = (id: string, file: string, d: Record<string, unknown>, fpOf: (p: Project, commit: string) => string | null, citesOf: (p: Project) => Record<string, string>) => {
    let touched = false;
    const a = d.approval;
    if (isMap(a) && d.status === "approved") {
      touched = true;
      const commit = where(a.commit);
      const proj = at(commit);
      const stored = typeof a.fingerprint === "string" && /^(spec-v3|plan-v1):sha256:[0-9a-f]{64}$/.test(a.fingerprint) ? a.fingerprint : null;
      // A plan's recorded digest covered PLAN.md only; the content now includes its step files, so it is recomputed.
      const fingerprint = (id.startsWith("plan/") ? null : stored) ?? fpOf(proj, commit) ?? stored ?? fpOf(head, headSha);
      if (!fingerprint) out.warnings.push(`${file}: no fingerprint can be computed for its approval; skipped`);
      else {
        const cited = isMap(a.cited) ? (a.cited as Record<string, string>) : citesOf(proj);
        const fields = { by: a.by, date: a.date, cited, ...(typeof a.note === "string" ? { note: a.note } : {}) };
        const ov = isMap(a.override) ? a.override : null;
        // An override mark becomes an override record with target status (`reference-cli` §5.7).
        push(id, commit, ov
          ? makeRecord("override", id, fingerprint, { by: ov.by, date: ov.date, target: "status", value: "approved", cited, ...(fields.note ? { note: fields.note } : {}) })
          : makeRecord("approval", id, fingerprint, fields));
      }
    }
    if (Array.isArray(d.results)) {
      touched = true;
      for (const r of d.results) {
        if (!isMap(r) || typeof r.test !== "string") { out.warnings.push(`${file}: a results entry without a test id was dropped`); continue; }
        const { kind, commit: _c, fingerprint: fp0, ...rest } = r;
        const commit = where(r.commit);
        const fingerprint = (typeof fp0 === "string" ? fp0 : null) ?? fpOf(at(commit), commit) ?? fpOf(head, headSha);
        if (!fingerprint) { out.warnings.push(`${file}: result ${r.test} has no fingerprint that can be computed; skipped`); continue; }
        push(id, commit, makeRecord("test-result", id, fingerprint, { ...rest, "test-kind": kind, commit: r.commit }));
      }
    }
    if (isMap(d.implementation)) {
      touched = true;
      const impl = d.implementation;
      if (impl.status !== undefined && impl.status !== "implemented" && impl.status !== "complete") out.warnings.push(`${file}: implementation status ${JSON.stringify(impl.status)} is not implemented; no record written`);
      else {
        const commit = where(impl.commit);
        const fingerprint = (typeof impl.fingerprint === "string" ? impl.fingerprint : null) ?? fpOf(at(commit), commit) ?? fpOf(head, headSha);
        if (!fingerprint) out.warnings.push(`${file}: implementation has no fingerprint that can be computed; skipped`);
        else push(id, commit, makeRecord("implementation", id, fingerprint, { status: "implemented", ...(impl.by !== undefined ? { by: impl.by } : {}), ...(impl.date !== undefined ? { date: impl.date } : {}) }));
      }
    }
    return touched;
  };

  for (const doc of [...allSpecs(head)].sort((x, y) => x.id.localeCompare(y.id))) {
    const d = doc.fm.data;
    if (!d || !hasLegacy(d)) continue;
    if (doc.layer === "requirement") { out.warnings.push(`${doc.file}: requirement files are always approved; remove its legacy keys (${LEGACY_RECORD_KEYS.filter((k) => d[k] !== undefined).join(", ")}) by hand`); continue; }
    out.files.push(doc.file);
    common(doc.id, doc.file, d,
      (p, _c) => { const t = findDoc(p, doc.id)?.text; return t ? specFingerprint(t) : null; },
      (p) => {
        const cited: Record<string, string> = {};
        const then = findDoc(p, doc.id);
        for (const raw of dependencyCites(then?.fm.data ?? null)) {
          const cite = parseCite(raw);
          const res = cite ? resolveCite(then ? projectOf(p, then) : p, cite) : null;
          if (res?.ok) cited[raw] = targetFingerprint(res.target);
        }
        return cited;
      });
  }
  for (const rec of loadPlans(head.source, paths.plansDir)) {
    const d = rec.fm?.data;
    if (rec.legacy || !d || !hasLegacy(d)) continue;
    out.files.push(rec.planFile);
    const planAt = (p: Project) => loadPlans(p.source, paths.plansDir).find((r) => r.id === rec.id) ?? null;
    common(`plan/${rec.id}`, rec.planFile, d,
      (p) => { const r = planAt(p); return r ? planRecordFingerprint(r) : null; },
      (p) => {
        const cited: Record<string, string> = {};
        const r = planAt(p);
        for (const raw of r ? planReferences(r.fm) : []) {
          const cite = parseCite(raw);
          const res = cite ? resolveCite(p, cite) : null;
          if (res?.ok) cited[raw] = targetFingerprint(res.target);
        }
        return cited;
      });
  }
  return out;
}

/** Plan the migration (`dryRun`) or do it: records first, then one branch commit that deletes the legacy keys. */
export function migrateStatus(root: string, opts: { dryRun?: boolean; now?: Date } = {}): MigrationResult {
  const headSha = headCommit(root);
  if (!headSha) throw new GitError("git rev-parse HEAD", "the repository has no commits");
  const head = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
  const p = plan(root, head, opts);
  const result: MigrationResult = { ...p, dryRun: !!opts.dryRun, notesCommit: null, commit: null };
  if (opts.dryRun || (p.items.length === 0 && p.files.length === 0)) return result;
  const dirty = p.files.filter((f) => (gitTry(root, ["status", "--porcelain", "--", f]) ?? "").trim() !== "");
  if (dirty.length) throw new GitError("migrate status", `${dirty.join(", ")} ${dirty.length === 1 ? "has" : "have"} uncommitted changes; commit or stash them first, then run the migration again.`);
  // Records go on the commit each was recorded against; every attached commit gets its notes in one append.
  const byCommit = new Map<string, NoteRecord[]>();
  for (const { item, record } of p.items) byCommit.set(item.commit, [...(byCommit.get(item.commit) ?? []), record]);
  for (const [commit, records] of byCommit) appendRecords(root, commit, records);
  result.notesCommit = gitTry(root, ["rev-parse", "--verify", "--quiet", "refs/notes/specplane"])?.trim() ?? null;
  for (const f of p.files) {
    const abs = path.join(root, f);
    fs.writeFileSync(abs, editKeys(fs.readFileSync(abs, "utf8"), Object.fromEntries(LEGACY_RECORD_KEYS.map((k) => [k, undefined]))));
  }
  if (p.files.length) {
    run("git", ["add", "--", ...p.files], { cwd: root });
    run("git", ["commit", "-m", formatMessage({ type: "docs", scope: "specs", summary: "move records to notes", body: p.files.join("\n"), trailers: cliTrailers("spec", "") }), "--", ...p.files], { cwd: root });
    result.commit = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
  }
  return result;
}

export function formatMigration(r: MigrationResult): string[] {
  const lines = r.items.map(({ item }) => `${r.dryRun ? "would write" : "wrote"} ${item.kind} record for ${item.spec} on ${item.commit.slice(0, 7)}`);
  for (const f of r.files) lines.push(`${r.dryRun ? "would remove" : "removed"} legacy keys from ${f}`);
  if (r.skipped) lines.push(`${r.skipped} record(s) already in the notes store; not written again.`);
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  if (r.commit) lines.push(`Committed ${r.commit.slice(0, 7)}: docs(specs): move records to notes.`);
  if (!r.items.length && !r.files.length) lines.push("Nothing to migrate.");
  return lines;
}
