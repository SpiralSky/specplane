import { run } from "../git/exec.js";
import { gitUserName } from "../perm/permissions.js";
import { specFingerprint } from "./fingerprint.js";
import { appendRecords, byAtRid, KIND_IMPLEMENTATION, makeRecord, type Stored } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, type Project, type SpecDoc } from "./project.js";
import { failedTests } from "./results.js";
import { committedSource, headCommit } from "./source.js";
import { specSubject, StatusCtx } from "./status.js";

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

export interface ImplementationReceipt { id: string; file: string; fingerprint: string; commit: string; changed: boolean }

/**
 * Record that an architecture spec is implemented, on HEAD. Refuses a spec with uncommitted changes (the record is
 * about committed content) and one with a current failed test result (`file-formats` §11.1).
 */
export function recordImplementation(root: string, id: string, opts: { dryRun?: boolean; now?: Date } = {}): ImplementationReceipt {
  const { project, ctx } = headContext(root);
  const doc = project.specs.get(id.replace(/^[^:/]+:/, ""));
  if (!doc) throw new Error(`Specification \`${id}\` not found. Known IDs: ${[...project.specs.keys()].sort().join(", ") || "(none)"}.`);
  if (doc.layer !== "architecture") throw new Error(`\`${doc.id}\` is not an architecture spec; only architecture specs have implementation records.`);
  if (run("git", ["status", "--porcelain", "--", doc.file], { cwd: root }).trim()) throw new Error(`\`${doc.id}\` has uncommitted changes. Commit ${doc.file} first; the record is about the committed content.`);
  const failed = failedTests(ctx, doc);
  if (failed.length) throw new Error(`\`${doc.id}\` has a failed test result (${failed.join(", ")}) and cannot be marked implemented.`);
  const name = gitUserName(root);
  if (!name) throw new Error("Cannot tell who is recording the implementation: set git `user.name`.");
  const commit = headCommit(root)!;
  const fingerprint = specFingerprint(doc.text)!;
  const changed = implementationState(ctx, doc).status !== "implemented";
  if (changed && !opts.dryRun) {
    const now = opts.now ?? new Date();
    appendRecords(root, commit, [makeRecord("implementation", doc.id, fingerprint, { status: "implemented", by: { human: name }, date: now.toISOString().slice(0, 10) }, now)]);
  }
  return { id: doc.id, file: doc.file, fingerprint, commit, changed };
}
