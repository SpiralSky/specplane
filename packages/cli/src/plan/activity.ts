import * as path from "node:path";
import matter from "gray-matter";
import * as yaml from "js-yaml";
import { GitError } from "../errors.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { findLatest, readTrailers } from "../git/commit.js";
import { run } from "../git/exec.js";
import { defaultBranch } from "../git/repo.js";
import { resolvePlanContext, type PlanBranchSnapshot } from "./context.js";
import * as fs from "node:fs";
import { mergedPRCommit } from "../git/forge.js";
import { PlanStateError } from "../errors.js";
import { listWorktrees } from "../git/worktree.js";
import type { Config } from "../types.js";

/** Plan activity fields (`architecture/reference-cli` § Plan activity); key names are consumed by harness views. */
export interface PlanActivity {
  branch: string | null;
  backend: Config["execution"]["backend"];
  where: "local" | "remote" | "none";
  checkout: string | null;
  steps: {
    total: number;
    done: number;
    skipped: number;
    blocked: number;
    next: { number: number; title: string; status: string } | null;
  };
  blocked_issues: string[];
  last_step_commit: { sha: string; time: string; step: number | null; agent: string | null; session: string | null } | null;
  ahead_of_remote: number | null;
}

/** Run git, returning null instead of throwing on a git failure. */
function tryGit(args: string[], cwd: string): string | null {
  try {
    return run("git", args, { cwd });
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

export function hasRemote(cwd: string): boolean {
  return (tryGit(["remote"], cwd) ?? "").split("\n").includes("origin");
}

/** Fetch plan branches from origin once; false when skipped or failed (never throws on git errors). */
export function fetchPlanBranches(cwd: string): boolean {
  if (!hasRemote(cwd)) return false;
  return tryGit(["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"], cwd) !== null;
}

export function localPlanIds(cwd: string): string[] {
  return (tryGit(["for-each-ref", "--format=%(refname:strip=3)", "refs/heads/plan/"], cwd) ?? "").split("\n").filter(Boolean);
}

export function planTextAt(ref: string, id: string, config: Config, cwd: string): string | null {
  return showFile(ref, `${config.plans.dir}/${id}/PLAN.md`, cwd) ?? showFile(ref, `${config.plans.dir}/archive/${id}/PLAN.md`, cwd);
}

export interface PlanReport {
  target_branch: string | null; start_base: string | null; comparison_base: string | null;
  plan_branch_status: string | null; target_status: string | null;
  integration_status: "integrated" | "not_integrated" | "unverifiable";
  integration_reasons: string[]; pending_target_branch: string | null;
  ref_freshness: { fetch: "fetched" | "local" | "failed"; plan_local: string | null; plan_remote: string | null; target_local: string | null; target_remote: string | null };
}

/** Read committed provenance even if the target is unavailable; never impose start preconditions. */
export function planReport(id: string, config: Config, cwd: string, fallback: Record<string, unknown> | null, fetch: PlanReport["ref_freshness"]["fetch"] = "local"): PlanReport {
  const oid = (ref: string) => tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd)?.trim() || null;
  const local = oid(`refs/heads/plan/${id}`), remote = oid(`refs/remotes/origin/plan/${id}`);
  const read = (ref: string | null) => { const text = ref ? planTextAt(ref, id, config, cwd) : null; return text === null ? null : lenientFrontmatter(text); };
  const l = read(local), r = read(remote);
  const snapshot = (sha: string, data: Record<string, unknown> | null): PlanBranchSnapshot => ({ commit: sha, id: String(data?.id ?? ""), binding: data?.execution as PlanBranchSnapshot["binding"], comparisonBase: data?.comparison_base as string | undefined });
  const report: PlanReport = { target_branch: null, start_base: null, comparison_base: null, plan_branch_status: null, target_status: null, integration_status: "unverifiable", integration_reasons: [], pending_target_branch: null, ref_freshness: { fetch, plan_local: local, plan_remote: remote, target_local: null, target_remote: null } };
  const remoteAhead = !!(local && remote && local !== remote && tryGit(["merge-base", "--is-ancestor", local, remote], cwd) !== null);
  let selected = remoteAhead ? r : local ? l : remote ? r : fallback;
  try {
    if ((local && !l) || (remote && !r)) throw new Error("Plan branch record is unavailable.");
    const context = resolvePlanContext(cwd, { id, ...(local || remote ? { planBranches: { ...(local ? { local: snapshot(local, l) } : {}), ...(remote ? { remote: snapshot(remote, r) } : {}) } } : { declared: fallback?.target_branch as string | undefined, team: config.plans.target_branch, comparisonBase: fallback?.comparison_base as string | undefined }) });
    report.target_branch = context.targetBranch;
    report.start_base = context.binding?.start_base ?? null;
    report.comparison_base = context.comparisonBase;
  } catch (e) {
    if (/Divergent plan branches|Conflicting plan branch|provenance changed|binding was removed|target history changed|Original execution provenance changed|identity/i.test((e as Error).message)) throw new PlanStateError((e as Error).message);
    report.integration_reasons.push((e as Error).message);
    // Recorded values remain useful even when the corresponding refs are unavailable.
    const binding = selected?.execution as { target_branch?: string; start_base?: string } | undefined;
    report.target_branch = binding?.target_branch ?? null;
    report.start_base = binding?.start_base ?? null;
    report.comparison_base = typeof selected?.comparison_base === "string" ? selected.comparison_base : null;
  }
  report.plan_branch_status = local || remote ? (typeof selected?.status === "string" ? selected.status : null) : null;
  if (report.target_branch) {
    const target = report.target_branch;
    const tl = oid(`refs/heads/${target}`), tr = oid(`refs/remotes/origin/${target}`);
    report.ref_freshness.target_local = tl; report.ref_freshness.target_remote = tr;
    let tip = tl ?? tr;
    if (tl && tr && tl !== tr) {
      if (tryGit(["merge-base", "--is-ancestor", tl, tr], cwd) !== null) tip = tr;
      else if (tryGit(["merge-base", "--is-ancestor", tr, tl], cwd) === null) tip = null;
    }
    const targetData = read(tip);
    report.target_status = typeof targetData?.status === "string" ? targetData.status : null;
    if (tip && (local || remote) && report.integration_reasons.length === 0) {
      const planTip = remoteAhead ? remote! : local ?? remote!;
      if (tryGit(["merge-base", "--is-ancestor", planTip, tip], cwd) !== null && report.target_status === "done") {
        report.integration_status = "integrated"; report.integration_reasons.push("Plan branch is contained in the target and its target record is done.");
      } else if (report.target_status === "done" && (() => { const merge = mergedPRCommit(`plan/${id}`, target, planTip, { cwd, forge: config.plans.forge }); return !!merge && tryGit(["merge-base", "--is-ancestor", merge, tip!], cwd) !== null; })()) {
        report.integration_status = "integrated"; report.integration_reasons.push("A merged pull request identifies this exact plan head and target, and its merge commit is contained in the target.");
      } else if (report.target_status === "done" || tryGit(["rev-parse", "--is-shallow-repository"], cwd)?.trim() === "true") {
        report.integration_reasons.push("Available history does not establish whether the done record includes the plan branch.");
      } else { report.integration_status = "not_integrated"; report.integration_reasons.push("Target does not contain both the plan branch and a done record."); }
    }
  }
  if (!report.integration_reasons.length) report.integration_reasons.push("Integration evidence is unavailable.");
  const checkout = local ? listWorktrees(cwd).find(w => w.branch === `plan/${id}`)?.path : null;
  if (checkout) {
    for (const file of [`${config.plans.dir}/${id}/PLAN.md`, `${config.plans.dir}/archive/${id}/PLAN.md`]) {
      try { const data = lenientFrontmatter(fs.readFileSync(path.join(checkout, file), "utf8")); const pending = (data?.execution as { target_branch?: unknown } | undefined)?.target_branch; if (typeof pending === "string" && pending !== report.target_branch) report.pending_target_branch = pending; break; } catch { /* absent */ }
    }
  }
  return report;
}

/** Plan IDs that exist as `refs/remotes/origin/plan/<id>`. */
export function remotePlanIds(cwd: string): string[] {
  const out = tryGit(["for-each-ref", "--format=%(refname)", "refs/remotes/origin/plan/"], cwd) ?? "";
  return out
    .split("\n")
    .map((l) => l.trim().replace(/^refs\/remotes\/origin\/plan\//, ""))
    .filter((l) => l && l !== "HEAD");
}

/** Contents of `path` at `ref` (`git show <ref>:<path>`); null when absent. */
export function showFile(ref: string, file: string, cwd: string): string | null {
  return tryGit(["show", `${ref}:${file}`], cwd);
}

export function lenientFrontmatter(text: string): Record<string, unknown> | null {
  try {
    const engines = { yaml: { parse: (s: string) => yaml.load(s, { schema: yaml.JSON_SCHEMA }) as object } };
    const data = matter(text, { engines }).data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parsed `PLAN.md` frontmatter at the tip of `origin/plan/<id>`; null when unreadable or invalid. */
export function remotePlanFrontmatter(id: string, config: Config, cwd: string, ref = `origin/plan/${id}`) {
  const text = planTextAt(ref, id, config, cwd);
  const data = text === null ? null : lenientFrontmatter(text);
  if (!data || data.id !== id || typeof data.title !== "string" || typeof data.status !== "string" || !Array.isArray(data.specs)) {
    return null;
  }
  return {
    id,
    title: data.title,
    status: data.status as import("../types.js").PlanStatus,
    specs: data.specs.map(String),
    depends_on: Array.isArray(data.depends_on) ? data.depends_on.map(String) : [],
  };
}

function readSteps(ref: string, id: string, config: Config, cwd: string): PlanActivity["steps"] {
  const steps: PlanActivity["steps"] = { total: 0, done: 0, skipped: 0, blocked: 0, next: null };
  for (const dir of [`${config.plans.dir}/${id}/steps`, `${config.plans.dir}/archive/${id}/steps`]) {
    const listing = tryGit(["ls-tree", "--name-only", ref, `${dir}/`], cwd);
    if (!listing) continue;
    const files = listing.split("\n").filter((f) => /\/\d+-[^/]*\.md$/.test(f)).sort();
    for (const f of files) {
      const text = showFile(ref, f, cwd);
      const fm = text === null ? null : lenientFrontmatter(text);
      if (!fm || typeof fm.step !== "number") continue;
      const status = String(fm.status);
      steps.total++;
      if (status === "done") steps.done++;
      else if (status === "skipped") steps.skipped++;
      else {
        if (status === "blocked") steps.blocked++;
        steps.next ??= { number: fm.step, title: String(fm.title ?? path.basename(f)), status };
      }
    }
    break;
  }
  return steps;
}

function readBlockedIssues(ref: string, id: string, config: Config, cwd: string): string[] {
  const text =
    showFile(ref, `${config.plans.dir}/${id}/HANDOFF.md`, cwd) ??
    showFile(ref, `${config.plans.dir}/archive/${id}/HANDOFF.md`, cwd);
  if (!text) return [];
  return text
    .split("\n")
    .filter((l) => l.includes("BLOCKED:"))
    .map((l) => l.trim().replace(/^[-*]\s+/, ""));
}

function lastStepCommit(ref: string, cwd: string): PlanActivity["last_step_commit"] {
  let sha: string | null;
  try {
    sha = findLatest(ref, "step", cwd);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  if (!sha) return null;
  const time = tryGit(["show", "-s", "--format=%cI", sha], cwd)?.trim();
  if (!time) return null;
  const t = readTrailers(sha, cwd);
  const n = Number(t.get("Specplane-Step")?.at(-1));
  return {
    sha,
    time,
    step: Number.isInteger(n) && t.has("Specplane-Step") ? n : null,
    agent: t.get("Specplane-Agent")?.at(-1) ?? null,
    session: t.get("Specplane-Session")?.at(-1) ?? null,
  };
}

/** Activity of one plan; never throws for a missing remote, missing branch, or shallow history. */
export function getPlanActivity(id: string, config: Config, root: string, target?: string | null): PlanActivity {
  const local = branchExists(`plan/${id}`, root);
  const remote = remoteBranchExists(`plan/${id}`, root);
  const where = local ? "local" : remote ? "remote" : "none";
  const ref = local ? `plan/${id}` : remote ? `origin/plan/${id}` : null;
  const backend = config.execution.backend;

  let checkout: string | null = null;
  if (where === "local" && backend !== "external") {
    const wt = (tryGit(["worktree", "list", "--porcelain"], root) === null ? [] : listWorktrees(root)).find(
      (w) => w.branch === `plan/${id}`,
    );
    checkout = wt?.path ?? null;
  }

  const readRef = ref ?? (target && (branchExists(target, root) ? target : remoteBranchExists(target, root) ? `origin/${target}` : null)) ?? defaultBranch(root);
  let ahead: number | null = null;
  if (local && remote) {
    const n = Number(tryGit(["rev-list", "--count", `origin/plan/${id}..plan/${id}`], root)?.trim());
    ahead = Number.isInteger(n) ? n : null;
  }
  return {
    branch: ref ? `plan/${id}` : null,
    backend,
    where,
    checkout,
    steps: readSteps(readRef, id, config, root),
    blocked_issues: readBlockedIssues(readRef, id, config, root),
    last_step_commit: ref ? lastStepCommit(ref, root) : null,
    ahead_of_remote: ahead,
  };
}
