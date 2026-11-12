import { PreconditionError } from "../errors.js";
import { allTests, declarations } from "./tests.js";
import { guard, type Actor, type Preset } from "../perm/permissions.js";
import { holdRequest } from "../requests/hold.js";
import { parseCite } from "../spec/cites.js";
import { specFingerprint } from "../spec/fingerprint.js";
import { appendRecords, makeRecord } from "../spec/notes.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveCite, type Project, type SpecDoc, findDoc, projectOf } from "../spec/project.js";
import { committedSource, headCommit } from "../spec/source.js";
import { looksLikeCredential } from "./credentials.js";

/**
 * Recording test results, the `tests.record` core function (`architecture/reference-cli` §10.3,
 * `verification R61.1` to `R61.3`). A result is a `test-result` record on the tested commit; the guard decides
 * whether it is written (`allow`), held as a request (`request-user`) or only shown (`deny`).
 */

/** A result that can be recorded: `not-run` is never recorded. */
export interface RecordableResult {
  test: string;
  spec: string;
  kind: "deterministic" | "intelligent";
  outcome: "passed" | "failed";
  summary: string;
  log?: string;
}

export interface RecordCtx { root: string; actor: Actor; preset: Preset; now?: Date }

export interface RecordReport {
  /** Test IDs written to the notes store. */
  recorded: string[];
  /** Test IDs held as requests, with the request ID. */
  held: { test: string; request: string }[];
  /** Why nothing was recorded (`deny`), or null. */
  notRecorded: string | null;
  warnings: string[];
}

/** `by` of a record: the person, or the model that ran it. */
export function byOf(actor: Actor): Record<string, unknown> {
  return actor.kind === "llm" ? { llm: actor.model ?? actor.name } : { human: actor.name };
}

/** Fingerprints of the specs a spec covers or implements: what a result is checked against (`file-formats` §11.1). */
export function againstOf(project: Project, doc: SpecDoc): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["covers", "implements"]) {
    const v = doc.fm.data?.[key];
    if (!Array.isArray(v)) continue;
    for (const raw of v) {
      const cite = typeof raw === "string" ? parseCite(raw) : null;
      const res = cite ? resolveCite(projectOf(project, doc), cite) : null;
      const id = res && res.ok ? res.target.specId : undefined;
      const other = id && id !== doc.id ? findDoc(project, id) : undefined;
      if (other) out[other.id] = specFingerprint(other.text)!;
    }
  }
  return out;
}

/** Reject malformed evidence before writing any records or requests. */
export function validateResult(project: Project, r: RecordableResult): void {
  const doc = findDoc(project, r.spec);
  if (!doc) throw new PreconditionError([`Unknown specification: ${r.spec}`]);
  if (!["passed", "failed"].includes(r.outcome) || !["deterministic", "intelligent"].includes(r.kind) || typeof r.summary !== "string" || !r.summary.trim()) {
    throw new PreconditionError(["A test result needs a valid kind, passed/failed outcome and non-empty summary."]);
  }
  const decl = declarations(doc);
  const declared = allTests(decl).some((t) => t.id === r.test && t.kind === r.kind && !t.duplicate);
  const verdict = r.kind === "intelligent" && decl.sections.some((sec) => sec.needsVerdict && sec.verdictId === r.test);
  if (!declared && !verdict) throw new PreconditionError([`${r.test}: no matching ${r.kind} test or verdict declared in ${r.spec}.`]);
}

const credentialWarning = (r: { test: string; summary: string }): string => `the summary of ${r.test} looks like it holds a credential; check it and keep private information out of summaries`;

/**
 * Record results of `commit` (the tested commit). Fingerprints are computed from the committed content at that
 * commit. A summary that looks like a credential gives a warning but is recorded (`§10.3`).
 */
export function recordResults(ctx: RecordCtx, commit: string, results: RecordableResult[]): RecordReport {
  const report: RecordReport = { recorded: [], held: [], notRecorded: null, warnings: [] };
  if (!results.length) return report;
  const g = guard(ctx.preset, ctx.actor, ["test.record"], "Recording a test result");
  if (g.kind === "deny") { report.notRecorded = g.message; return report; }
  const project = loadProject(committedSource(ctx.root, commit), loadSpecPaths(ctx.root).paths);
  for (const r of results) {
    validateResult(project, r);
    if (r.kind === "intelligent" && ctx.actor.kind !== "llm") throw new PreconditionError(["Intelligent judgement must be recorded by an LLM in a harness."]);
  }
  const now = ctx.now ?? new Date();
  const records = [];
  for (const r of results) {
    const doc = findDoc(project, r.spec);
    if (!doc) { report.warnings.push(`${r.test}: specification \`${r.spec}\` is not in commit ${commit.slice(0, 8)}; not recorded`); continue; }
    if (looksLikeCredential(r.summary)) report.warnings.push(credentialWarning(r));
    const fingerprint = specFingerprint(doc.text)!;
    const against = againstOf(project, doc);
    if (g.kind === "request") {
      const request = holdRequest({
        root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission, command: "test record", now: ctx.now,
        params: { spec: r.spec, test: r.test, kind: r.kind, outcome: r.outcome, summary: r.summary, commit, fingerprint, against, by: byOf(ctx.actor), ...(r.log ? { log: r.log } : {}) },
        reason: `Recording the result of ${r.test} (${r.outcome}) needs approval (\`test record ${r.test}\`).`,
      });
      report.held.push({ test: r.test, request: request.id });
      continue;
    }
    records.push(makeRecord("test-result", r.spec, fingerprint, {
      test: r.test, "test-kind": r.kind, outcome: r.outcome, by: byOf(ctx.actor), date: now.toISOString().slice(0, 10), against, summary: r.summary, ...(r.log ? { log: r.log } : {}),
    }, now));
    report.recorded.push(r.test);
  }
  if (records.length) appendRecords(ctx.root, commit, records);
  return report;
}

export interface AcceptCtx { root: string; actor: Actor; now?: Date }
export interface AcceptOutcome { ok: boolean; lines: string[]; reasons: string[] }

/**
 * What accepting a `test record` request does (`§10.3`, `verification R61.2`): the record is written on the tested HEAD only if
 * the fingerprints of the spec and of every spec it was checked against still equal the ones in the request;
 * otherwise nothing is recorded and the reasons say why.
 */
export function recordFromRequest(ctx: AcceptCtx, p: Record<string, any>): AcceptOutcome {
  const head = headCommit(ctx.root);
  if (!head) return { ok: false, lines: [], reasons: ["The repository has no commits; nothing was recorded."] };
  if (head !== p.commit) return { ok: false, lines: [], reasons: [`HEAD changed since the test ran on ${String(p.commit).slice(0, 8)}; nothing was recorded.`] };
  const project = loadProject(committedSource(ctx.root, "HEAD"), loadSpecPaths(ctx.root).paths);
  validateResult(project, p as RecordableResult);
  if (p.kind === "intelligent" && (typeof p.by?.llm !== "string" || !p.by.llm.trim())) return { ok: false, lines: [], reasons: ["Intelligent judgement needs the originating LLM; nothing was recorded."] };
  const doc = findDoc(project, p.spec);
  if (!doc) return { ok: false, lines: [], reasons: [`Specification \`${p.spec}\` no longer exists; nothing was recorded.`] };
  const stale: string[] = [];
  if (specFingerprint(doc.text) !== p.fingerprint) stale.push(doc.id);
  const now = againstOf(project, doc);
  const ids = new Set([...Object.keys(p.against ?? {}), ...Object.keys(now)]);
  for (const id of ids) if ((p.against ?? {})[id] !== now[id]) stale.push(id);
  if (stale.length) return { ok: false, lines: [], reasons: [`${[...new Set(stale)].join(", ")} changed since the test ran on ${String(p.commit).slice(0, 8)}; nothing was recorded.`] };
  const at = ctx.now ?? new Date();
  appendRecords(ctx.root, head, [makeRecord("test-result", p.spec, p.fingerprint, {
    test: p.test, "test-kind": p.kind, outcome: p.outcome, by: p.by ?? byOf(ctx.actor), date: at.toISOString().slice(0, 10), against: p.against ?? {}, summary: p.summary, ...(p.log ? { log: p.log } : {}),
  }, at)]);
  return { ok: true, lines: [`Recorded ${p.test}: ${p.outcome}.`, ...(looksLikeCredential(String(p.summary)) ? [`warning: ${credentialWarning({ test: p.test, summary: p.summary })}`] : [])], reasons: [] };
}
