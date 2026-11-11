import { SpecNotFoundError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { implementationState, headContext } from "../spec/implementation.js";
import type { NoteRecord } from "../spec/notes.js";
import type { SpecDoc } from "../spec/project.js";
import { currentResults } from "../spec/results.js";
import { worktreeSource } from "../spec/source.js";
import { computeStatus, specSubject, type StatusCtx } from "../spec/status.js";
import type { CommandResult } from "./runner.js";

/**
 * `specplane spec list` and `spec show <id>` (`architecture/reference-cli` §13.1): effective status with reasons,
 * authors, approver, current test results and implementation, all read from the committed content and the notes
 * store in one pass (§5.2). Both need `info.retrieve`.
 */

export interface SpecView {
  id: string;
  title: string;
  type: string;
  file: string;
  status: string;
  reasons: string[];
  notes: string[];
  authors: string[];
  approver: string | null;
  approval_date: string | null;
  results: { test: string; outcome: string; override: boolean }[];
  /** Architecture specs only. */
  implementation: { status: string; outdated: boolean; by: string | null; date: string | null } | null;
}

/** An author item `{human: name}` or `{llm: model, ...}` as `human:name`. */
function who(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const [k, val] = Object.entries(v as Record<string, unknown>)[0] ?? [];
    if (k !== undefined) return `${k}:${typeof val === "string" ? val : JSON.stringify(val)}`;
  }
  return JSON.stringify(v);
}

function view(ctx: StatusCtx, doc: SpecDoc, working: string | null): SpecView {
  const st = computeStatus(ctx.head, doc, ctx, working);
  const d = (doc.fm.data ?? {}) as Record<string, unknown>;
  const applying = ctx.notes.lookup(specSubject(ctx, doc)).applicable;
  const approval = applying.filter((x) => x.rec.kind === "approval" || (x.rec.kind === "override" && x.rec.target === "status" && x.rec.value === "approved")).at(-1);
  const approver = applying.filter((x) => x.rec.kind === "override" && x.rec.target === "approver").at(-1)?.rec.value ?? approval?.rec.by;
  const results = [...currentResults(ctx, doc).entries()]
    .filter(([, r]) => r.outcome !== "cleared")
    .map(([test, r]: [string, NoteRecord]) => ({ test, outcome: String(r.outcome), override: !!r.override }));
  const impl = doc.layer === "architecture" ? implementationState(ctx, doc) : null;
  return {
    id: doc.id, title: typeof d.title === "string" ? d.title : "", type: doc.layer, file: doc.file,
    status: st.status, reasons: st.reasons, notes: st.notes,
    authors: Array.isArray(d.authors) ? d.authors.map(who) : [],
    approver: approver === undefined ? null : who(approver), approval_date: typeof approval?.rec.date === "string" ? approval.rec.date : null,
    results,
    implementation: impl ? { status: impl.status, outdated: impl.outdated, by: impl.record?.rec.by === undefined ? null : who(impl.record.rec.by), date: typeof impl.record?.rec.date === "string" ? impl.record.rec.date : null } : null,
  };
}

function refused(what: string): CommandResult | null {
  const root = checkoutRoot();
  const g = guard(activePreset(root), cliActor(root), ["info.retrieve"], what);
  return g.kind === "allow" ? null : { ok: false, findings: [g.kind === "deny" ? g.message : `${what} needs approval from the user.`], permission: "info.retrieve" };
}

/** Reasons for one list row: `unapproved-dependency: ...` repeated reasons collapse to a count; `spec show` has them all. */
function briefReasons(reasons: string[]): string {
  const counts = new Map<string, number>();
  for (const r of reasons) { const k = r.split(":")[0]; counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts].map(([k, n]) => (n > 1 ? `${n} ${k}` : reasons.find((r) => r.split(":")[0] === k)!)).join("; ");
}

const implText = (i: NonNullable<SpecView["implementation"]>) => `${i.status}${i.outdated ? " (the spec changed since it was recorded)" : ""}`;

/** `spec list [--status <s>] [--type <t>]`: every feature and architecture spec at HEAD; requirement files have no status and are not listed. */
export function specListCommand(opts: { status?: string; type?: string }): CommandResult {
  const no = refused("Listing specs");
  if (no) return no;
  const root = checkoutRoot();
  const { project, ctx } = headContext(root);
  const src = worktreeSource(root);
  const views = [...project.specs.values()].filter((d) => d.layer !== "requirement").sort((a, b) => a.id.localeCompare(b.id)).map((doc) => view(ctx, doc, src.read(doc.file)))
    .filter((v) => (!opts.status || v.status === opts.status) && (!opts.type || v.type === opts.type));
  const w = Math.max(0, ...views.map((v) => v.id.length));
  const lines = views.map((v) => {
    const parts = [`${v.id.padEnd(w)}  ${v.status}${v.reasons.length ? ` (${briefReasons(v.reasons)})` : ""}`];
    if (v.implementation) parts.push(`implementation: ${implText(v.implementation)}`);
    const failed = v.results.filter((r) => r.outcome === "failed").length;
    if (v.results.length) parts.push(`results: ${v.results.length - failed} passed, ${failed} failed`);
    return parts.join("  ");
  });
  return { ok: true, data: views, lines: lines.length ? lines : ["No specs."], permission: "info.retrieve" };
}

/** `spec show <id>`: one spec in full; a bare slug is accepted when it names exactly one spec. */
export function specShowCommand(id: string): CommandResult {
  const no = refused("Showing a spec");
  if (no) return no;
  const root = checkoutRoot();
  const { project, ctx } = headContext(root);
  const hits = project.specs.has(id) ? [project.specs.get(id)!] : [...project.specs.values()].filter((d) => d.slug === id);
  if (hits.length !== 1) throw new SpecNotFoundError(id);
  const v = view(ctx, hits[0], worktreeSource(root).read(hits[0].file));
  const lines = [
    `${v.id}  ${v.title}`, `file: ${v.file}`,
    `status: ${v.status}${v.reasons.length ? ` (${v.reasons.join("; ")})` : ""}`,
    `authors: ${v.authors.join(", ") || "none"}`,
  ];
  if (v.approver) lines.push(`approved by: ${v.approver}${v.approval_date ? ` on ${v.approval_date}` : ""}`);
  for (const n of v.notes) lines.push(`note: ${n}`);
  for (const r of v.results) lines.push(`result ${r.test}: ${r.outcome}${r.override ? " (override)" : ""}`);
  if (v.implementation) lines.push(`implementation: ${implText(v.implementation)}${v.implementation.by ? ` by ${v.implementation.by}${v.implementation.date ? ` on ${v.implementation.date}` : ""}` : ""}`);
  return { ok: true, data: v, lines, permission: "info.retrieve" };
}
