import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { acquireWriterLease, checkoutIdentity, type WriterLease } from "../core/writer-leases.js";
import { listWorktrees } from "../git/worktree.js";
import { lifecycleContext, refusePendingRetarget } from "./lifecycle-context.js";
import { planReport, targetPlanRecord } from "./activity.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import * as path from "node:path";
import { GitError, PlanStateError } from "../errors.js";
import { writeStatus } from "../frontmatter.js";
import { run } from "../git/exec.js";
import { cliTrailers, formatMessage, readTrailerEntries, type Trailers } from "../git/commit.js";
import type { Config } from "../types.js";
import { parseGaps } from "./gaps.js";
import { listStepFiles, parsePlan, parseStep } from "./parse.js";
import { planDir } from "./resolve.js";
import { assertRecordingPaths, readRecordingSet, validateRecordingSet, type RecordingSet } from "./recording-set.js";
import { planNext } from "./next.js";

export const STEP_OUTCOMES = ["done", "blocked", "skipped"] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

export interface StepDoneOptions {
  outcome: string;
  /** Commit summary (subject text after `<type>(<slug>): `). */
  summary: string;
  /** Conventional Commits type of the step's main change. */
  type?: string;
  /** `<path>:<reason>` entries, in the author's order. */
  changed?: string[];
  deviation?: string[];
  openIssue?: string[];
  /** `spec-gaps.md` IDs (`G3` or `3`) this step added. */
  gap?: string[];
  nextKnows?: string;
  recordingSet?: string;
  step?: number;
  /** Force marking a `blocked` step done, overriding the blocker guard. */
  force?: boolean;
  /** Explicit audit reason required to re-record a completed step. */
  reason?: string;
  /** Extra trailers (`Key: value`), e.g. the harness attribution; written after the Specplane trailers. */
  trailer?: string[];
  /** Date override for tests; defaults to today (local). */
  date?: string;
}

export interface StepDoneResult {
  planId: string;
  step: number;
  outcome: StepOutcome;
  commit: string;
  /** Repository-relative HANDOFF.md path. */
  handoff: string;
}

const COMMIT_TYPES = ["feat", "fix", "docs", "refactor", "test", "build", "ci", "perf", "style", "chore"];
const pad = (n: number): string => String(n).padStart(2, "0");

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `## Step NN:` headings of a HANDOFF.md text, as step numbers in file order. */
export function sectionSteps(text: string): number[] {
  return [...text.matchAll(/^##\s+Step\s+(\d+)\b/gm)].map((m) => Number(m[1]));
}

function bullets(items: string[] | undefined, none = "None."): string {
  return items && items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : none;
}

function refuse(message: string): never {
  throw new PlanStateError(message);
}

/**
 * Append the HANDOFF.md section of a finished step, set the step's status, and make the step
 * commit (`architecture/file-formats` §4.1, §8). Every refusal happens before the first write;
 * a failed commit restores both files. Never pushes.
 */
export function stepDone(planId: string, opts: StepDoneOptions, config: Config, root: string, heldLease?: WriterLease, internalManifest?: RecordingSet): StepDoneResult {
  // This whole operation is synchronous. Suppress optional index refreshes in
  // read-only Git children so even an early refusal preserves the index bytes.
  // Required Git locks (including our real index lock) remain enabled.
  const optionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  process.env.GIT_OPTIONAL_LOCKS = '0';
  try { return recordStep(planId, opts, config, root, heldLease, internalManifest); }
  finally {
    if (optionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = optionalLocks;
  }
}

function recordStep(planId: string, opts: StepDoneOptions, config: Config, root: string, heldLease?: WriterLease, internalManifest?: RecordingSet): StepDoneResult {
  if (internalManifest && !heldLease) refuse("Internal recording manifests require a held writer lease.");
  // Internal embedding transport only; never sourced from operation JSON.
  if (heldLease) {
    heldLease.assertOwned();
    const identity = checkoutIdentity(root);
    for (const [kind, value] of [['repository', identity.commonDir], ['plan', planId], ['checkout', identity.gitDir]]) {
      if (!heldLease.keys.some(key => key.kind === kind && key.identity === value)) refuse(`Recording lease is missing ${kind} ownership.`);
    }
  }
  const lease = heldLease ?? acquireWriterLease({ repository: true, plans: [planId], checkouts: listWorktrees(root).filter(t => !t.bare).map(t => t.path), requestId: `step-done-${randomUUID()}` });
  try {
  refusePendingRetarget(planId, config, root);
  if (branchExists(`plan/${planId}`, root) || remoteBranchExists(`plan/${planId}`, root)) lifecycleContext(planId, config, root, "restack");
  else {
    const report = planReport(planId, config, root, null);
    const target = targetPlanRecord(planId, config, root, report);
    if (!target) refuse("Cannot record step: authoritative target record is unavailable.");
    const status = target.data.status;
    if (status === "shelved" || status === "abandoned") refuse(`Cannot record step: plan is ${status}.`);
  }
  const outcome = opts.outcome as StepOutcome;
  if (!(STEP_OUTCOMES as readonly string[]).includes(opts.outcome)) {
    refuse(`Unknown outcome \`${opts.outcome}\`: expected one of ${STEP_OUTCOMES.join(", ")}. Pass \`--outcome done|blocked|skipped\`.`);
  }
  const summary = opts.summary?.trim();
  if (!summary) refuse("`--summary` is required: it is the commit subject text, e.g. `--summary \"add the plan next resolver\"`.");
  const type = opts.type ?? "feat";
  if (!COMMIT_TYPES.includes(type)) refuse(`Unknown commit type \`${type}\`: expected one of ${COMMIT_TYPES.join(", ")}.`);

  const dir = planDir(planId, config, root);
  parsePlan(dir);

  // Select the step: `--step`, else the lowest-numbered step that is not done or skipped.
  const stepFiles = listStepFiles(dir);
  assertRecordingPaths(root, stepFiles.map(file => path.relative(root, file).split(path.sep).join('/')));
  const steps = stepFiles.map((f) => parseStep(f));
  let target = opts.step === undefined ? steps.find((s) => s.frontmatter.status !== "done" && s.frontmatter.status !== "skipped") : steps.find((s) => s.frontmatter.step === opts.step);
  if (!target) {
    refuse(opts.step === undefined ? `Plan \`${planId}\` has no step left to finish: every step is done or skipped. Run \`specplane plan finish ${planId}\`.` : `Plan \`${planId}\` has no step ${opts.step}.`);
  }
  const fm = target.frontmatter;
  const nn = pad(fm.step);
  const forceReason = opts.reason?.trim();
  if (opts.reason !== undefined && (!opts.force || opts.step === undefined || !forceReason || /[\r\n]/.test(opts.reason))) refuse("A force reason requires --force, an explicit --step, and a nonempty single line.");
  const rerun = (fm.status === "done" || fm.status === "skipped") && opts.step !== undefined && opts.force && !!forceReason;
  if ((fm.status === "done" || fm.status === "skipped") && !rerun) {
    refuse(`Step ${nn} is already \`${fm.status}\`: nothing to append. Pick another step with \`--step\`, or reopen it by hand if it must be redone.`);
  }
  const next = planNext(planId, config, root);
  if (!['ready', 'in_progress', 'review'].includes(next.effectiveStatus) || next.attention.some(a => ['restack', 'diverged'].includes(a.kind))) refuse(`Cannot record step: ${next.reason}`);
  if (!next.checkout || fs.realpathSync(next.checkout) !== fs.realpathSync(root)) refuse("Cannot record step outside its designated checkout.");
  if (!rerun && next.step?.number !== fm.step) refuse("Cannot record an out-of-order step; select the lowest pending step.");
  if (fm.status === "blocked" && outcome !== "blocked" && !opts.force) {
    refuse(`Step ${nn} is \`blocked\` and \`--outcome ${outcome}\` was passed. Fix the blocker first, or pass \`--force\` to override.`);
  }
  const issues = opts.openIssue ?? [];
  if (outcome === "blocked" && !issues.some((i) => i.trimStart().startsWith("BLOCKED:"))) {
    refuse("`--outcome blocked` needs an `--open-issue` that begins with `BLOCKED:`, e.g. `--open-issue \"BLOCKED: specs contradict on X\"`.");
  }
  const deviations = [...(opts.deviation ?? []), ...(forceReason ? [`Forced rerun: ${forceReason}`] : [])];
  if (outcome === "skipped" && deviations.length === 0) {
    refuse("`--outcome skipped` needs a `--deviation` that states why the step was skipped.");
  }

  // Gaps: every `--gap` ID must exist in spec-gaps.md.
  const gapLines: string[] = [];
  if ((opts.gap ?? []).length > 0) {
    const gapsFile = path.join(dir, "spec-gaps.md");
    const entries = fs.existsSync(gapsFile) ? parseGaps(gapsFile).entries : [];
    for (const raw of opts.gap ?? []) {
      const m = /^G?(\d+)$/i.exec(raw.trim());
      const entry = m ? entries.find((e) => e.n === Number(m[1])) : undefined;
      if (!entry) {
        refuse(`\`spec-gaps.md\` has no entry \`${raw}\`${fs.existsSync(gapsFile) ? "" : " (the file does not exist)"}. Add the \`## G<n>: <case>\` entry first, or drop \`--gap ${raw}\`.`);
      }
      gapLines.push(`- G${entry.n} (${entry.kind}): ${entry.caseTitle}. See \`spec-gaps.md\`.`);
    }
  }

  const changed = opts.changed ?? [];
  for (const c of changed) {
    if (!/^[^:]+:\s*\S/.test(c)) refuse(`\`--changed ${c}\` must have the form \`<path>:<reason>\`.`);
  }

  // HANDOFF.md: append-only, so a later section for another step makes the log invalid.
  const handoffFile = path.join(dir, "HANDOFF.md");
  assertRecordingPaths(root, [path.relative(root, handoffFile).split(path.sep).join('/')]);
  const before = fs.existsSync(handoffFile) ? fs.readFileSync(handoffFile, "utf8") : `# HANDOFF — ${planId}\n`;
  const later = sectionSteps(before).filter((n) => n > fm.step);
  if (later.length > 0 && !rerun) {
    refuse(`HANDOFF.md already has a section for step ${pad(Math.max(...later))}, after step ${nn}. Sections are append-only; repair the log by hand before appending.`);
  }

  const changedList = changed.map((c) => {
    const i = c.indexOf(":");
    return `\`${c.slice(0, i).trim()}\`: ${c.slice(i + 1).trim()}`;
  });
  const section = [
    `## Step ${nn}: ${fm.title}`,
    "",
    `**Date**: ${opts.date ?? today()}`,
    `**Outcome**: ${outcome}`,
    "",
    "### What changed",
    "",
    outcome === "skipped" ? "None." : bullets(changedList),
    "",
    "### Deviations from the plan",
    "",
    deviations.length === 1 ? deviations[0] : bullets(deviations),
    "",
    "### Gaps found in specs",
    "",
    gapLines.length > 0 ? gapLines.join("\n") : "None.",
    "",
    "### Open issues",
    "",
    issues.length === 1 && outcome !== "blocked" ? issues[0] : bullets(issues),
    "",
    "### What the next step must know",
    "",
    opts.nextKnows?.trim() || "None.",
    "",
  ].join("\n");

  const trailers: Trailers = cliTrailers("step", planId);
  const ordered: Trailers = {};
  for (const k of ["Specplane-Workflow", "Specplane-Plan"]) if (trailers[k]) ordered[k] = trailers[k];
  ordered["Specplane-Step"] = nn;
  for (const k of ["Specplane-Agent", "Specplane-Session"]) if (trailers[k]) ordered[k] = trailers[k];
  if (forceReason) ordered["Specplane-Force-Reason"] = forceReason;
  for (const t of opts.trailer ?? []) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.+)$/.exec(t.trim());
    if (!m) refuse(`\`--trailer ${t}\` must have the form \`Key: value\`.`);
    if (/^Specplane-/i.test(m[1])) refuse("Harness attribution cannot override core Specplane trailers.");
    ordered[m[1]] = m[2];
  }
  const slug = planId.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const message = formatMessage({
    type,
    scope: slug,
    summary,
    body: changedList.length > 0 ? changedList.map((c) => `- ${c}`).join("\n") : undefined,
    trailers: ordered,
  });

  const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const generated = [relative(handoffFile), relative(target.file)];
  const manifest = internalManifest ? structuredClone(internalManifest) : readRecordingSet(opts.recordingSet, root);
  const reviewed = validateRecordingSet(manifest, root, planId, generated, changed, outcome);
  // Commit through a private index: a failed hook must not destroy the caller's
  // exact staging state. The real index lock also serializes ordinary Git writers.
  const gitDir = run("git", ["rev-parse", "--absolute-git-dir"], { cwd: root }).trim();
  const indexFile = path.join(gitDir, "index"), indexLock = `${indexFile}.lock`;
  const temporaryIndex = path.join(gitDir, `specplane-step-${randomUUID()}.index`);
  const indexBefore = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
  const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const bytes = (file: string): Buffer | null => {
    try { const st = fs.lstatSync(file); return st.isFile() && !st.isSymbolicLink() ? fs.readFileSync(file) : null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const equal = (a: Buffer | null, b: Buffer | null) => a === null ? b === null : b !== null && a.equals(b);
  const privateGit = (...args: string[]): string => {
    try { return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: temporaryIndex }, input: args[0] === "commit" ? message : undefined }).trim(); }
    catch (error) { const e = error as { stderr?: Buffer | string; message?: string }; throw new GitError(`git ${args.join(" ")}`, e.stderr?.toString().trim() || e.message || "unknown error"); }
  };
  const stepBefore = fs.readFileSync(target.file, "utf8");
  const handoffExisted = fs.existsSync(handoffFile);
  const body = before.endsWith("\n") ? before : `${before}\n`;
  const handoffAfter = `${body}\n${section}`;
  let stepAfter: string | undefined;
  let generatedWritten = false, committed = false, recovery = false;
  let lockStat: fs.Stats | undefined;
  const lock = fs.openSync(indexLock, "wx", 0o600);
  try {
    lockStat = fs.fstatSync(lock);
    if (!equal(bytes(indexFile), indexBefore)) refuse("Recording recovery required: index changed before recording; inspect before retrying.");
    lease.assertOwned();
    validateRecordingSet(manifest, root, planId, generated, changed, outcome);
    if (indexBefore) fs.writeFileSync(temporaryIndex, indexBefore, { mode: 0o600 });
    // Start from HEAD, including paths already deleted from the caller's index,
    // so explicit deletion pathspecs remain stageable in this private index.
    privateGit("read-tree", "HEAD");
    generatedWritten = true;
    fs.writeFileSync(handoffFile, handoffAfter);
    writeStatus(target.file, outcome);
    stepAfter = fs.readFileSync(target.file, "utf8");
    // Validate the complete intended commit once more after generated writes.
    const complete: RecordingSet = { ...manifest, changes: [...manifest.changes,
      { path: generated[0], beforeDigest: handoffExisted ? hash(before) : "missing", afterDigest: hash(handoffAfter), purpose: "generated handoff" },
      ...(stepBefore === stepAfter ? [] : [{ path: generated[1], beforeDigest: hash(stepBefore), afterDigest: hash(stepAfter), purpose: "generated outcome" }]),
    ] };
    const allReasons = complete.changes.map(c => `${c.path}:${c.purpose}`);
    validateRecordingSet(complete, root, planId, [], allReasons, "done");
    privateGit("--literal-pathspecs", "add", "--", ...reviewed, ...generated);
    const expectedTree = privateGit("write-tree");
    lease.assertOwned();
    validateRecordingSet(complete, root, planId, [], allReasons, "done");
    if (!equal(bytes(indexFile), indexBefore)) refuse("Recording recovery required: index changed during recording; inspect before retrying.");
    privateGit("commit", "-F", "-");
    committed = true;
    const recordedHead = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
    const expectedCore = new Map(Object.entries(ordered).filter(([key]) => /^Specplane-/i.test(key)).map(([key, value]) => [key.toLowerCase(), value]));
    const actualCore = new Map<string, string[]>();
    for (const [key, value] of readTrailerEntries(recordedHead, root)) {
      if (/^Specplane-/i.test(key)) {
        const normalized = key.toLowerCase();
        actualCore.set(normalized, [...(actualCore.get(normalized) ?? []), value]);
      }
    }
    if (run("git", ["branch", "--show-current"], { cwd: root }).trim() !== manifest.branch ||
        actualCore.size !== expectedCore.size || [...expectedCore].some(([key, value]) => {
          const values = actualCore.get(key);
          return values?.length !== 1 || values[0] !== value;
        })) refuse("Recording recovery required: committed branch or core trailers differ from the reviewed operation.");
    if (run("git", ["rev-parse", "HEAD^{tree}"], { cwd: root }).trim() !== expectedTree ||
        run("git", ["rev-parse", "HEAD^"], { cwd: root }).trim() !== manifest.head ||
        run("git", ["rev-parse", "HEAD"], { cwd: root }).trim() !== recordedHead ||
        privateGit("write-tree") !== expectedTree || privateGit("status", "--porcelain").length > 0 ||
        !equal(bytes(indexFile), indexBefore) || !equal(bytes(handoffFile), Buffer.from(handoffAfter)) || !equal(bytes(target.file), Buffer.from(stepAfter))) {
      refuse("Recording recovery required: committed state changed unexpectedly; inspect HEAD, index and generated files before retrying.");
    }
    // Publish the completed private index only after checking the real preimage.
    const ownedLock = fs.lstatSync(indexLock);
    if (ownedLock.ino !== lockStat.ino || ownedLock.dev !== lockStat.dev) refuse("Recording recovery required: index lock ownership changed.");
    fs.writeFileSync(lock, fs.readFileSync(temporaryIndex));
    fs.renameSync(indexLock, indexFile);
  } catch (e) {
    const headChanged = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim() !== manifest.head;
    if (committed || headChanged || !equal(bytes(indexFile), indexBefore)) recovery = true;
    // A hook may replace a parent directory with a link while retaining matching
    // leaf bytes. Never let recovery follow that link when restoring preimages.
    if (generatedWritten && !recovery) {
      try { assertRecordingPaths(root, generated); }
      catch { recovery = true; }
    }
    if (generatedWritten && !recovery) {
      if (stepAfter !== undefined && equal(bytes(target.file), Buffer.from(stepAfter))) fs.writeFileSync(target.file, stepBefore);
      else if (!equal(bytes(target.file), Buffer.from(stepBefore))) recovery = true;
      if (equal(bytes(handoffFile), Buffer.from(handoffAfter))) {
        if (handoffExisted) fs.writeFileSync(handoffFile, before);
        else fs.unlinkSync(handoffFile);
      } else recovery = true;
    }
    if (recovery) refuse(`Recording recovery required: concurrent or committed changes were preserved. Inspect HEAD, index, HANDOFF and step; private index retained at ${temporaryIndex}. Original error: ${(e as Error).message}`);
    throw e;
  } finally {
    fs.closeSync(lock);
    const currentLock = fs.existsSync(indexLock) ? fs.lstatSync(indexLock) : null;
    if (lockStat && currentLock?.ino === lockStat.ino && currentLock.dev === lockStat.dev) fs.unlinkSync(indexLock);
    if (!recovery) fs.rmSync(temporaryIndex, { force: true });
  }
  const commit = run("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
  return { planId, step: fm.step, outcome, commit, handoff: path.relative(root, handoffFile).split(path.sep).join("/") };
  } finally { if (!heldLease) lease.release(); }
}
