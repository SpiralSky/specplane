import { loadSettings } from "../config.js";
import { PreconditionError, SpecNotFoundError } from "../errors.js";
import { run } from "../git/exec.js";
import { guard, type Actor, type Preset } from "../perm/permissions.js";
import { specFingerprint } from "../spec/fingerprint.js";
import { appendRecords, byAtRid, KIND_IMPLEMENTATION, makeRecord, type Stored } from "../spec/notes.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, type Project, type SpecDoc } from "../spec/project.js";
import { currentResults, failedTests } from "../spec/results.js";
import { committedSource, headCommit } from "../spec/source.js";
import { specSubject, StatusCtx } from "../spec/status.js";
import type { LogMode } from "./logs.js";
import { runTests, DEFAULT_TIMEOUT_SEC, type TestRunResult } from "./test-run.js";
import { allTests, declarations } from "./tests.js";
import { byOf, recordResults } from "./test-record.js";

/**
 * Implementation status of an architecture spec, kept as `implementation` records in the notes store
 * (`architecture/file-formats` §11.3, §13). No applicable record means unimplemented.
 */

export interface ImplementationState {
  status: "implemented" | "unimplemented";
  /** The applicable record when implemented. */
  record: Stored | null;
  /** Records exist for another content of the spec, so the earlier evidence no longer applies. */
  outdated: boolean;
}

export function implementationState(ctx: StatusCtx, doc: SpecDoc): ImplementationState {
  if (doc.layer !== "architecture") return { status: "unimplemented", record: null, outdated: false };
  const { applicable, other } = ctx.notes.lookup(specSubject(ctx, doc), KIND_IMPLEMENTATION);
  const record = applicable.sort(byAtRid).at(-1) ?? null;
  return { status: record ? "implemented" : "unimplemented", record, outdated: !record && other.length > 0 };
}

/** The committed project at HEAD with a status context, for commands that read notes. */
export function headContext(root: string): { project: Project; ctx: StatusCtx } {
  const project = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
  return { project, ctx: new StatusCtx(root, project) };
}

/** A spec by full ID or by a slug that names exactly one spec. */
export function findSpecId(ids: string[], arg: string): string {
  const hits = ids.includes(arg) ? [arg] : ids.filter((i) => i.slice(i.indexOf("/") + 1) === arg);
  if (hits.length !== 1) throw new SpecNotFoundError(arg);
  return hits[0];
}

export interface ImplementCtx {
  root: string;
  actor: Actor;
  preset: Preset;
  now?: Date;
  timeoutSec?: number;
  /** Test hook: environment variables added to the clean test environment. */
  extraEnv?: Record<string, string>;
}

export interface ImplementReport {
  id: string;
  commit: string;
  /** The working tree differs from HEAD, so the committed content was checked (`verification R36.2`). */
  dirty: boolean;
  /** An applicable implementation record exists now. */
  implemented: boolean;
  /** This call appended the record. */
  changed: boolean;
  results: TestRunResult[];
  /** Tests whose latest current result is `failed`. */
  failed: string[];
  /** Deterministic tests with no current `passed` result (not runnable and never recorded). */
  missing: string[];
  /** Intelligent verdicts (`<section id>#0`) with no current result: they come only from a harness. */
  needsHarness: string[];
  warnings: string[];
}

/**
 * `specplane spec implement <id>` (`architecture/reference-cli` §10.4): run every deterministic test at HEAD, record
 * the results, and append an `implementation` record only when every test and every section that needs an
 * intelligent verdict has a current `passed`. A current `failed` refuses. Refusals before any test runs (not an
 * architecture spec, no `test.record` allow, an LLM while `architecture.llm_may_mark_implemented` is off) throw.
 */
export async function implementSpec(ctx: ImplementCtx, specArg: string): Promise<ImplementReport> {
  const commit = headCommit(ctx.root);
  if (!commit) throw new PreconditionError(["The repository has no commits; the checks run on the committed content at HEAD."]);
  const { project } = headContext(ctx.root);
  const doc = project.specs.get(findSpecId([...project.specs.keys()], specArg))!;
  if (doc.layer !== "architecture") throw new PreconditionError([`\`${doc.id}\` is not an architecture spec; only architecture specs have an implementation status.`]);
  const g = guard(ctx.preset, ctx.actor, ["test.record"], "Marking a specification implemented");
  if (g.kind === "deny") throw new PreconditionError([g.message]);
  if (g.kind === "request") throw new PreconditionError([`Marking a specification implemented needs the \`test.record\` permission set to allow for the ${ctx.actor.role} role; it is set to request user.`]);
  const settings = loadSettings(ctx.root).config;
  if (ctx.actor.kind === "llm" && settings.values["architecture.llm_may_mark_implemented"] !== true) {
    throw new PreconditionError(["An LLM may not mark a specification implemented: `architecture.llm_may_mark_implemented` is off."]);
  }
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ctx.root }).trim() !== "";
  const report = await runTests({
    root: ctx.root, project, selection: { spec: doc.id }, timeoutSec: ctx.timeoutSec ?? DEFAULT_TIMEOUT_SEC, commit,
    logMode: settings.values["tests.logs"] as LogMode, gitLogDir: settings.abs.testLogs, actor: `${ctx.actor.kind}:${ctx.actor.name}`,
    ...(ctx.extraEnv ? { extraEnv: ctx.extraEnv } : {}),
  });
  const out: ImplementReport = { id: doc.id, commit, dirty, implemented: false, changed: false, results: report.results, failed: [], missing: [], needsHarness: [], warnings: [...report.warnings] };
  const ran = report.results.filter((r): r is TestRunResult & { outcome: "passed" | "failed" } => r.kind === "deterministic" && (r.outcome === "passed" || r.outcome === "failed"));
  const rec = recordResults({ root: ctx.root, actor: ctx.actor, preset: ctx.preset, now: ctx.now }, commit, ran);
  out.warnings.push(...rec.warnings);

  // Read the store again: the results just recorded, earlier results of harness runs and overrides, all by content.
  const fresh = headContext(ctx.root);
  if (headCommit(ctx.root) !== commit) throw new PreconditionError(["HEAD changed while checks ran; nothing was marked implemented. Run the checks again."]);
  const currentDoc = fresh.project.specs.get(doc.id)!;
  const current = currentResults(fresh.ctx, currentDoc);
  out.failed = failedTests(fresh.ctx, currentDoc);
  const decl = declarations(doc);
  const required = allTests(decl).filter((t) => t.kind === "deterministic").map((t) => t.id);
  for (const id of required) {
    if (!ran.some((r) => r.test === id)) { out.missing.push(id); continue; }
    const r = current.get(id);
    if (r?.outcome === "failed") continue;
    else if (r?.outcome !== "passed") out.missing.push(id);
  }
  for (const s of decl.sections) {
    if (!s.needsVerdict) continue;
    const r = current.get(s.verdictId);
    if (r?.outcome === "failed") continue;
    else if (r?.outcome !== "passed") out.needsHarness.push(s.verdictId);
  }
  if (out.failed.length || out.missing.length || out.needsHarness.length) return out;
  const state = implementationState(fresh.ctx, fresh.project.specs.get(doc.id)!);
  if (state.status !== "implemented") {
    const at = ctx.now ?? new Date();
    appendRecords(ctx.root, commit, [makeRecord("implementation", doc.id, specFingerprint(doc.text)!, { status: "implemented", by: byOf(ctx.actor), date: at.toISOString().slice(0, 10) }, at)]);
    out.changed = true;
  }
  out.implemented = true;
  return out;
}
