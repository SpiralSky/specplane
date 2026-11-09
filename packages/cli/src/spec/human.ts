import * as fs from "node:fs";
import * as path from "node:path";
import { audit, type AuditEntry } from "../audit/log.js";
import { GitError } from "../errors.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { Authorized, guard, gitUserName, type Actor, type GuardResult, type Preset } from "../perm/permissions.js";
import { parseCite } from "./cites.js";
import { editKeys } from "./fm-edit.js";
import { specFingerprint } from "./fingerprint.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, resolveCite, targetFingerprint, type Project, type SpecDoc } from "./project.js";
import { failedTests } from "./results.js";
import { commitExists, committedSource, headCommit, worktreeSource } from "./source.js";
import { CommitProjects, computeStatus, dependencyCites } from "./status.js";

/**
 * Human approval, reopen, metadata and override commands (`architecture/reference-cli` §5.3, §5.4, §13.2, §13.4;
 * `feature/cli` R16, R17). Every mutating function takes an `Authorized` token from the guard.
 */

export interface Ctx {
  root: string;
  actor: Actor;
  preset: Preset;
  now?: Date;
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
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const today = (ctx: Ctx) => (ctx.now ?? new Date()).toISOString().slice(0, 10);
const git = (root: string, args: string[]) => run("git", args, { cwd: root });

function result(partial: Partial<Result> & { ok: boolean }): Result {
  return { lines: [], reasons: [], commit: null, warnings: [], written: [], ...partial };
}

function loadHead(root: string): Project {
  if (!headCommit(root)) throw new GitError("git rev-parse HEAD", "the repository has no commits");
  return loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
}

function auditAll(ctx: Ctx, base: Omit<AuditEntry, "actor">, extra: Partial<AuditEntry> = {}): void {
  audit(ctx.root, { ...base, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name }, ...extra }, ctx.now);
}

/** Run the guard and audit a refusal. */
function decide(ctx: Ctx, needs: (string | string[])[], describe: string, command: string, args: string[]): GuardResult {
  const g = guard(ctx.preset, ctx.actor, needs, describe);
  if (g.kind !== "allow") {
    auditAll(ctx, { command, args, permission: g.permission, outcome: "refused", reason: g.message });
  }
  return g;
}

const refusal = (g: Exclude<GuardResult, { kind: "allow" }>): Result => result({ ok: false, reasons: [g.message] });

/** Identity of the person running the command: git `user.name`; never invented (`cli R16`). */
function humanName(ctx: Ctx): string | null {
  return ctx.actor.kind === "human" ? gitUserName(ctx.root) ?? (ctx.actor.name || null) : null;
}

function isDirty(root: string, file: string): boolean {
  return git(root, ["status", "--porcelain", "--", file]).trim() !== "";
}

/** Last commit that changed the content to its current fingerprint (`reference-cli` §5.3 step 5). */
function contentCommit(root: string, doc: SpecDoc): string | null {
  const fp = specFingerprint(doc.text);
  const hashes = git(root, ["log", "--format=%H", "--", doc.file]).split("\n").filter(Boolean);
  let found: string | null = null;
  for (const h of hashes) {
    let text: string;
    try { text = git(root, ["show", `${h}:${doc.file}`]); } catch { break; }
    if (specFingerprint(text) === fp) found = h; else break;
  }
  return found;
}

/** Tarjan strongly connected components over resolved spec-to-spec dependencies. */
function components(head: Project): Map<string, string[]> {
  const edges = new Map<string, string[]>();
  for (const doc of head.specs.values()) {
    const out = new Set<string>();
    for (const raw of dependencyCites(doc.fm.data)) {
      const cite = parseCite(raw);
      if (!cite) continue;
      const res = resolveCite(head, cite);
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
    const res = resolveCite(head, cite);
    if (res.ok) cited[raw] = targetFingerprint(res.target);
  }
  return { fingerprint: specFingerprint(doc.text)!, cited };
}

function approvalBlock(ctx: Ctx, head: Project, doc: SpecDoc, name: string, override = false): Record<string, unknown> {
  const { fingerprint, cited } = fingerprintsOf(head, doc);
  const block: Record<string, unknown> = {
    by: { human: name }, date: today(ctx), commit: contentCommit(ctx.root, doc), fingerprint, cited,
  };
  if (override) block.override = { by: { human: name }, date: today(ctx) };
  return block;
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
  return head.specs.get(id) ?? null;
}

const notFound = (id: string, head: Project) =>
  `Specification \`${id}\` not found. Known IDs: ${[...head.specs.keys()].sort().join(", ") || "(none)"}.`;

/* ------------------------------------------------------------------ approve */

export interface ApproveOptions {
  /** Confirms a group in advance (`--yes`). */
  yes?: boolean;
  noCommit?: boolean;
  /** Whether a person can be asked. */
  interactive?: boolean;
  ask?: (members: string[]) => Promise<boolean>;
}

export async function approveSpecs(ctx: Ctx, ids: string[], opts: ApproveOptions = {}): Promise<Result> {
  const g = decide(ctx, ["spec.approve"], "Approving specifications", "spec approve", ids);
  if (g.kind !== "allow") return refusal(g);
  const name = humanName(ctx);
  const head = loadHead(ctx.root);
  const reasons: string[] = [];
  if (!name) reasons.push("Cannot tell who is approving: set git `user.name`. The approver is never invented.");

  const named: SpecDoc[] = [];
  for (const id of ids) {
    const doc = findSpec(head, id);
    if (doc) named.push(doc); else reasons.push(notFound(id, head));
  }
  const comp = components(head);
  const memberIds = new Set<string>();
  for (const d of named) for (const m of comp.get(d.id) ?? [d.id]) memberIds.add(m);
  const members = [...memberIds].sort().map((m) => head.specs.get(m)!);

  const commits = new CommitProjects(ctx.root, head);
  const effective = new Map<string, ReturnType<typeof computeStatus>>();
  for (const doc of members) {
    if (!doc.fm.data) { reasons.push(`\`${doc.id}\` has unreadable frontmatter: ${doc.fm.error}`); continue; }
    if (isDirty(ctx.root, doc.file)) reasons.push(`\`${doc.id}\` has uncommitted changes. Commit ${doc.file} first; approval applies to committed content.`);
    effective.set(doc.id, computeStatus(head, doc, commits));
    for (const raw of dependencyCites(doc.fm.data)) {
      const cite = parseCite(raw);
      if (!cite) continue;
      const res = resolveCite(head, cite);
      if (!res.ok) {
        if (res.code !== "later-release") reasons.push(`\`${doc.id}\` references \`${raw}\`, which does not exist: ${res.reason}.`);
        continue;
      }
      const dep = res.target.specId;
      if (dep && dep !== doc.id && !memberIds.has(dep)) {
        const depDoc = head.specs.get(dep)!;
        const st = computeStatus(head, depDoc, commits);
        if (st.status !== "approved") reasons.push(`\`${doc.id}\` references \`${dep}\` (via \`${raw}\`), which is ${st.status}${st.reasons.length ? ` (${st.reasons.join("; ")})` : ""}. Approve \`${dep}\` first.`);
      }
    }
    const failed = failedTests(doc, head);
    if (failed.length) reasons.push(`\`${doc.id}\` has a failed test result (${failed.join(", ")}) and cannot be approved.`);
  }
  if (reasons.length) {
    for (const id of ids) auditAll(ctx, { command: "spec approve", args: [id], permission: "spec.approve", outcome: "refused", reason: reasons.join(" | ") });
    return result({ ok: false, reasons });
  }

  const todo = members.filter((d) => effective.get(d.id)?.status !== "approved");
  // An approved spec whose approval was written by hand lacks `fingerprint`/`cited`: re-record them (`file-formats` §2.3).
  const rerecord = members.filter((d) => effective.get(d.id)?.status === "approved" && d.fm.data?.status === "approved"
    && isMap(d.fm.data.approval) && (d.fm.data.approval.fingerprint === undefined || d.fm.data.approval.cited === undefined));
  if (todo.length === 0 && rerecord.length === 0) {
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

  const auth = (g as Extract<GuardResult, { kind: "allow" }>).token;
  const ops: WriteOp[] = todo.map((doc) => ({
    doc, edits: { status: "approved", "review-reason": undefined, approval: approvalBlock(ctx, head, doc, name!) },
  }));
  // Re-recording keeps who approved, when, the commit and the note; it only adds the two fields.
  for (const doc of rerecord) {
    ops.push({ doc, edits: { approval: { ...(doc.fm.data!.approval as Record<string, unknown>), ...fingerprintsOf(head, doc) } } });
  }
  const all = [...todo, ...rerecord];
  const body = all.length > 1 ? `Approved together as a group: ${all.map((d) => d.id).join(", ")}.` : "";
  const verb = todo.length === 0 ? "record approval of" : "approve";
  const subject = `${verb} ${all.map((d) => d.id).join(" ")}`;
  const summary = `docs(specs): ${subject}`.length <= 72 ? subject : `${verb} ${all.length} specs`;
  const { commit, notes } = writeAndCommit(auth, ctx, ops, "approve", summary, body || all.map((d) => d.id).join("\n"), !!opts.noCommit);
  for (const doc of todo) {
    auditAll(ctx, { command: "spec approve", args: [doc.id], permission: "spec.approve", outcome: "done",
      old: { status: doc.fm.data?.status ?? null, effective: effective.get(doc.id)?.status }, new: { status: "approved", by: { human: name } } });
  }
  for (const doc of rerecord) {
    auditAll(ctx, { command: "spec approve", args: [doc.id], permission: "spec.approve", outcome: "done", reason: "re-recorded fingerprint and cited",
      old: { status: "approved", fingerprint: null }, new: { status: "approved", fingerprint: "recorded" } });
  }
  const skipped = members.filter((m) => !all.includes(m));
  const cm = commit ? ` (commit ${commit.slice(0, 7)})` : "";
  return result({
    ok: true, commit, written: all.map((d) => d.id),
    lines: [...(todo.length ? [`Approved ${todo.map((d) => d.id).join(", ")} as ${name}${cm}.`] : []),
      ...(rerecord.length ? [`Re-recorded fingerprint and cited parts of ${rerecord.map((d) => d.id).join(", ")}; status and approver unchanged${todo.length ? "" : cm}.`] : []),
      ...(skipped.length ? [`Already approved, left alone: ${skipped.map((s) => s.id).join(", ")}.`] : []), ...notes],
  });
}

/* ------------------------------------------------------------------ reopen */

function reopenEdits(): Record<string, unknown> {
  return { status: "awaiting-review", approval: undefined, "review-reason": "edited" };
}

export function reopenSpec(ctx: Ctx, id: string, opts: { noCommit?: boolean } = {}): Result {
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const g = decide(ctx, [`spec.edit.${doc.layer}`], "Reopening a specification", "spec reopen", [id]);
  if (g.kind !== "allow") return refusal(g);
  const eff = computeStatus(head, doc, new CommitProjects(ctx.root, head));
  if (doc.fm.data?.status !== "approved" && eff.status === "awaiting-review") {
    auditAll(ctx, { command: "spec reopen", args: [id], permission: `spec.edit.${doc.layer}`, outcome: "done", reason: "already awaiting review" });
    return result({ ok: true, lines: [`\`${id}\` is already awaiting review. Nothing changed.`] });
  }
  const { commit, notes } = writeAndCommit(g.token, ctx, [{ doc, edits: reopenEdits() }], "spec", `reopen ${id}`, "", !!opts.noCommit);
  auditAll(ctx, { command: "spec reopen", args: [id], permission: `spec.edit.${doc.layer}`, outcome: "done",
    old: { status: doc.fm.data?.status ?? null }, new: { status: "awaiting-review", "review-reason": "edited" } });
  return result({ ok: true, commit, written: [id], lines: [`Reopened \`${id}\`: awaiting review (edited).${commit ? ` Commit ${commit.slice(0, 7)}.` : ""}`, ...notes] });
}

/* ----------------------------------------------------------------- metadata */

export const SETTABLE = ["title", "authors", "references", "covers", "approval.date", "approval.commit"] as const;

const pieceOf = (field: string) => (field.startsWith("approval.") ? "approval" : field);

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
    case "covers": {
      const items = raw.trim() === "" ? [] : raw.split(",").map((s) => s.trim());
      for (const c of items) if (!parseCite(c)) throw new Error(`\`${c}\` is not a valid cite`);
      return items;
    }
    case "approval.date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("approval.date must be YYYY-MM-DD");
      return raw;
    case "approval.commit":
      if (!/^[0-9a-f]{40}$/.test(raw) || !commitExists(ctx.root, raw)) throw new Error("approval.commit must be the 40-hex hash of a commit in this repository");
      return raw;
    default: throw new Error(`\`${field}\` cannot be set here. Settable fields: ${SETTABLE.join(", ")}.`);
  }
}

export function metaSet(ctx: Ctx, id: string, field: string, raw: string, opts: { noCommit?: boolean } = {}): Result {
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const settable = (SETTABLE as readonly string[]).includes(field);
  const needs: (string | string[])[] = [settable ? [`meta.write.${pieceOf(field)}`, "meta.write"] : "meta.write"];
  const g = decide(ctx, needs, `Changing \`${field}\``, "spec meta set", [id, field]);
  if (g.kind !== "allow") return refusal(g);
  let value: unknown;
  try { value = parseValue(ctx, field, raw); } catch (e) {
    auditAll(ctx, { command: "spec meta set", args: [id, field], permission: g.permissions[0], outcome: "failed", reason: (e as Error).message });
    return result({ ok: false, reasons: [(e as Error).message] });
  }
  // The worktree file is what is edited; its current values are the old values.
  const work = loadProject(worktreeSource(ctx.root), head.paths).specs.get(id) ?? doc;
  const data = work.fm.data ?? {};
  let edits: Record<string, unknown>;
  let old: unknown;
  if (field.startsWith("approval.")) {
    if (!isMap(data.approval)) return result({ ok: false, reasons: [`\`${id}\` has no approval block, so \`${field}\` cannot be set.`] });
    const key = field.slice("approval.".length);
    old = data.approval[key] ?? null;
    edits = { approval: { ...data.approval, [key]: value } };
  } else {
    old = data[field] ?? null;
    edits = { [field]: value };
  }
  const { commit, notes } = writeAndCommit(g.token, ctx, [{ doc, edits }], "spec", `set ${field} of ${id}`, "", !!opts.noCommit);
  auditAll(ctx, { command: "spec meta set", args: [id, field], permission: g.permissions[0], outcome: "done", old: { [field]: old }, new: { [field]: value } });
  const lines = [`Set \`${field}\` of \`${id}\`.${commit ? ` Commit ${commit.slice(0, 7)}.` : ""}`, ...notes];
  return result({ ok: true, commit, written: [id], lines });
}


/** Current metadata of a spec, with overrides marked (`cli R17`). */
export function metaGet(ctx: Ctx, id: string): Result & { data?: Record<string, unknown> } {
  const g = decide(ctx, ["meta.read"], "Reading metadata", "spec meta get", [id]);
  if (g.kind !== "allow") return refusal(g);
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const d = doc.fm.data ?? {};
  const st = computeStatus(head, doc, new CommitProjects(ctx.root, head));
  const ov = (m: unknown) => (isMap(m) && isMap(m.override) ? ` [override by ${JSON.stringify(m.override.by)} on ${m.override.date}]` : "");
  const lines = [
    `id: ${doc.id}`, `title: ${d.title}`,
    `status: ${st.status} (stored: ${d.status})${st.reasons.length ? ` reasons: ${st.reasons.join("; ")}` : ""}${ov(d.approval)}`,
    `authors: ${JSON.stringify(d.authors ?? [])}`, `covers: ${JSON.stringify(d.covers ?? [])}`,
  ];
  if (d.implements !== undefined) lines.push(`implements: ${JSON.stringify(d.implements)}`);
  lines.push(`references: ${JSON.stringify(d.references ?? [])}`);
  if (isMap(d.approval)) {
    const a = d.approval;
    lines.push(`approver: ${JSON.stringify(a.by)}${ov(a)}`, `approval.date: ${a.date}`, `approval.commit: ${a.commit}`);
  }
  if (Array.isArray(d.results)) for (const r of d.results) if (isMap(r)) lines.push(`result ${r.test}: ${r.outcome}${ov(r)}`);
  auditAll(ctx, { command: "spec meta get", args: [id], permission: "meta.read", outcome: "done" });
  return { ...result({ ok: true, lines }), data: { id: doc.id, stored: d, effective: st } };
}

/* ---------------------------------------------------------------- overrides */

export type OverrideKind = "status" | "approver" | "test";

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

export function overrideSpec(ctx: Ctx, kind: OverrideKind, id: string, args: string[], opts: { noCommit?: boolean; summary?: string } = {}): Result {
  const perm = `override.${kind}`;
  const cmd = `spec override ${kind}`;
  const head = loadHead(ctx.root);
  const doc = findSpec(head, id);
  if (!doc) return result({ ok: false, reasons: [notFound(id, head)] });
  const g = decide(ctx, [perm], `Overriding the ${kind}`, cmd, [id, ...args]);
  if (g.kind !== "allow") return refusal(g);
  const name = humanName(ctx);
  if (!name) return result({ ok: false, reasons: ["Cannot tell who is making the override: set git `user.name`."] });
  const fail = (m: string) => { auditAll(ctx, { command: cmd, args: [id, ...args], permission: perm, outcome: "failed", reason: m }); return result({ ok: false, reasons: [m] }); };
  const mark = { by: { human: name }, date: today(ctx) };
  const data = doc.fm.data ?? {};
  let edits: Record<string, unknown>;
  let old: unknown, nw: unknown;

  if (kind === "status") {
    const value = args[0];
    if (value === "approved") {
      if (isDirty(ctx.root, doc.file)) return fail(`\`${id}\` has uncommitted changes. Commit ${doc.file} first; the override records the committed content.`);
      const block = approvalBlock(ctx, head, doc, name, true);
      edits = { status: "approved", "review-reason": undefined, approval: block };
      old = { status: data.status ?? null, approval: data.approval ?? null };
      nw = { status: "approved", override: mark };
    } else if (value === "awaiting-review") {
      edits = reopenEdits();
      old = { status: data.status ?? null };
      nw = { status: "awaiting-review", override: mark };
    } else return fail("status must be `approved` or `awaiting-review`");
  } else if (kind === "approver") {
    let by: Record<string, string>;
    try { by = parseApprover(args[0] ?? ""); } catch (e) { return fail((e as Error).message); }
    if (!isMap(data.approval)) return fail(`\`${id}\` has no approval block, so there is no approver to override.`);
    edits = { approval: { ...data.approval, by, override: mark } };
    old = { by: data.approval.by }; nw = { by, override: mark };
  } else {
    const [testId, outcome] = args;
    if (!testId || !/^.+#\d+$/.test(testId)) return fail("test must be a test ID such as `R11#1`");
    if (!["passed", "failed", "clear"].includes(outcome ?? "")) return fail("result must be `passed`, `failed` or `clear`");
    const results = Array.isArray(data.results) ? data.results : [];
    if (outcome === "clear") {
      edits = { results: results.filter((r) => !(isMap(r) && r.test === testId)) };
      old = { test: testId, results: results.filter((r) => isMap(r) && r.test === testId) }; nw = { test: testId, cleared: true, override: mark };
    } else {
      if (isDirty(ctx.root, doc.file)) return fail(`\`${id}\` has uncommitted changes. Commit ${doc.file} first; a result is recorded against committed content.`);
      const entry = {
        test: testId, kind: Number(testId.split("#")[1]) > 0 ? "deterministic" : "intelligent", outcome, by: { human: name }, date: today(ctx),
        commit: headCommit(ctx.root), fingerprint: specFingerprint(doc.text), against: {}, summary: opts.summary ?? "set by override", override: mark,
      };
      edits = { results: [...results, entry] };
      old = { test: testId }; nw = { test: testId, outcome, override: mark };
    }
  }
  const { commit, notes } = writeAndCommit(g.token, ctx, [{ doc, edits }], "spec", `override ${kind} of ${id}`, "", !!opts.noCommit);
  auditAll(ctx, { command: cmd, args: [id, ...args], permission: perm, outcome: "done", old, new: nw });
  return result({ ok: true, commit, written: [id], lines: [`Override of ${kind} recorded for \`${id}\` by ${name}.${commit ? ` Commit ${commit.slice(0, 7)}.` : ""}`, ...notes] });
}
