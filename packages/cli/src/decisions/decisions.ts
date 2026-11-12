import * as fs from "node:fs";
import * as path from "node:path";
import { audit } from "../audit/log.js";
import { loadSettings } from "../config.js";
import { guard } from "../perm/permissions.js";
import { holdRequest, sentMessage } from "../requests/hold.js";
import { decisionFingerprint } from "../spec/fingerprint.js";
import { splitFrontmatter } from "../spec/frontmatter.js";
import type { Ctx, Result } from "../spec/human.js";
import { appendRecords, isApproving, makeRecord, notesTip, NotesView, type Subject } from "../spec/notes.js";
import { committedSource, headCommit } from "../spec/source.js";

/**
 * User decision records (`feature/later-releases` R37, R37.1; `architecture/file-formats` §14). A record is a file
 * `.specplane/decisions/D<n>.md`: frontmatter `id`, `title`, `date`, optional `concerns` and `authors`, and a body of the
 * sections Decision, Context and optionally Reasons. Its approval is a note on its `decision-v1` content, by ID.
 */

export const DECISIONS_DIR = ".specplane/decisions";
const ID = /^D[1-9][0-9]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY = ["status", "approval", "review-reason", "results", "implementation"];
const SECTIONS = ["Decision", "Context", "Reasons"] as const;

export type DecisionOperation = "add" | "edit" | "delete";
export interface DecisionChange { id: string; before: string | null; after: string | null }
export interface DecisionFields { title?: string; decision?: string; context?: string; reasons?: string; concerns?: string[]; date?: string }
export interface DecisionRecord {
  id: string; title: string; date: string; concerns: string[]; authors: unknown[];
  decision: string; context: string; reasons: string; file: string;
}
export interface DecisionView extends DecisionRecord { status: "approved" | "awaiting-review"; statusReason: string | null }

const result = (r: Partial<Result> & { ok: boolean }): Result => ({ lines: [], reasons: [], commit: null, warnings: [], written: [], ...r });
export const isDecisionId = (id: string): boolean => ID.test(id);
const fileOf = (id: string): string => `${DECISIONS_DIR}/${id}.md`;

export function decisionsEnabled(root: string): boolean {
  return loadSettings(root).config.values["decisions.enabled"] === true;
}
const offMessage = "Decision records are off. Turn them on with `config set decisions.enabled true` (a person does this).";
export function requireEnabled(root: string): void {
  if (!decisionsEnabled(root)) throw new Error(offMessage);
}

/* -------------------------------------------------------------- format */

interface Parsed { fm: Record<string, unknown>; sections: Record<string, string>; extra: string[]; preamble: string }

function splitSections(body: string): { sections: Record<string, string>; extra: string[]; preamble: string } {
  const sections: Record<string, string> = {};
  const extra: string[] = [];
  let current: string | null = null, buf: string[] = [], preamble = "";
  const flush = () => {
    const text = buf.join("\n").trim();
    if (current === null) preamble = text;
    else if ((SECTIONS as readonly string[]).includes(current) && !(current in sections)) sections[current] = text;
    else extra.push(current);
    buf = [];
  };
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) { flush(); current = m[1]; } else buf.push(line);
  }
  flush();
  return { sections, extra, preamble };
}

/** Check the format of one record's text; the reasons are what validation and the write path report. */
export function recordProblems(id: string, text: string): string[] {
  const fm = splitFrontmatter(text);
  if (!fm.data) return [fm.error ?? "no readable frontmatter"];
  const out: string[] = [];
  const d = fm.data;
  for (const k of LEGACY) if (Object.hasOwn(d, k)) out.push(`legacy record key \`${k}\` is not accepted`);
  if (d.id !== id) out.push(`frontmatter id must be \`${id}\``);
  if (typeof d.title !== "string" || !d.title.trim()) out.push("a record needs a title");
  if (typeof d.date !== "string" || !DATE.test(d.date)) out.push("date must be YYYY-MM-DD");
  if (d.concerns !== undefined && !(Array.isArray(d.concerns) && d.concerns.every((c) => typeof c === "string" && c.trim()))) out.push("concerns must be a list of specification or plan IDs or cites");
  if (d.authors !== undefined && !Array.isArray(d.authors)) out.push("authors must be a list");
  const s = splitSections(fm.body);
  for (const name of ["Decision", "Context"]) if (!s.sections[name]) out.push(`the \`## ${name}\` section is missing or empty`);
  for (const name of s.extra) out.push(`unknown or repeated section \`## ${name}\` (a record has Decision, Context and optionally Reasons)`);
  if (s.preamble) out.push("text before the first section is not allowed");
  return out;
}

function parse(id: string, text: string, file = fileOf(id)): DecisionRecord {
  const p = recordProblems(id, text);
  if (p.length) throw new Error(`Decision record \`${id}\` is not valid: ${p.join("; ")}.`);
  const fm = splitFrontmatter(text);
  const d = fm.data!;
  const s = splitSections(fm.body).sections;
  return { id, title: d.title as string, date: d.date as string, concerns: (d.concerns as string[] | undefined) ?? [], authors: (d.authors as unknown[] | undefined) ?? [],
    decision: s.Decision, context: s.Context, reasons: s.Reasons ?? "", file };
}

/** JSON values are valid YAML, so no new serializer is needed (as in `spec/write.ts`). */
export function renderRecord(r: Omit<DecisionRecord, "file">): string {
  const data: Record<string, unknown> = { id: r.id, title: r.title, date: r.date, ...(r.concerns.length ? { concerns: r.concerns } : {}), authors: r.authors };
  const body = [`## Decision\n\n${r.decision.trim()}`, `## Context\n\n${r.context.trim()}`, ...(r.reasons.trim() ? [`## Reasons\n\n${r.reasons.trim()}`] : [])].join("\n\n");
  return `---\n${Object.entries(data).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n${body}\n`;
}

/* -------------------------------------------------------------- reading */

/** Record files in the working tree, by number; an unreadable or misnamed one is reported, never skipped silently. */
export function readRecords(root: string): { records: DecisionRecord[]; problems: { id: string; file: string; reasons: string[] }[] } {
  const dir = path.join(root, DECISIONS_DIR);
  const records: DecisionRecord[] = [], problems: { id: string; file: string; reasons: string[] }[] = [];
  if (!fs.existsSync(dir)) return { records, problems };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -3), file = `${DECISIONS_DIR}/${name}`;
    if (!ID.test(id)) { problems.push({ id, file, reasons: ["file name must be D<number>.md"] }); continue; }
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const reasons = recordProblems(id, text);
    if (reasons.length) problems.push({ id, file, reasons }); else records.push(parse(id, text, file));
  }
  records.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { records, problems };
}

function nextId(root: string): string {
  const dir = path.join(root, DECISIONS_DIR);
  const used = fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => /^D([1-9][0-9]*)\.md$/.exec(n)?.[1]).filter(Boolean).map(Number) : [];
  return `D${Math.max(0, ...used) + 1}`;
}

/** Approval subject of a record, found by `decision-v1` content like a spec's (`file-formats` §13.2). */
function subjectOf(root: string, id: string, text: string | null): Subject {
  return {
    id: `decision/${id}`, paths: [fileOf(id)], fingerprint: text === null ? null : decisionFingerprint(text),
    fingerprintAt(rev) { const t = committedSource(root, rev).read(fileOf(id)); return t === null ? null : decisionFingerprint(t); },
  };
}

/** Effective approval from the committed content and the notes store; uncommitted edits do not count. */
export function decisionStatus(root: string, id: string, notes: NotesView = new NotesView(root)): { status: "approved" | "awaiting-review"; reason: string | null } {
  let committed: string | null = null;
  try { committed = committedSource(root, "HEAD").read(fileOf(id)); } catch { committed = null; }
  if (committed === null) return { status: "awaiting-review", reason: "not committed" };
  const s = subjectOf(root, id, committed);
  const { applicable, other } = notes.lookup(s);
  const decisive = notes.decisive(s);
  if (isApproving(decisive)) return { status: "approved", reason: null };
  return { status: "awaiting-review", reason: applicable.length || other.length ? "edited" : "never-approved" };
}

/** Search by ID, by a description of the topic, or by the spec or plan a record concerns; no filter lists every record. */
export function retrieveDecisions(ctx: Pick<Ctx, "root">, q: { id?: string; query?: string; concerns?: string } = {}): { ok: boolean; reasons: string[]; records: DecisionView[]; problems: { id: string; file: string; reasons: string[] }[] } {
  requireEnabled(ctx.root);
  const { records, problems } = readRecords(ctx.root);
  const notes = new NotesView(ctx.root);
  const view = (r: DecisionRecord): DecisionView => { const s = decisionStatus(ctx.root, r.id, notes); return { ...r, status: s.status, statusReason: s.reason }; };
  if (q.id) {
    const hit = records.find((r) => r.id === q.id);
    return hit ? { ok: true, reasons: [], records: [view(hit)], problems: [] } : { ok: false, reasons: [`Decision record \`${q.id}\` not found.`], records: [], problems: problems.filter((p) => p.id === q.id) };
  }
  let found = records;
  if (q.concerns) found = found.filter((r) => r.concerns.includes(q.concerns!));
  if (q.query) {
    const tokens = q.query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = found.map((r) => {
      const hay = `${r.title}\n${r.concerns.join(" ")}\n${r.decision}\n${r.context}\n${r.reasons}`.toLowerCase();
      return { r, score: tokens.filter((t) => hay.includes(t)).length };
    }).filter((x) => x.score > 0);
    found = scored.sort((a, b) => b.score - a.score || Number(a.r.id.slice(1)) - Number(b.r.id.slice(1))).map((x) => x.r);
  }
  return { ok: true, reasons: [], records: found.map(view), problems };
}

/* -------------------------------------------------------------- writing */

function authorsFor(ctx: Ctx, before: unknown[], contribution: string): unknown[] {
  if (ctx.actor.kind === "llm") {
    if (!loadSettings(ctx.root).config.values["authorship.record_llm"]) return before;
    return [...before, { llm: ctx.actor.model || "unknown", contribution }];
  }
  return before.some((a) => (a as { human?: string })?.human === ctx.actor.name) ? before : [...before, { human: ctx.actor.name }];
}

/** Prepare the exact change once, before a request is stored; the same shape is what accepting a request writes. */
export function prepareDecision(ctx: Ctx, operation: DecisionOperation, input: DecisionFields & { id?: string; contribution?: string }): DecisionChange {
  requireEnabled(ctx.root);
  const today = (ctx.now ?? new Date()).toISOString().slice(0, 10);
  if (operation === "add") {
    for (const k of ["title", "decision", "context"] as const) if (typeof input[k] !== "string" || !input[k]!.trim()) throw new Error(`A decision record needs a \`${k}\`.`);
    const id = nextId(ctx.root);
    const after = renderRecord({ id, title: input.title!.trim(), date: input.date ?? today, concerns: input.concerns ?? [], authors: authorsFor(ctx, [], input.contribution ?? "recorded the user's decision"),
      decision: input.decision!, context: input.context!, reasons: input.reasons ?? "" });
    const problems = recordProblems(id, after);
    if (problems.length) throw new Error(`Decision record is not valid: ${problems.join("; ")}.`);
    return { id, before: null, after };
  }
  const id = input.id ?? "";
  if (!ID.test(id)) throw new Error("A decision record ID looks like D1.");
  const abs = path.join(ctx.root, fileOf(id));
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (before === null) throw new Error(`Decision record \`${id}\` not found.`);
  if (operation === "delete") return { id, before, after: null };
  const fm = splitFrontmatter(before);
  const probs = recordProblems(id, before);
  if (probs.length) throw new Error(`Decision record \`${id}\` is not valid and cannot be edited by field: ${probs.join("; ")}. Edit the file by hand.`);
  const old = parse(id, before);
  const next = {
    id, title: input.title?.trim() || old.title, date: input.date ?? old.date, concerns: input.concerns ?? old.concerns, decision: input.decision ?? old.decision,
    context: input.context ?? old.context, reasons: input.reasons ?? old.reasons,
  };
  const unchanged = next.title === old.title && next.date === old.date && JSON.stringify(next.concerns) === JSON.stringify(old.concerns) && next.decision.trim() === old.decision && next.context.trim() === old.context && next.reasons.trim() === old.reasons;
  if (unchanged) return { id, before, after: before };
  const after = renderRecord({ ...next, authors: authorsFor(ctx, Array.isArray(fm.data?.authors) ? fm.data!.authors as unknown[] : [], input.contribution ?? `edited ${id}`) });
  const problems = recordProblems(id, after);
  if (problems.length) throw new Error(`Decision record is not valid: ${problems.join("; ")}.`);
  return { id, before, after };
}

/** Exact-text preconditions as in `spec/write.ts`; never commits. */
export function writeDecision(ctx: Ctx, operation: DecisionOperation, change: DecisionChange): Result {
  requireEnabled(ctx.root);
  if (!ID.test(change.id)) throw new Error("A decision record ID looks like D1.");
  const permission = `decision.${operation}`;
  const g = guard(ctx.preset, ctx.actor, [permission], `${operation} a decision record`);
  if (g.kind === "deny") return result({ ok: false, reasons: [g.message] });
  const rel = fileOf(change.id), abs = path.join(ctx.root, rel);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (current !== change.before) return result({ ok: false, reasons: ["The decision record changed since this action was prepared; prepare a new change."] });
  if (change.before === change.after) return result({ ok: true, lines: ["No change."] });
  if (g.kind === "request") {
    const rec = holdRequest({ root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission, command: `decision ${operation}`, params: { ...change },
      reason: `${operation} decision record ${change.id}`, diff: unifiedDiff(rel, change.before, change.after), now: ctx.now });
    return result({ ok: true, request: rec.id, lines: [sentMessage(rec)] });
  }
  if (change.after === null) fs.unlinkSync(abs);
  else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, change.after); }
  audit(ctx.root, { command: `decision ${operation}`, args: [change.id], permission, outcome: "done", actor: ctx.actor, request: ctx.request }, ctx.now);
  return result({ ok: true, written: [change.id], lines: [`${operation}: ${change.id}. Written, not committed; approve it with \`approve ${change.id}\` after committing.`] });
}

/** A whole-file diff text for the request pane: a record is short, so every line is shown. */
function unifiedDiff(file: string, before: string | null, after: string | null): string {
  const lines = (t: string | null) => (t ?? "").replace(/\n$/, "").split("\n").filter((_, i, a) => t !== null || a.length > 0);
  return [`--- ${before === null ? "/dev/null" : `a/${file}`}`, `+++ ${after === null ? "/dev/null" : `b/${file}`}`,
    ...(before === null ? [] : lines(before).map((l) => `-${l}`)), ...(after === null ? [] : lines(after).map((l) => `+${l}`))].join("\n");
}

/* -------------------------------------------------------------- approval */

/** Approve records by ID. Only committed content counts, as for specs. The caller has passed the `spec.approve` guard. */
export function approveDecisions(ctx: Ctx, ids: string[], who: { name: string | null; by: Record<string, unknown> }): Result {
  const reasons: string[] = [];
  try { requireEnabled(ctx.root); } catch (e) { return result({ ok: false, reasons: [(e as Error).message] }); }
  if (!who.name) reasons.push("Cannot tell who is approving: set git `user.name`. The approver is never invented.");
  const notes = new NotesView(ctx.root);
  const todo: { id: string; fingerprint: string }[] = [], done: string[] = [];
  for (const id of ids) {
    const abs = path.join(ctx.root, fileOf(id));
    if (!fs.existsSync(abs)) { reasons.push(`Decision record \`${id}\` not found.`); continue; }
    const committed = committedSource(ctx.root, "HEAD").read(fileOf(id));
    if (committed === null) { reasons.push(`\`${id}\` is not committed. Commit ${fileOf(id)} first; approval applies to committed content.`); continue; }
    if (fs.readFileSync(abs, "utf8") !== committed) { reasons.push(`\`${id}\` has uncommitted changes. Commit ${fileOf(id)} first; approval applies to committed content.`); continue; }
    const problems = recordProblems(id, committed);
    if (problems.length) { reasons.push(`\`${id}\` is not valid: ${problems.join("; ")}.`); continue; }
    if (decisionStatus(ctx.root, id, notes).status === "approved") { done.push(id); continue; }
    todo.push({ id, fingerprint: decisionFingerprint(committed)! });
  }
  if (reasons.length) {
    for (const id of ids) audit(ctx.root, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "refused", reason: reasons.join(" | "), request: ctx.request, actor: ctx.actor }, ctx.now);
    return result({ ok: false, reasons });
  }
  if (!todo.length) return result({ ok: true, lines: [`Already approved: ${done.join(", ")}. Nothing changed.`] });
  const date = (ctx.now ?? new Date()).toISOString().slice(0, 10);
  const at = ctx.now ?? new Date();
  appendRecords(ctx.root, headCommit(ctx.root)!, todo.map((t) => makeRecord("approval", `decision/${t.id}`, t.fingerprint, { by: who.by, date, cited: {} }, at)));
  const commit = notesTip(ctx.root);
  for (const t of todo) audit(ctx.root, { command: "spec approve", args: [t.id], permission: "spec.approve", outcome: "done", request: ctx.request, actor: ctx.actor }, ctx.now);
  return result({ ok: true, commit, written: todo.map((t) => t.id), lines: [`Approved ${todo.map((t) => t.id).join(", ")} as ${who.name}${commit ? ` (notes commit ${commit.slice(0, 7)})` : ""}.`, ...(done.length ? [`Already approved, left alone: ${done.join(", ")}.`] : [])] });
}
