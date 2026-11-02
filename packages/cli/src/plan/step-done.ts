import * as fs from "node:fs";
import { refusePendingRetarget } from "./lifecycle-context.js";
import * as path from "node:path";
import { PlanStateError } from "../errors.js";
import { writeStatus } from "../frontmatter.js";
import { run } from "../git/exec.js";
import { cliTrailers, formatMessage, type Trailers } from "../git/commit.js";
import type { Config } from "../types.js";
import { parseGaps } from "./gaps.js";
import { listStepFiles, parsePlan, parseStep } from "./parse.js";
import { planDir } from "./resolve.js";

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
function sectionSteps(text: string): number[] {
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
export function stepDone(planId: string, opts: StepDoneOptions, config: Config, root: string): StepDoneResult {
  refusePendingRetarget(planId, config, root);
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
  const steps = listStepFiles(dir).map((f) => parseStep(f));
  let target = opts.step === undefined ? steps.find((s) => s.frontmatter.status !== "done" && s.frontmatter.status !== "skipped") : steps.find((s) => s.frontmatter.step === opts.step);
  if (!target) {
    refuse(opts.step === undefined ? `Plan \`${planId}\` has no step left to finish: every step is done or skipped. Run \`specplane plan finish ${planId}\`.` : `Plan \`${planId}\` has no step ${opts.step}.`);
  }
  const fm = target.frontmatter;
  const nn = pad(fm.step);
  const forceReason = opts.reason?.trim();
  if (forceReason && (!opts.force || /[\r\n]/.test(forceReason))) refuse("A force reason requires --force and must be one line.");
  if ((fm.status === "done" || fm.status === "skipped") && !(opts.force && forceReason)) {
    refuse(`Step ${nn} is already \`${fm.status}\`: nothing to append. Pick another step with \`--step\`, or reopen it by hand if it must be redone.`);
  }
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
  const before = fs.existsSync(handoffFile) ? fs.readFileSync(handoffFile, "utf8") : `# HANDOFF — ${planId}\n`;
  const later = sectionSteps(before).filter((n) => n > fm.step);
  if (later.length > 0 && !(opts.force && forceReason)) {
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
  for (const t of opts.trailer ?? []) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.+)$/.exec(t.trim());
    if (!m) refuse(`\`--trailer ${t}\` must have the form \`Key: value\`.`);
    ordered[m[1]] = m[2];
  }
  if (forceReason) ordered["Specplane-Force-Reason"] = forceReason;
  const slug = planId.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const message = formatMessage({
    type,
    scope: slug,
    summary,
    body: changedList.length > 0 ? changedList.map((c) => `- ${c}`).join("\n") : undefined,
    trailers: ordered,
  });

  // Writes: HANDOFF.md section and step status together; restored if the commit fails.
  const stepBefore = fs.readFileSync(target.file, "utf8");
  const handoffExisted = fs.existsSync(handoffFile);
  const body = before.endsWith("\n") ? before : `${before}\n`;
  fs.writeFileSync(handoffFile, `${body}\n${section}`);
  writeStatus(target.file, outcome);
  const rel = path.relative(root, dir).split(path.sep).join("/");
  try {
    run("git", ["add", "--", rel], { cwd: root });
    run("git", ["commit", "-F", "-"], { cwd: root, input: message });
  } catch (e) {
    fs.writeFileSync(target.file, stepBefore);
    if (handoffExisted) fs.writeFileSync(handoffFile, before);
    else fs.rmSync(handoffFile, { force: true });
    try {
      run("git", ["reset", "-q", "--", rel], { cwd: root });
    } catch {
      /* best effort: the files are restored either way */
    }
    throw e;
  }
  const commit = run("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
  return { planId, step: fm.step, outcome, commit, handoff: path.relative(root, handoffFile).split(path.sep).join("/") };
}
