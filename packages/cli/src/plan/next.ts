import * as fs from "node:fs";
import * as path from "node:path";
import { listAdrs } from "../decisions/parse.js";
import { GitError, PlanNotFoundError, SpecplaneError } from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { hasOpenPR } from "../git/forge.js";
import { run } from "../git/exec.js";
import { resolveSpecId } from "../spec/resolve.js";
import { findHeading } from "../spec/slug.js";
import type { Config, PlanFrontmatter, StepFrontmatter } from "../types.js";
import { getPlanActivity } from "./activity.js";
import { mergedStackBase } from "./flows.js";
import { parseGaps, type GapEntry } from "./gaps.js";
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
  const done = i.effectiveStatus === "done" || i.effectiveStatus === "abandoned";

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
    reason = `Plan is ${i.effectiveStatus}.`;
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
      const adr = m ? listAdrs(config, base).find((a) => a.number === m[1]) : undefined;
      if (!adr) warnings.push(`Context decision \`${item.decision}\` does not resolve to an ADR.`);
      out.push({ kind: "decision", id: item.decision, path: adr ? rel(base, adr.file) : null, anchor: null });
    } else {
      const exists = fs.existsSync(path.join(base, item.file));
      if (!exists) warnings.push(`Context file \`${item.file}\` does not exist.`);
      out.push({ kind: "file", id: item.file, path: exists ? item.file : null, anchor: null });
    }
  }
  return out;
}

/**
 * `specplane plan next <id>` (`architecture/reference-cli` § Plan next). Read-only: reads files and
 * runs read-only git queries, never fetches, writes, or spawns. `root` is the checkout the command runs in.
 */
export function planNext(id: string, config: Config, root: string): PlanNext {
  const activity = getPlanActivity(id, config, root);
  // The plan's own checkout holds the current step statuses; fall back to the invoking checkout.
  const base = activity.checkout ?? root;
  const warnings: string[] = [];

  const records = listPlans(config, base);
  const parsed: PlanFrontmatter[] = [];
  for (const rec of records) {
    try {
      parsed.push(parsePlan(rec.dir).frontmatter);
    } catch (e) {
      if (!(e instanceof SpecplaneError)) throw e;
      if (rec.id === id) throw e;
    }
  }
  const fm = parsed.find((p) => p.id === id);
  const rec = records.find((r) => r.id === id);
  if (!fm || !rec) throw new PlanNotFoundError(id);
  const byId = new Map(parsed.map((p) => [p.id, p]));
  const effectiveStatus = getEffectiveStatus(fm, byId, config, {
    branchExists: (pid) => branchExists(`plan/${pid}`, root) || remoteBranchExists(`plan/${pid}`, root),
    hasOpenPr: (pid) => hasOpenPR(`plan/${pid}`, { cwd: root, forge: config.plans.forge }),
  });

  const steps: NextInput["steps"] = [];
  const stepFms = new Map<number, StepFrontmatter>();
  for (const file of listStepFiles(rec.dir)) {
    try {
      const s = parseStep(file).frontmatter;
      steps.push({ number: s.step, title: s.title, status: s.status, file: rel(base, file) });
      stepFms.set(s.step, s);
    } catch (e) {
      if (!(e instanceof SpecplaneError)) throw e;
      warnings.push(`Skipped ${path.basename(file)}: ${e.message}`);
    }
  }

  const gapsFile = path.join(rec.dir, "spec-gaps.md");
  const gaps = fs.existsSync(gapsFile) ? parseGaps(gapsFile).entries : [];

  const first = [...steps].sort((a, b) => a.number - b.number).find((s) => s.status !== "done" && s.status !== "skipped");
  const context = first ? resolveContext(stepFms.get(first.number)!, config, base, warnings) : [];

  const local = activity.where === "local";
  let diverged = false;
  if (local && remoteBranchExists(`plan/${id}`, root)) {
    const behind = Number(tryGit(["rev-list", "--count", `plan/${id}..origin/plan/${id}`], root)?.trim());
    diverged = (activity.ahead_of_remote ?? 0) > 0 && behind > 0;
  }
  const dirty = activity.checkout !== null && (tryGit(["status", "--porcelain"], activity.checkout) ?? "").trim() !== "";
  const restackBase = local ? mergedStackBase(id, config, root) : null;

  return computeNext({
    plan: id,
    title: fm.title,
    effectiveStatus,
    started: activity.where !== "none",
    steps,
    context,
    checkout: activity.checkout,
    blockedIssues: activity.blocked_issues,
    gaps,
    warnings,
    restackBase,
    diverged,
    dirty,
  });
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
