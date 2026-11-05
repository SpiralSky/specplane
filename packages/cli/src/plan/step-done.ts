import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { acquireWriterLease, checkoutIdentity, type WriterLease } from "../core/writer-leases.js";
import { listWorktrees } from "../git/worktree.js";
import { lifecycleContext, refusePendingRetarget } from "./lifecycle-context.js";
import { planReport, targetPlanRecord } from "./activity.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import * as path from "node:path";
import { GitError, PlanStateError } from "../errors.js";
import { run } from "../git/exec.js";
import { cliTrailers, formatMessage, readTrailerEntries, type Trailers } from "../git/commit.js";
import type { Config } from "../types.js";
import { parseGaps } from "./gaps.js";
import { listStepFiles, parsePlan, parseStep } from "./parse.js";
import { planDir } from "./resolve.js";
import { assertRecordingPaths, readRecordingSet, validateRecordingSet, type RecordingSet } from "./recording-set.js";
import { planNext } from "./next.js";
import type { RecoveryTransaction } from "../core/pending-recovery.js";

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

/** Core-only transaction additions, never accepted from command options or workflow JSON. */
export interface GeneratedRecording {
  /** A `before` of null creates the file (only core's `spec-gaps.md` write uses it). */
  changes: { path: string; before: string | null; after: string }[];
  /** Gap lines for entries core itself appended to `spec-gaps.md` in this recording (already formatted). */
  gapLines?: string[];
  trailers: [string, string][];
  beforeWrite?: (intent: { tree: string; message: string; head: string; branch: string; receipt: Omit<StepDoneResult, 'commit'>; transaction: RecoveryTransaction }) => void;
  beforeCommit?: (intent: { tree: string; message: string; head: string; branch: string; receipt: Omit<StepDoneResult, 'commit'> }) => void;
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
/** A person's declaration through the CLI: no minimum applies and nothing stronger than the declarer checked it. */
const MANUAL_VERIFICATION = "Verification: manual, self-assessed.";

export function stepDone(planId: string, opts: StepDoneOptions, config: Config, root: string, heldLease?: WriterLease, internalManifest?: RecordingSet, generatedRecording?: GeneratedRecording): StepDoneResult {
  // This whole operation is synchronous. Suppress optional index refreshes in
  // read-only Git children so even an early refusal preserves the index bytes.
  // Required Git locks (including our real index lock) remain enabled.
  const optionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  process.env.GIT_OPTIONAL_LOCKS = '0';
  try { return recordStep(planId, opts, config, root, heldLease, internalManifest, generatedRecording); }
  finally {
    if (optionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = optionalLocks;
  }
}

function recordStep(planId: string, opts: StepDoneOptions, config: Config, root: string, heldLease?: WriterLease, internalManifest?: RecordingSet, generatedRecording?: GeneratedRecording): StepDoneResult {
  if (internalManifest && !heldLease) refuse("Internal recording manifests require a held writer lease.");
  if (generatedRecording && (!heldLease || !internalManifest)) refuse("Generated recording requires a held writer lease and internal manifest.");
  const additions: GeneratedRecording = { changes: structuredClone(generatedRecording?.changes ?? []), gapLines: structuredClone(generatedRecording?.gapLines ?? []), trailers: structuredClone(generatedRecording?.trailers ?? []), beforeWrite: generatedRecording?.beforeWrite, beforeCommit: generatedRecording?.beforeCommit };
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

  gapLines.push(...(additions.gapLines ?? []));
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
    [...(generatedRecording || outcome !== "done" ? [] : [MANUAL_VERIFICATION]), ...(opts.nextKnows?.trim() ? [opts.nextKnows.trim()] : [])].join("\n\n") || "None.",
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
  if (additions.trailers.some(([key]) => key === 'Specplane-Agent')) {
    // Structured attribution comes from the verified private host context. The
    // manual CLI alone retains its explicit environment attribution fallback.
    delete ordered['Specplane-Agent']; delete ordered['Specplane-Session'];
  }
  for (const [key, value] of additions.trailers) {
    if (!['Specplane-Contribution', 'Specplane-Request', 'Specplane-Agent'].includes(key) || !value.trim() || /[\r\n]/.test(value)) refuse("Invalid generated recording trailer.");
    if (key === 'Specplane-Request' || key === 'Specplane-Agent') {
      if (ordered[key] !== undefined) refuse(`Generated ${key === 'Specplane-Request' ? 'request' : 'agent'} trailer must occur once.`);
      ordered[key] = value;
    } else {
      const previous = ordered[key];
      ordered[key] = [...(previous === undefined ? [] : Array.isArray(previous) ? previous : [previous]), value];
    }
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
  const progress = [relative(handoffFile), relative(target.file)];
  const additionPaths = additions.changes.map(change => change.path);
  if (new Set(additionPaths).size !== additionPaths.length || additionPaths.some(file => progress.includes(file) || internalManifest?.changes.some(change => change.path === file))) refuse("Generated recording paths must be distinct from progress and reviewed edits.");
  const generated = [...progress, ...additionPaths];
  const manifest = internalManifest ? structuredClone(internalManifest) : readRecordingSet(opts.recordingSet, root);
  function checkAdditionPreimages(): void {
    assertRecordingPaths(root, additionPaths);
    for (const change of additions.changes) {
      if (change.before === null) {
        // A created file must be absent from the worktree and from the base commit.
        const atBase = spawnSync('git', ['cat-file', '-e', `${manifest.head}:${change.path}`], { cwd: root });
        if (typeof change.after !== 'string' || fs.existsSync(path.join(root, change.path)) || atBase.status === 0) refuse(`Generated recording preimage changed: ${change.path}`);
        continue;
      }
      if (typeof change.before !== 'string' || typeof change.after !== 'string' || change.before === change.after ||
          !fs.readFileSync(path.join(root, change.path)).equals(Buffer.from(change.before)) ||
          !run('git', ['show', `${manifest.head}:${change.path}`], { cwd: root, binary: true }).equals(Buffer.from(change.before))) refuse(`Generated recording preimage changed: ${change.path}`);
    }
  }
  checkAdditionPreimages();
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
  const stepLines = stepBefore.split(/\r?\n/), stepEnd = stepLines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line));
  const statusAt = stepLines.findIndex((line, index) => index > 0 && index < stepEnd && /^status\s*:/.test(line));
  if (!/^---[ \t]*$/.test(stepLines[0] ?? '') || stepEnd < 0 || statusAt < 0) refuse('Cannot locate step status before recording.');
  stepLines[statusAt] = `status: ${outcome}`;
  const stepAfter = stepLines.join(stepBefore.includes('\r\n') ? '\r\n' : '\n');
  const mode = (file: string): number | null => { try { return fs.lstatSync(file).mode & 0o777; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
  const coreChanges: RecoveryTransaction['generated'] = [...additions.changes, { path: progress[0], before: handoffExisted ? before : null, after: handoffAfter }, { path: progress[1], before: stepBefore, after: stepAfter }].map(change => ({ ...change, beforeMode: mode(path.join(root, change.path)), afterMode: mode(path.join(root, change.path)) ?? (0o666 & ~process.umask()) }));
  const complete: RecordingSet = { ...manifest, changes: [...manifest.changes,
    { path: generated[0], beforeDigest: handoffExisted ? hash(before) : "missing", afterDigest: hash(handoffAfter), purpose: "generated handoff" },
    ...(stepBefore === stepAfter ? [] : [{ path: generated[1], beforeDigest: hash(stepBefore), afterDigest: hash(stepAfter), purpose: "generated outcome" }]),
    ...additions.changes.map(change => ({ path: change.path, beforeDigest: change.before === null ? "missing" : hash(change.before), afterDigest: hash(change.after), purpose: change.path.endsWith('/spec-gaps.md') ? "generated review findings" : "generated contribution metadata" })),
  ] };
  const allReasons = complete.changes.map(c => `${c.path}:${c.purpose}`);
  const blob = (content: string) => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: content, encoding: 'utf8' }).trim();
  let generatedWritten = false, committed = false, recovery = false;
  let lockStat: fs.Stats | undefined;
  const lock = fs.openSync(indexLock, "wx", 0o600);
  const ownsEmptyLock = (): boolean => {
    try {
      const current = fs.lstatSync(indexLock), opened = fs.fstatSync(lock);
      return !!lockStat && current.isFile() && !current.isSymbolicLink() && current.nlink === 1 &&
        current.dev === lockStat.dev && current.ino === lockStat.ino && opened.dev === current.dev && opened.ino === current.ino && opened.size === 0;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
  };
  try {
    lockStat = fs.fstatSync(lock);
    if (!equal(bytes(indexFile), indexBefore)) refuse("Recording recovery required: index changed before recording; inspect before retrying.");
    lease.assertOwned();
    validateRecordingSet(manifest, root, planId, generated, changed, outcome);
    checkAdditionPreimages();
    if (indexBefore) fs.writeFileSync(temporaryIndex, indexBefore, { mode: 0o600 });
    // Start from HEAD, including paths already deleted from the caller's index,
    // so explicit deletion pathspecs remain stageable in this private index.
    privateGit("read-tree", "HEAD");
    if (reviewed.length) privateGit("--literal-pathspecs", "add", "--", ...reviewed);
    for (const change of coreChanges) privateGit('update-index', '--add', '--cacheinfo', change.afterMode & 0o111 ? '100755' : '100644', blob(change.after), change.path);
    const expectedTree = privateGit("write-tree");
    const lockIdentity = fs.fstatSync(lock, { bigint: true });
    const transaction: RecoveryTransaction = { manifest, generated: coreChanges, indexBeforeDigest: indexBefore === null ? 'missing' : hash(indexBefore), temporaryIndexBasename: path.basename(temporaryIndex), indexLock: { dev: String(lockIdentity.dev), ino: String(lockIdentity.ino) } };
    additions.beforeWrite?.({ tree: expectedTree, message, head: manifest.head, branch: manifest.branch, receipt: { planId, step: fm.step, outcome, handoff: relative(handoffFile) }, transaction });
    lease.assertOwned();
    validateRecordingSet(manifest, root, planId, generated, changed, outcome);
    checkAdditionPreimages();
    if (!ownsEmptyLock() || !equal(bytes(indexFile), indexBefore) || privateGit('write-tree') !== expectedTree || coreChanges.some(change => mode(path.join(root, change.path)) !== change.beforeMode)) refuse('Recording recovery required: index, lock or generated modes changed before generated writes.');
    generatedWritten = true;
    for (const change of additions.changes) fs.writeFileSync(path.join(root, change.path), change.after);
    fs.writeFileSync(handoffFile, handoffAfter);
    fs.writeFileSync(target.file, stepAfter);
    validateRecordingSet(complete, root, planId, [], allReasons, "done");
    lease.assertOwned();
    validateRecordingSet(complete, root, planId, [], allReasons, "done");
    if (!ownsEmptyLock() || !equal(bytes(indexFile), indexBefore)) refuse("Recording recovery required: index or lock changed during recording; inspect before retrying.");
    if (coreChanges.some(change => mode(path.join(root, change.path)) !== change.afterMode) || privateGit('diff', '--name-only', '--no-ext-diff', '--')) refuse('Recording recovery required: intended worktree or generated modes changed before commit.');
    additions.beforeCommit?.({ tree: expectedTree, message, head: manifest.head, branch: manifest.branch, receipt: { planId, step: fm.step, outcome, handoff: relative(handoffFile) } });
    lease.assertOwned();
    validateRecordingSet(complete, root, planId, [], allReasons, "done");
    if (!ownsEmptyLock() || !equal(bytes(indexFile), indexBefore) || privateGit("write-tree") !== expectedTree || privateGit('diff', '--name-only', '--no-ext-diff', '--') || coreChanges.some(change => mode(path.join(root, change.path)) !== change.afterMode)) refuse("Recording recovery required: index, lock or generated modes changed before commit; inspect before retrying.");
    privateGit("commit", "--cleanup=verbatim", "-F", "-");
    committed = true;
    lease.assertOwned();
    const recordedHead = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
    const commitObject = run('git', ['cat-file', 'commit', recordedHead], { cwd: root, binary: true });
    const recordedMessage = commitObject.subarray(commitObject.indexOf(Buffer.from('\n\n')) + 2);
    if (!recordedMessage.equals(Buffer.from(message))) refuse('Recording recovery required: committed message differs from the exact reviewed intent.');
    const expectedCore = new Map(Object.entries(ordered).filter(([key]) => /^Specplane-/i.test(key)).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value : [value]]));
    const actualCore = new Map<string, string[]>();
    for (const [key, value] of readTrailerEntries(recordedHead, root)) {
      if (/^Specplane-/i.test(key)) {
        const normalized = key.toLowerCase();
        actualCore.set(normalized, [...(actualCore.get(normalized) ?? []), value]);
      }
    }
    if (run("git", ["branch", "--show-current"], { cwd: root }).trim() !== manifest.branch ||
        actualCore.size !== expectedCore.size || [...expectedCore].some(([key, expected]) => {
          const values = actualCore.get(key);
          return values?.length !== expected.length || expected.some((value, index) => values[index] !== value);
        })) refuse("Recording recovery required: committed branch or core trailers differ from the reviewed operation.");
    if (run("git", ["rev-parse", "HEAD^{tree}"], { cwd: root }).trim() !== expectedTree ||
        run("git", ["rev-list", "--parents", "-n", "1", recordedHead], { cwd: root }).trim() !== `${recordedHead} ${manifest.head}` ||
        run("git", ["rev-parse", "HEAD"], { cwd: root }).trim() !== recordedHead ||
        privateGit("write-tree") !== expectedTree || privateGit("status", "--porcelain").length > 0 ||
        !equal(bytes(indexFile), indexBefore) || !equal(bytes(handoffFile), Buffer.from(handoffAfter)) || !equal(bytes(target.file), Buffer.from(stepAfter))) {
      refuse("Recording recovery required: committed state changed unexpectedly; inspect HEAD, index and generated files before retrying.");
    }
    // Publish the completed private index only after checking the real preimage.
    if (!ownsEmptyLock()) refuse("Recording recovery required: index lock ownership or contents changed.");
    fs.writeFileSync(lock, fs.readFileSync(temporaryIndex));
    fs.renameSync(indexLock, indexFile);
  } catch (e) {
    const headChanged = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim() !== manifest.head;
    if (committed || headChanged || !equal(bytes(indexFile), indexBefore) || !ownsEmptyLock()) recovery = true;
    // A hook may replace a parent directory with a link while retaining matching
    // leaf bytes. Never let recovery follow that link when restoring preimages.
    if (generatedWritten && !recovery) {
      try { assertRecordingPaths(root, generated); if (coreChanges.some(change => ![change.beforeMode, change.afterMode].includes(mode(path.join(root, change.path))))) recovery = true; }
      catch { recovery = true; }
    }
    if (generatedWritten && !recovery) {
      for (const change of additions.changes) {
        const file = path.join(root, change.path);
        if (equal(bytes(file), Buffer.from(change.after))) { if (change.before === null) fs.unlinkSync(file); else fs.writeFileSync(file, change.before); }
        else if (!equal(bytes(file), change.before === null ? null : Buffer.from(change.before))) recovery = true;
      }
      if (stepAfter !== undefined && equal(bytes(target.file), Buffer.from(stepAfter))) fs.writeFileSync(target.file, stepBefore);
      else if (!equal(bytes(target.file), Buffer.from(stepBefore))) recovery = true;
      if (equal(bytes(handoffFile), Buffer.from(handoffAfter))) {
        if (handoffExisted) fs.writeFileSync(handoffFile, before);
        else fs.unlinkSync(handoffFile);
      } else if (!equal(bytes(handoffFile), handoffExisted ? Buffer.from(before) : null)) recovery = true;
    }
    if (recovery) refuse(`Recording recovery required: concurrent or committed changes were preserved. Inspect HEAD, index, HANDOFF and step; private index retained at ${temporaryIndex}. Original error: ${(e as Error).message}`);
    throw e;
  } finally {
    const removableLock = ownsEmptyLock();
    fs.closeSync(lock);
    if (removableLock) fs.unlinkSync(indexLock);
    if (!recovery) fs.rmSync(temporaryIndex, { force: true });
  }
  const commit = run("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
  return { planId, step: fm.step, outcome, commit, handoff: path.relative(root, handoffFile).split(path.sep).join("/") };
  } finally { if (!heldLease) lease.release(); }
}
