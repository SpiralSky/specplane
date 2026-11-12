import * as fs from "node:fs";
import * as path from "node:path";
import { audit, type AuditEntry } from "../audit/log.js";
import { GitError } from "../errors.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { Authorized, guard, gitUserName, type Actor, type GuardResult, type Preset } from "../perm/permissions.js";
import { holdRequest, sentMessage } from "../requests/hold.js";
import type { RequestRecord } from "../requests/store.js";
import { parseCite } from "./cites.js";
import { editKeys } from "./fm-edit.js";
import { specFingerprint } from "./fingerprint.js";
import { appendRecords, isApproving, makeRecord, notesTip, type NoteRecord } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, resolveCite, targetFingerprint, type Project, type SpecDoc, allSpecs, findDoc, projectOf } from "./project.js";
import { currentResults, failedTests } from "./results.js";
import { commitExists, committedSource, headCommit, worktreeSource } from "./source.js";
import { computeStatus, dependencyCites, specSubject, StatusCtx } from "./status.js";

/**
 * Human approval, reopen, metadata and override commands (`architecture/reference-cli` §5.3, §5.4, §13.2, §13.4;
 * `feature/cli` R16, R17). Every mutating function takes an `Authorized` token from the guard.
 */

export interface Ctx {
  root: string;
  actor: Actor;
  preset: Preset;
  now?: Date;
  /** Request being accepted, recorded in the audit log (`reference-cli` §8). */
  request?: string;
}

export interface Result {
  ok: boolean;
  /** Human-readable lines: what happened, then details. */
  lines: string[];
  /** Every reason a refusal found. */
  reasons: string[];
  /** Commit made, or null (staged, or nothing to commit). */
  commit: string | null;
  warnings: string[];
  /** Specs written. */
  written: string[];
  /** Id of the request sent instead of acting (`request user`); the action was not done. */
  request?: string;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const today = (ctx: Ctx) => (ctx.now ?? new Date()).toISOString().slice(0, 10);
const git = (root: string, args: string[]) => run("git", args, { cwd: root });
const revCommit = (root: string, rev: string): string | null => { try { return git(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]).trim() || null; } catch { return null; } };

function result(partial: Partial<Result> & { ok: boolean }): Result {
  return { lines: [], reasons: [], commit: null, warnings: [], written: [], ...partial };
}

function loadHead(root: string, rev = "HEAD"): Project {
  if (!headCommit(root)) throw new GitError("git rev-parse HEAD", "the repository has no commits");
  return loadProject(committedSource(root, rev), loadSpecPaths(root).paths);
}

function auditAll(ctx: Ctx, base: Omit<AuditEntry, "actor">, extra: Partial<AuditEntry> = {}): void {
  audit(ctx.root, { request: ctx.request, ...base, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name }, ...extra }, ctx.now);
}

type Held = { kind: "held"; request: RequestRecord };

/**
 * Run the guard. A refusal is audited; `request user` stores a request (which audits `request-sent`) and the action
 * does not run. `params` are what accepting the request runs again (`requests/actions.ts`).
 */
function decide(ctx: Ctx, needs: (string | string[])[], describe: string, command: string, args: string[], params: Record<string, unknown> = {}): GuardResult | Held {
  const g = guard(ctx.preset, ctx.actor, needs, describe);
  if (g.kind === "deny") auditAll(ctx, { command, args, permission: g.permission, outcome: "refused", reason: g.message });
  if (g.kind === "request") {
    const request = holdRequest({ root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission, command, params, reason: `${describe} (\`${command} ${args.join(" ")}\`).`, now: ctx.now });
    return { kind: "held", request };
  }
  return g;
}

const refusal = (g: Exclude<GuardResult, { kind: "allow" }> | Held): Result =>
  g.kind === "held" ? result({ ok: true, request: g.request.id, lines: [sentMessage(g.request)] }) : result({ ok: false, reasons: [g.message] });

/** Identity of the person running the command: git `user.name`; never invented (`cli R16`). */
function humanName(ctx: Ctx): string | null {
  return ctx.actor.kind === "human" ? gitUserName(ctx.root) ?? (ctx.actor.name || null) : null;
}

function isDirty(root: string, file: string): boolean {
  return git(root, ["status", "--porcelain", "--", file]).trim() !== "";
}

/** Tarjan strongly connected components over resolved spec-to-spec dependencies. */
function components(head: Project): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const doc of allSpecs(head)) {
    const out = new Set<string>();
    for (const raw of dependencyCites(doc.fm.data)) {
      const cite = parseCite(raw);
      if (!cite) continue;
      const res = resolveCite(projectOf(head, doc), cite);
      if (res.ok && res.target.specId && res.target.specId !== doc.id) out.add(res.target.specId);
    }
    edges.set(doc.id, [...out]);
  }
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>();
  const comp = new Map<string, string[]>();
  let n = 0;
  const visit = (v: string): void => {
    index.set(v, n); low.set(v, n); n++; stack.push(v); on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const members: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); members.push(w); } while (w !== v);
      members.sort();
      for (const m of members) comp.set(m, members);
    }
  };
  for (const id of edges.keys()) if (!index.has(id)) visit(id);
  return comp;
}

/** `cited` map and fingerprint of the committed content (`file-formats` §4.4). */
function fingerprintsOf(head: Project, doc: SpecDoc): { fingerprint: string; cited: Record<string, string> } {
  const cited: Record<string, string> = {};
  for (const raw of dependencyCites(doc.fm.data)) {
    const cite = parseCite(raw);
    if (!cite) continue;
    const res = resolveCite(projectOf(head, doc), cite);
    if (res.ok) cited[raw] = targetFingerprint(res.target);
  }
  return { fingerprint: specFingerprint(doc.text)!, cited };
}

/** Append records to the note on HEAD in one notes commit; the branch, index and working tree are untouched (`file-formats` §13.3). */
function writeRecords(ctx: Ctx, records: NoteRecord[], rev = "HEAD"): string | null {
  const head = revCommit(ctx.root, rev);
  if (!head) throw new GitError(`git rev-parse ${rev}`, `\`${rev}\` is not a commit in this repository`);
  appendRecords(ctx.root, head, records);
  return notesTip(ctx.root);
}

function atomicWrite(abs: string, text: string): void {
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, abs);
}

interface WriteOp { doc: SpecDoc; edits: Record<string, unknown | undefined> }

/**
 * Write the edits and commit exactly those files with workflow `spec` or `approve`. A file that already had other
 * uncommitted changes is written but not committed (`reference-cli` §13.4).
 */
function writeAndCommit(_auth: Authorized, ctx: Ctx, ops: WriteOp[], workflow: "spec" | "approve", summary: string, body: string, noCommit: boolean): { commit: string | null; notes: string[] } {
  const notes: string[] = [];
  let dirty = false;
  for (const op of ops) {
    const abs = path.join(ctx.root, op.doc.file);
    if (isDirty(ctx.root, op.doc.file)) dirty = true;
    atomicWrite(abs, editKeys(fs.readFileSync(abs, "utf8"), op.edits));
  }
  const files = ops.map((o) => o.doc.file);
  if (dirty) {
    notes.push("The file had other uncommitted changes, so nothing was committed; the change takes effect when the file is committed.");
    return { commit: null, notes };
  }
  git(ctx.root, ["add", "--", ...files]);
  if (noCommit) { notes.push("Staged, not committed (--no-commit); the change takes effect when committed."); return { commit: null, notes }; }
  const message = formatMessage({ type: "docs", scope: "specs", summary, body, trailers: cliTrailers(workflow, "") });
  git(ctx.root, ["commit", "-m", message, "--", ...files]);
  return { commit: git(ctx.root, ["rev-parse", "HEAD"]).trim(), notes };
}

function findSpec(head: Project, id: string): SpecDoc | null {
  return findDoc(head, id) ?? null;
}

const notFound = (id: string, head: Project) =>
  `Specification \`${id}\` not found. Known IDs: ${allSpecs(head).map((d) => d.id).sort().join(", ") || "(none)"}.`;

/* ------------------------------------------------------------------ approve */

export interface ApproveOptions {
  /** Confirms a group in advance (`--yes`). */
  yes?: boolean;
  /** Approve the specs as written on this branch or commit instead of the current one (`--ref`); default HEAD. */
  ref?: string;
  /** Whether a person can be asked. */
  interactive?: boolean;
  ask?: (members: string[]) => Promise<boolean>;
}

export async function approveSpecs(ctx: Ctx, ids: string[], opts: ApproveOptions = {}): Promise<Result> {
  const g = decide(ctx, ["spec.approve"], "Approving specifications", "spec approve", ids, { ids });
  if (g.kind !== "allow") return refusal(g);
  const name = ctx.actor.kind === "llm" ? ctx.actor.model || "unknown" : humanName(ctx);
  const by = ctx.actor.kind === "llm" ? { llm: name, "delegated-by": ctx.actor.delegatedBy || "unknown" } : { human: name };
  const rev = opts.ref ?? "HEAD";
  if (!revCommit(ctx.root, rev)) return result({ ok: false, reasons: [`\`--ref ${rev}\` is not a branch or commit in this repository.`] });
  const head = loadHead(ctx.root, rev);
  const reasons: string[] = [];
  // Another branch has no working tree here: its committed files are what is approved (`reference-cli` §5.3).
  const onHead = rev === "HEAD" || revCommit(ctx.root, rev) === revCommit(ctx.root, "HEAD");
  if (!name) reasons.push("Cannot tell who is approving: set git `user.name`. The approver is never invented.");

  const named: SpecDoc[] = [];
  for (const id of ids) {
    const doc = findSpec(head, id);
    if (doc) named.push(doc); else reasons.push(notFound(id, head));
  }
  const comp = components(head);
  const memberIds = new Set<string>();
  for (const d of named) for (const m of comp.get(d.id) ?? [d.id]) memberIds.add(m);
  // A requirement file is always approved and never needs a record, so it is not a member (`file-formats` §1.2).
  for (const m of [...memberIds]) if (findDoc(head, m)?.layer === "requirement") memberIds.delete(m);
  const members = [...memberIds].sort().map((m) => findDoc(head, m)!);
  if (reasons.length === 0 && members.length === 0 && named.length) {
    for (const id of ids) auditAll(ctx, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "done", reason: "requirement file is always approved" });
    return result({ ok: true, lines: [`${named.map((d) => d.id).join(", ")}: a requirement file is always approved and has no record. Nothing changed.`] });
  }

  const commits = new StatusCtx(ctx.root, head, rev);
  const effective = new Map<string, ReturnType<typeof computeStatus>>();
  for (const doc of members) {
    if (!doc.fm.data) { reasons.push(`\`${doc.id}\` has unreadable frontmatter: ${doc.fm.error}`); continue; }
    if (onHead && isDirty(ctx.root, doc.file)) reasons.push(`\`${doc.id}\` has uncommitted changes. Commit ${doc.file} first; approval applies to committed content.`);
    effective.set(doc.id, computeStatus(head, doc, commits));
    for (const raw of dependencyCites(doc.fm.data)) {
      const cite = parseCite(raw);
      if (!cite) continue;
      const res = resolveCite(projectOf(head, doc), cite);
      if (!res.ok) {
        reasons.push(`\`${doc.id}\` references \`${raw}\`, which does not exist: ${res.reason}.`);
        continue;
      }
      const dep = res.target.specId;
      if (dep && dep !== doc.id && !memberIds.has(dep)) {
        const depDoc = findDoc(head, dep)!;
        const st = computeStatus(head, depDoc, commits);
        if (st.status !== "approved") reasons.push(`\`${doc.id}\` references \`${dep}\` (via \`${raw}\`), which is ${st.status}${st.reasons.length ? ` (${st.reasons.join("; ")})` : ""}. Approve \`${dep}\` first.`);
      }
    }
    const failed = failedTests(commits, doc);
    if (failed.length) reasons.push(`\`${doc.id}\` has a failed test result (${failed.join(", ")}) and cannot be approved.`);
  }
  if (reasons.length) {
    for (const id of ids) auditAll(ctx, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "refused", reason: reasons.join(" | ") });
    return result({ ok: false, reasons });
  }

  const todo = members.filter((d) => effective.get(d.id)?.status !== "approved");
  if (todo.length === 0) {
    for (const id of ids) auditAll(ctx, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "done", reason: "already approved" });
    return result({ ok: true, lines: [`Already approved: ${members.map((m) => m.id).join(", ")}. Nothing changed.`] });
  }

  if (members.length > 1) {
    if (!opts.yes) {
      if (!opts.interactive || !opts.ask) {
        const r = ["Group approval needs confirmation: pass --yes, or run in a terminal. Nothing was approved.", `Group: ${members.map((m) => m.id).join(", ")}`];
        for (const id of ids) auditAll(ctx, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "refused", reason: "group approval not confirmed" });
        return result({ ok: false, reasons: r });
      }
      if (!(await opts.ask(members.map((m) => m.id)))) {
        for (const id of ids) auditAll(ctx, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "cancelled", reason: "group not confirmed" });
        return result({ ok: false, lines: ["Not confirmed. Nothing was approved."] });
      }
    }
  }

  // Members of one group share `by` and `date`; every record goes into one notes commit (`file-formats` §2.3, §13.3).
  const at = ctx.now ?? new Date();
  const records = todo.map((doc) => {
    const { fingerprint, cited } = fingerprintsOf(head, doc);
    return makeRecord("approval", doc.id, fingerprint, { by, date: today(ctx), cited }, at);
  });
  const commit = writeRecords(ctx, records, rev);
  for (const doc of todo) {
    auditAll(ctx, { command: "spec approve", args: [doc.id], permission: "spec.approve", outcome: "done",
      old: { effective: effective.get(doc.id)?.status }, new: { status: "approved", by } });
  }
  const skipped = members.filter((m) => !todo.includes(m));
  return result({
    ok: true, commit, written: todo.map((d) => d.id),
    lines: [`Approved ${todo.map((d) => d.id).join(", ")} as ${name}${commit ? ` (notes commit ${commit.slice(0, 7)})` : ""}.`,
      ...(skipped.length ? [`Already approved, left alone: ${skipped.map((s) => s.id).join(", ")}.`] : [])],
  });
}

/* ------------------------------------------------------------------ reopen */

export function reopenSpec(ctx: Ctx, id: string): Result {
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const g = decide(ctx, [`spec.edit.${doc.layer}`], "Reopening a specification", "spec reopen", [id], { id });
  if (g.kind !== "allow") return refusal(g);
  if (doc.layer === "requirement") return result({ ok: false, reasons: [`\`${id}\` is a requirement file; it is always approved and has no records to reopen.`] });
  const eff = computeStatus(head, doc, new StatusCtx(ctx.root, head));
  if (eff.status === "awaiting-review") {
    auditAll(ctx, { command: "spec reopen", args: [id], permission: `spec.edit.${doc.layer}`, outcome: "done", reason: "already awaiting review" });
    return result({ ok: true, lines: [`\`${id}\` is already awaiting review. Nothing changed.`] });
  }
  const name = humanName(ctx);
  if (!name) return result({ ok: false, reasons: ["Cannot tell who is reopening: set git `user.name`."] });
  const commit = writeRecords(ctx, [makeRecord("reopen", id, specFingerprint(doc.text)!, { by: { human: name }, date: today(ctx) }, ctx.now)]);
  auditAll(ctx, { command: "spec reopen", args: [id], permission: `spec.edit.${doc.layer}`, outcome: "done",
    old: { status: eff.status }, new: { status: "awaiting-review", "review-reason": "edited" } });
  return result({ ok: true, commit, written: [id], lines: [`Reopened \`${id}\`: awaiting review (edited).${commit ? ` Notes commit ${commit.slice(0, 7)}.` : ""}`] });
}

/* ----------------------------------------------------------------- metadata */

/** Author-written fields (`file-formats` §2.1); status, approver and results are records and have their own override commands. */
export const SETTABLE = ["title", "authors", "references", "covers", "implements"] as const;

const pieceOf = (field: string) => field;

function parseAuthor(item: string): Record<string, string> {
  const m = /^(human|llm):([^|]+)(?:\|(.+))?$/.exec(item.trim());
  if (!m) throw new Error(`author \`${item}\` must look like human:<name> or llm:<model id>, optionally |<contribution>`);
  const out: Record<string, string> = { [m[1]]: m[2].trim() };
  if (m[3]) out.contribution = m[3].trim();
  return out;
}

function parseValue(ctx: Ctx, field: string, raw: string): unknown {
  switch (field) {
    case "title":
      if (!raw.trim() || /[\r\n]/.test(raw)) throw new Error("title must be a non-empty single line");
      return raw.trim();
    case "authors": return raw.trim() === "" ? [] : raw.split(",").map(parseAuthor);
    case "references":
    case "implements":
    case "covers": {
      const items = raw.trim() === "" ? [] : raw.split(",").map((s) => s.trim());
      for (const c of items) if (!parseCite(c)) throw new Error(`\`${c}\` is not a valid cite`);
      return items;
    }
    default: throw new Error(`\`${field}\` cannot be set here. Settable fields: ${SETTABLE.join(", ")}.`);
  }
}

export function metaSet(ctx: Ctx, id: string, field: string, raw: string, opts: { noCommit?: boolean } = {}): Result {
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const settable = (SETTABLE as readonly string[]).includes(field);
  const needs: (string | string[])[] = [settable ? [`meta.write.${pieceOf(field)}`, "meta.write"] : "meta.write"];
  const g = decide(ctx, needs, `Changing \`${field}\``, "spec meta set", [id, field], { id, field, value: raw });
  if (g.kind !== "allow") return refusal(g);
  let value: unknown;
  try { value = parseValue(ctx, field, raw); } catch (e) {
    auditAll(ctx, { command: "spec meta set", args: [id, field], permission: g.permissions[0], outcome: "failed", reason: (e as Error).message });
    return result({ ok: false, reasons: [(e as Error).message] });
  }
  // The worktree file is what is edited; its current values are the old values.
  const work = findDoc(loadProject(worktreeSource(ctx.root), head.paths), id) ?? doc;
  const data = work.fm.data ?? {};
  const old: unknown = data[field] ?? null;
  const edits: Record<string, unknown> = { [field]: value };
  const { commit, notes } = writeAndCommit(g.token, ctx, [{ doc, edits }], "spec", `set ${field} of ${id}`, "", !!opts.noCommit);
  auditAll(ctx, { command: "spec meta set", args: [id, field], permission: g.permissions[0], outcome: "done", old: { [field]: old }, new: { [field]: value } });
  const lines = [`Set \`${field}\` of \`${id}\`.${commit ? ` Commit ${commit.slice(0, 7)}.` : ""}`, ...notes];
  return result({ ok: true, commit, written: [id], lines });
}


/** Current metadata of a spec, with overrides marked (`cli R17`). */
export function metaGet(ctx: Ctx, id: string): Result & { data?: Record<string, unknown> } {
  const g = decide(ctx, ["meta.read"], "Reading metadata", "spec meta get", [id], { id });
  if (g.kind !== "allow") return refusal(g);
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const d = doc.fm.data ?? {};
  const sctx = new StatusCtx(ctx.root, head);
  const st = computeStatus(head, doc, sctx);
  const dec = sctx.decisiveOf(doc);
  const mark = (r: NoteRecord | undefined) => (r?.kind === "override" ? ` [override by ${JSON.stringify(r.by)} on ${r.date}]` : "");
  const lines = [
    `id: ${doc.id}`, `title: ${d.title}`,
    `status: ${st.status}${st.reasons.length ? ` reasons: ${st.reasons.join("; ")}` : ""}${mark(dec?.rec)}`,
    `authors: ${JSON.stringify(d.authors ?? [])}`, `covers: ${JSON.stringify(d.covers ?? [])}`,
  ];
  if (d.implements !== undefined) lines.push(`implements: ${JSON.stringify(d.implements)}`);
  lines.push(`references: ${JSON.stringify(d.references ?? [])}`);
  // Approver and date come from the newest approval or approver override that applies (`file-formats` §2.3, §2.4).
  const applying = sctx.notes.lookup(specSubject(sctx, doc)).applicable;
  const approval = applying.filter((x) => x.rec.kind === "approval" || (x.rec.kind === "override" && x.rec.target === "status" && x.rec.value === "approved")).at(-1);
  const approverOverride = applying.filter((x) => x.rec.kind === "override" && x.rec.target === "approver").at(-1);
  const commitOverride = applying.filter((x) => x.rec.kind === "override" && x.rec.target === "approval-commit").at(-1);
  if (approval) {
    lines.push(`approver: ${JSON.stringify(approverOverride?.rec.value ?? approval.rec.by)}${mark(approverOverride?.rec)}`, `approval.date: ${approval.rec.date}`,
      `approval.commit: ${commitOverride?.rec.value ?? approval.commit}${mark(commitOverride?.rec)}`);
  }
  for (const [test, r] of currentResults(sctx, doc)) if (r.outcome !== "cleared") lines.push(`result ${test}: ${r.outcome}${isMap(r.override) ? ` [override by ${JSON.stringify(r.override.by)} on ${r.override.date}]` : ""}`);
  auditAll(ctx, { command: "spec meta get", args: [id], permission: "meta.read", outcome: "done" });
  return { ...result({ ok: true, lines }), data: { id: doc.id, stored: d, effective: st } };
}

/* ---------------------------------------------------------------- overrides */

export type OverrideKind = "status" | "approver" | "approval-commit" | "test";

function parseApprover(raw: string): Record<string, string> {
  const m = /^(human|llm):([^@]+)(?:@(.+))?$/.exec(raw.trim());
  if (!m) throw new Error("approver must look like human:<name> or llm:<model id>@<human who delegated>");
  if (m[1] === "human") {
    if (m[3]) throw new Error("a human approver has no delegated-by");
    return { human: m[2].trim() };
  }
  if (!m[3]) throw new Error("an LLM approver needs the human who delegated it: llm:<model id>@<human>");
  return { llm: m[2].trim(), "delegated-by": m[3].trim() };
}

export function overrideSpec(ctx: Ctx, kind: OverrideKind, id: string, args: string[], opts: { summary?: string } = {}): Result {
  const perm = `override.${kind}`;
  const cmd = `spec override ${kind}`;
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const g = decide(ctx, [perm], `Overriding the ${kind}`, cmd, [id, ...args], { kind, id, args });
  if (g.kind !== "allow") return refusal(g);
  const name = humanName(ctx);
  if (!name) return result({ ok: false, reasons: ["Cannot tell who is making the override: set git `user.name`."] });
  const fail = (m: string) => { auditAll(ctx, { command: cmd, args: [id, ...args], permission: perm, outcome: "failed", reason: m }); return result({ ok: false, reasons: [m] }); };
  const mark = { by: { human: name }, date: today(ctx) };
  if (doc.layer === "requirement") return fail(`\`${id}\` is a requirement file; it is always approved and has no records to override.`);
  const sctx = new StatusCtx(ctx.root, head);
  const before = kind === "test" || kind === "approval-commit" ? null : computeStatus(head, doc, sctx);
  let record: NoteRecord | null = null;
  let old: unknown, nw: unknown;

  if (kind === "status") {
    const value = args[0];
    if (value !== "approved" && value !== "awaiting-review") return fail("status must be `approved` or `awaiting-review`");
    if (value === "approved") {
      if (isDirty(ctx.root, doc.file)) return fail(`\`${id}\` has uncommitted changes. Commit ${doc.file} first; the override records the committed content.`);
      // An override to approved is checked like an approval: it carries the fingerprints of the content now (`file-formats` §2.4).
      const { fingerprint, cited } = fingerprintsOf(head, doc);
      record = makeRecord("override", id, fingerprint, { ...mark, target: "status", value, cited }, ctx.now);
    } else record = makeRecord("override", id, specFingerprint(doc.text)!, { ...mark, target: "status", value }, ctx.now);
    old = { status: before!.status, reasons: before!.reasons };
    nw = { status: value, override: mark };
  } else if (kind === "approver") {
    const by = (() => { try { return parseApprover(args[0] ?? ""); } catch (e) { return (e as Error).message; } })();
    if (typeof by === "string") return fail(by);
    const approving = sctx.notes.lookup(specSubject(sctx, doc)).applicable.filter((x) => x.rec.kind === "approval" || (x.rec.kind === "override" && x.rec.value === "approved")).at(-1);
    if (!approving) return fail(`\`${id}\` has no applicable approval, so there is no approver to override.`);
    record = makeRecord("override", id, specFingerprint(doc.text)!, { ...mark, target: "approver", value: by }, ctx.now);
    old = { by: approving.rec.by }; nw = { by, override: mark };
  } else if (kind === "approval-commit") {
    const target = args[0] ?? "";
    if (!/^[0-9a-f]{7,40}$/i.test(target) || !commitExists(ctx.root, target)) return fail(`\`${target}\` is not a commit in this repository`);
    const approving = sctx.notes.lookup(specSubject(sctx, doc)).applicable.filter((x) => isApproving(x)).at(-1);
    if (!approving) return fail(`\`${id}\` has no applicable approval, so there is no approved commit to override.`);
    const full = revCommit(ctx.root, target)!;
    record = makeRecord("override", id, specFingerprint(doc.text)!, { ...mark, target: "approval-commit", value: full }, ctx.now);
    old = { commit: approving.commit }; nw = { commit: full, override: mark };
  } else {
    // A test result is a `test-result` record on HEAD (`file-formats` §11.1); a clear is a record with outcome `cleared`.
    const [testId, outcome] = args;
    if (!testId || !/^.+#(T\d+|0)$/.test(testId)) return fail("test must be a test ID such as `R11#T1` (or `R11#0` for the intelligent judgement)");
    if (!["passed", "failed", "clear"].includes(outcome ?? "")) return fail("result must be `passed`, `failed` or `clear`");
    if (isDirty(ctx.root, doc.file)) return fail(`\`${id}\` has uncommitted changes. Commit ${doc.file} first; a result is recorded against committed content.`);
    const prior = currentResults(sctx, doc).get(testId);
    const cleared = outcome === "clear";
    record = makeRecord("test-result", id, specFingerprint(doc.text)!, {
      test: testId, "test-kind": testId.endsWith("#0") ? "intelligent" : "deterministic", outcome: cleared ? "cleared" : outcome,
      by: { human: name }, date: today(ctx), against: {}, summary: opts.summary ?? (cleared ? "cleared by override" : "set by override"), override: mark,
    }, ctx.now);
    old = { test: testId, outcome: prior?.outcome ?? null }; nw = cleared ? { test: testId, cleared: true, override: mark } : { test: testId, outcome, override: mark };
  }
  const commit = writeRecords(ctx, [record!]);
  auditAll(ctx, { command: cmd, args: [id, ...args], permission: perm, outcome: "done", old, new: nw });
  return result({ ok: true, commit, written: [id], lines: [`Override of ${kind} recorded for \`${id}\` by ${name}.${commit ? ` Notes commit ${commit.slice(0, 7)}.` : ""}`] });
}
