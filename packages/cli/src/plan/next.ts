import * as fs from "node:fs";
import * as path from "node:path";
import { parseAdr } from "../decisions/parse.js";
import { GitError, PlanNotFoundError, SpecplaneError } from "../errors.js";
import { parseFrontmatter, readFrontmatter } from "../frontmatter.js";
import { ADR_SCHEMA, STEP_SCHEMA, validator } from "../schemas.js";
import { configAt } from "./prepare-start.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { hasOpenPR } from "../git/forge.js";
import { run } from "../git/exec.js";
import { resolveSpecId } from "../spec/resolve.js";
import { findHeading } from "../spec/slug.js";
import type { Config, PlanFrontmatter, StepFrontmatter } from "../types.js";
import { getPlanActivity, planReport, selectedPlanBranch, showFile, targetPlanRecord } from "./activity.js";
import { refusePendingRetarget } from "./lifecycle-context.js";
import { mergedStackBase } from "./flows.js";
import { parseGaps, parseGapsText, type GapEntry } from "./gaps.js";
import { listStepFiles, parsePlan, parseStep } from "./parse.js";
import { listPlans } from "./resolve.js";
import { getEffectiveStatus, type EffectiveStatus } from "./status.js";

export const ATTENTION_KINDS = ["blocked", "gap_decision", "finish_ready", "restack", "diverged", "dirty"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export const NEXT_ACTIONS = ["spawn_step", "ask_human", "finish", "restack", "none"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export interface NextContextItem {
  kind: "spec" | "decision" | "file";
  id: string;
  /** Repository-relative path with `/` separators; null when unresolved. */
  path: string | null;
  anchor: string | null;
}

/** `architecture/reference-cli` § Plan next (`plan next --json`). */
export interface PlanNext {
  plan: string;
  title: string;
  effectiveStatus: EffectiveStatus;
  step: { number: number; title: string; status: string; file: string } | null;
  context: NextContextItem[];
  checkout: string | null;
  blocked: string[];
  openGaps: { id: string; kind: string; summary: string }[];
  warnings: string[];
  attention: { kind: AttentionKind; message: string }[];
  action: NextAction;
  reason: string;
}

/** Everything `computeNext` needs; gathered by `planNext`, constructed directly in tests. */
export interface NextInput {
  plan: string;
  title: string;
  effectiveStatus: EffectiveStatus;
  /** True when `plan/<id>` exists locally or on origin. */
  started: boolean;
  steps: { number: number; title: string; status: string; file: string }[];
  context: NextContextItem[];
  checkout: string | null;
  blockedIssues: string[];
  gaps: GapEntry[];
  warnings: string[];
  restackBase: string | null;
  diverged: boolean;
  dirty: boolean;
}

const NEEDS_DECISION = new Set(["proposal", "assumption"]);

/** Pure resolution of the next step, `attention`, and `action`. */
export function computeNext(i: NextInput): PlanNext {
  const open = i.gaps.filter((g) => g.status === "open");
  const remaining = [...i.steps].sort((a, b) => a.number - b.number).filter((s) => s.status !== "done" && s.status !== "skipped");
  const step = remaining[0] ?? null;
  const done = i.effectiveStatus === "done" || i.effectiveStatus === "abandoned" || i.effectiveStatus === "shelved";

  const attention = new Map<AttentionKind, string>();
  const add = (kind: AttentionKind, message: string) => {
    if (!attention.has(kind)) attention.set(kind, message);
  };
  if (i.diverged) add("diverged", `plan/${i.plan} and origin/plan/${i.plan} have diverged.`);
  if (i.dirty) add("dirty", "The plan checkout has uncommitted changes.");
  if (step?.status === "blocked") add("blocked", `Step ${step.number} is blocked.`);
  const decisions = open.filter((g) => NEEDS_DECISION.has(g.kind));
  if (decisions.length > 0) add("gap_decision", `Open spec-gaps.md entries need a decision: ${decisions.map((g) => `G${g.n}`).join(", ")}.`);
  if (i.restackBase) add("restack", `Base plan \`${i.restackBase}\` has merged.`);
  if (!done && i.started && step === null && i.steps.length > 0) add("finish_ready", "All steps are done or skipped.");

  const blocked = step?.status === "blocked" ? i.blockedIssues : [];
  let action: NextAction;
  let reason: string;
  if (done) {
    action = "none";
    reason = i.effectiveStatus === "shelved" ? `Plan is shelved; run ` + "`" + `specplane plan resume ${i.plan}` + "`" + ` first.` : `Plan is ${i.effectiveStatus}.`;
  } else if (i.effectiveStatus === "draft" || i.effectiveStatus === "blocked" || !i.started) {
    action = "none";
    reason =
      i.effectiveStatus === "draft"
        ? "Plan is a draft; approve it first."
        : i.effectiveStatus === "blocked"
          ? "Plan is blocked by unmerged dependencies."
          : `Plan is not started; run \`specplane plan start ${i.plan}\`.`;
  } else if (attention.has("diverged")) {
    action = "ask_human";
    reason = attention.get("diverged")! + " Reconcile the branches first.";
  } else if (attention.has("dirty")) {
    action = "ask_human";
    reason = attention.get("dirty")! + " Commit or stash them first.";
  } else if (attention.has("blocked")) {
    action = "ask_human";
    reason = `${attention.get("blocked")!}${blocked.length > 0 ? ` ${blocked.join("; ")}` : ""}`;
  } else if (attention.has("gap_decision")) {
    action = "ask_human";
    reason = attention.get("gap_decision")!;
  } else if (attention.has("restack")) {
    action = "restack";
    reason = `${attention.get("restack")!} Run \`specplane plan restack ${i.plan}\`.`;
  } else if (attention.has("finish_ready")) {
    action = "finish";
    reason = `${attention.get("finish_ready")!} Run \`specplane plan finish ${i.plan}\`.`;
  } else if (step) {
    action = "spawn_step";
    reason = stepReason(step, i.steps);
  } else {
    action = "none";
    reason = "Plan has no steps.";
  }

  return {
    plan: i.plan,
    title: i.title,
    effectiveStatus: i.effectiveStatus,
    step: step && { ...step },
    context: i.context,
    checkout: i.checkout,
    blocked,
    openGaps: open.map((g) => ({ id: `G${g.n}`, kind: g.kind, summary: g.caseTitle })),
    warnings: i.warnings,
    attention: [...attention].map(([kind, message]) => ({ kind, message })),
    action,
    reason,
  };
}

function stepReason(step: { number: number; status: string }, all: { number: number; status: string }[]): string {
  const later = all.filter((s) => s.number > step.number && s.status !== "pending");
  const base = `Step ${step.number} is the lowest-numbered step that is not done or skipped (${step.status}).`;
  return later.length > 0
    ? `${base} It runs before step ${later[0].number} (${later[0].status}).`
    : base;
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    return run("git", args, { cwd });
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

function rel(base: string, abs: string): string {
  return path.relative(base, abs).split(path.sep).join("/");
}

/** Resolve the context items of a step to repository-relative paths; unresolved items add warnings. */
function resolveContext(step: StepFrontmatter, config: Config, base: string, warnings: string[]): NextContextItem[] {
  const out: NextContextItem[] = [];
  for (const item of step.context ?? []) {
    if ("spec" in item) {
      const hash = item.spec.indexOf("#");
      const id = hash === -1 ? item.spec : item.spec.slice(0, hash);
      const anchor = hash === -1 ? null : item.spec.slice(hash + 1);
      try {
        const r = resolveSpecId(id, config, undefined, base);
        if (anchor !== null && !findHeading(readFrontmatter(r.path).body, anchor)) {
          warnings.push(`Context spec \`${item.spec}\`: no heading matches the anchor.`);
        }
        out.push({ kind: "spec", id, path: rel(base, r.path), anchor });
      } catch (e) {
        if (!(e instanceof SpecplaneError)) throw e;
        warnings.push(`Context spec \`${item.spec}\` does not resolve: ${e.message}`);
        out.push({ kind: "spec", id, path: null, anchor });
      }
    } else if ("decision" in item) {
      const m = /^decision\/(\d{4})$/.exec(item.decision);
      const dir = path.join(base, config.decisions.dir);
      const file = m && fs.existsSync(dir)
        ? fs.readdirSync(dir).sort().find(f => new RegExp(`^${m[1]}-.*\\.md$`).test(f))
        : undefined;
      let valid = false;
      try { if (file) { parseAdr(path.join(dir, file)); valid = true; } }
      catch (e) { if (!(e instanceof SpecplaneError)) throw e; }
      if (!valid) warnings.push(`Context decision \`${item.decision}\` does not resolve to an ADR.`);
      out.push({ kind: "decision", id: item.decision, path: valid ? rel(base, path.join(dir, file!)) : null, anchor: null });
    } else {
      const exists = fs.existsSync(path.join(base, item.file));
      if (!exists) warnings.push(`Context file \`${item.file}\` does not exist.`);
      out.push({ kind: "file", id: item.file, path: exists ? item.file : null, anchor: null });
    }
  }
  return out;
}

/** Read committed inputs directly from a tree without creating a worktree or temporary files. */
function snapshotNext(id: string, ref: string, config: Config, root: string, warnings: string[]) {
  const active = `${config.plans.dir}/${id}`;
  const archived = `${config.plans.dir}/archive/${id}`;
  const dir = showFile(ref, `${active}/PLAN.md`, root) !== null ? active : archived;
  const files = (tryGit(["ls-tree", "-r", "--name-only", ref, "--", `${dir}/steps/`], root) ?? "")
    .split("\n").filter(f => f.startsWith(`${dir}/steps/`) && !f.slice(`${dir}/steps/`.length).includes("/") && f.endsWith(".md")).sort();
  const steps: NextInput["steps"] = [];
  const stepFms = new Map<number, StepFrontmatter>();
  for (const file of files) {
    try {
      const text = showFile(ref, file, root);
      if (text === null) throw new Error("file is unavailable");
      const data = parseFrontmatter(text, file).data;
      const prefix = /^(\d+)-/.exec(path.basename(file));
      if (!validator(STEP_SCHEMA)(data) || !prefix || data.step !== Number(prefix[1]) || data.plan !== id) throw new Error("invalid step record");
      const s = data as unknown as StepFrontmatter;
      steps.push({ number: s.step, title: s.title, status: s.status, file });
      stepFms.set(s.step, s);
    } catch (e) { warnings.push(`Skipped ${path.basename(file)}: ${(e as Error).message}`); }
  }
  const gapText = showFile(ref, `${dir}/spec-gaps.md`, root) ?? "";
  const gaps = parseGapsText(gapText).entries;
  const first = [...steps].sort((a, b) => a.number - b.number).find(s => s.status !== "done" && s.status !== "skipped");
  const context: NextContextItem[] = [];
  for (const item of first ? stepFms.get(first.number)!.context ?? [] : []) {
    if ("spec" in item) {
      const hash = item.spec.indexOf("#"), specId = hash < 0 ? item.spec : item.spec.slice(0, hash), anchor = hash < 0 ? null : item.spec.slice(hash + 1);
      try {
        const resolved = resolveSpecId(specId, config, undefined, root, f => showFile(ref, rel(root, f), root) !== null);
        const file = rel(root, resolved.path), text = showFile(ref, file, root)!;
        if (anchor !== null && !findHeading(parseFrontmatter(text, file).body, anchor)) warnings.push(`Context spec \`${item.spec}\`: no heading matches the anchor.`);
        context.push({ kind: "spec", id: specId, path: file, anchor });
      } catch (e) {
        if (!(e instanceof SpecplaneError)) throw e;
        warnings.push(`Context spec \`${item.spec}\` does not resolve: ${e.message}`);
        context.push({ kind: "spec", id: specId, path: null, anchor });
      }
    } else if ("decision" in item) {
      const number = /^decision\/(\d{4})$/.exec(item.decision)?.[1];
      const files = (tryGit(["ls-tree", "-r", "--name-only", ref, "--", `${config.decisions.dir}/`], root) ?? "").split("\n");
      const file = number && files.find(f => path.posix.dirname(f) === config.decisions.dir && new RegExp(`^${number}-.*\\.md$`).test(path.posix.basename(f)));
      let valid = false;
      if (file) {
        const text = showFile(ref, file, root);
        try { if (text !== null) valid = validator(ADR_SCHEMA)(parseFrontmatter(text, file).data); }
        catch (e) { if (!(e instanceof SpecplaneError)) throw e; }
      }
      if (!valid) warnings.push(`Context decision \`${item.decision}\` does not resolve to an ADR.`);
      context.push({ kind: "decision", id: item.decision, path: valid ? file! : null, anchor: null });
    } else {
      const exists = showFile(ref, item.file, root) !== null;
      if (!exists) warnings.push(`Context file \`${item.file}\` does not exist.`);
      context.push({ kind: "file", id: item.file, path: exists ? item.file : null, anchor: null });
    }
  }
  return { steps, gaps, context };
}

/** Resolve the selected execution or target snapshot without fetching or mutating Git. */
export function planNext(id: string, config: Config, root: string): PlanNext {
  refusePendingRetarget(id, config, root);
  const report = planReport(id, config, root, null);
  const target = targetPlanRecord(id, config, root, report);
  const branch = selectedPlanBranch(id, config, root);
  if (!target) throw new Error("Authoritative target record is unavailable; reconcile target refs before resolving the next step.");
  const selected = branch ?? target;
  const ownConfig = configAt(root, selected.ref);
  const activity = getPlanActivity(id, ownConfig, root, report.target_branch, selected.ref);
  const checkout = branch && branch.ref === report.ref_freshness.plan_local ? activity.checkout : null;
  const warnings: string[] = [];
  const checkoutRecord = checkout ? listPlans(ownConfig, checkout).find(r => r.id === id) : undefined;
  if (checkout && !checkoutRecord) throw new PlanNotFoundError(id);
  const fm = checkoutRecord ? parsePlan(checkoutRecord.dir).frontmatter : selected.data as unknown as PlanFrontmatter;
  const authoritative = target.data as unknown as PlanFrontmatter;
  const byId = new Map<string, PlanFrontmatter>();
  for (const dep of authoritative.depends_on ?? []) {
    const record = targetPlanRecord(dep, config, root, report);
    if (record) byId.set(dep, record.data as unknown as PlanFrontmatter);
  }
  const lifecycle = ["shelved", "abandoned", "done"].includes(authoritative.status) ? authoritative.status : fm.status;
  const effectiveStatus = getEffectiveStatus({ ...fm, status: lifecycle, depends_on: authoritative.depends_on }, byId, target.config, {
    branchExists: pid => branchExists(`plan/${pid}`, root) || remoteBranchExists(`plan/${pid}`, root),
    hasOpenPr: pid => hasOpenPR(`plan/${pid}`, { cwd: root, forge: target.config.plans.forge, ...(report.target_branch ? { base: report.target_branch } : {}) }),
  });
  let inputs: Pick<NextInput, "steps" | "gaps" | "context">;
  if (checkout) {
    const rec = checkoutRecord!;
    const steps: NextInput["steps"] = [], stepFms = new Map<number, StepFrontmatter>();
    for (const file of listStepFiles(rec.dir)) {
      try { const s = parseStep(file).frontmatter; steps.push({ number: s.step, title: s.title, status: s.status, file: rel(checkout, file) }); stepFms.set(s.step, s); }
      catch (e) { if (!(e instanceof SpecplaneError)) throw e; warnings.push(`Skipped ${path.basename(file)}: ${e.message}`); }
    }
    const gapsFile = path.join(rec.dir, "spec-gaps.md");
    const first = [...steps].sort((a,b) => a.number-b.number).find(s => s.status !== "done" && s.status !== "skipped");
    inputs = { steps, gaps: fs.existsSync(gapsFile) ? parseGaps(gapsFile).entries : [], context: first ? resolveContext(stepFms.get(first.number)!, ownConfig, checkout, warnings) : [] };
  } else inputs = snapshotNext(id, selected.ref, ownConfig, root, warnings);
  const local = activity.where === "local";
  let diverged = false;
  if (local && remoteBranchExists(`plan/${id}`, root)) {
    const behind = Number(tryGit(["rev-list", "--count", `plan/${id}..origin/plan/${id}`], root)?.trim());
    diverged = (activity.ahead_of_remote ?? 0) > 0 && behind > 0;
  }
  const dirty = checkout !== null && (tryGit(["status", "--porcelain"], checkout) ?? "").trim() !== "";
  const handoff = checkoutRecord && path.join(checkoutRecord.dir, "HANDOFF.md");
  const blockedIssues = handoff ? (fs.existsSync(handoff) ? fs.readFileSync(handoff, "utf8") : "")
    .split("\n").filter(line => line.includes("BLOCKED:")).map(line => line.trim().replace(/^[-*]\s+/, "")) : activity.blocked_issues;
  return computeNext({ plan: id, title: fm.title, effectiveStatus, started: activity.where !== "none", ...inputs, checkout,
    blockedIssues, warnings, restackBase: local ? mergedStackBase(id, ownConfig, root, report.target_branch ?? undefined) : null, diverged, dirty });
}

/** Human summary of a `PlanNext`. */
export function formatNext(n: PlanNext): string {
  const lines = [`${n.plan}  ${n.title}  (${n.effectiveStatus})`];
  lines.push(n.step ? `Next step: ${String(n.step.number).padStart(2, "0")} ${n.step.title} (${n.step.status})` : "Next step: none");
  if (n.step) lines.push(`  ${n.step.file}`);
  lines.push(`Checkout: ${n.checkout ?? "none"}`);
  if (n.context.length > 0) {
    lines.push("Context:");
    for (const c of n.context) lines.push(`  ${c.kind} ${c.id}${c.path ? ` -> ${c.path}${c.anchor ? `#${c.anchor}` : ""}` : " (unresolved)"}`);
  }
  if (n.openGaps.length > 0) lines.push(`Open gaps: ${n.openGaps.map((g) => `${g.id} (${g.kind})`).join(", ")}`);
  for (const a of n.attention) lines.push(`Attention: ${a.kind} - ${a.message}`);
  for (const w of n.warnings) lines.push(`Warning: ${w}`);
  lines.push(`Action: ${n.action}`, `Reason: ${n.reason}`);
  return `${lines.join("\n")}\n`;
}
