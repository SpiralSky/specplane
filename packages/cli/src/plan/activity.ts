import * as path from "node:path";
import matter from "gray-matter";
import * as yaml from "js-yaml";
import { GitError } from "../errors.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { findLatest, readTrailers } from "../git/commit.js";
import { run } from "../git/exec.js";
import { defaultBranch } from "../git/repo.js";
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
  return tryGit(["fetch", "--quiet", "origin", "refs/heads/plan/*:refs/remotes/origin/plan/*"], cwd) !== null;
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

function lenientFrontmatter(text: string): Record<string, unknown> | null {
  try {
    const engines = { yaml: { parse: (s: string) => yaml.load(s, { schema: yaml.JSON_SCHEMA }) as object } };
    const data = matter(text, { engines }).data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parsed `PLAN.md` frontmatter at the tip of `origin/plan/<id>`; null when unreadable or invalid. */
export function remotePlanFrontmatter(id: string, config: Config, cwd: string) {
  const text = showFile(`origin/plan/${id}`, `${config.plans.dir}/${id}/PLAN.md`, cwd);
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
  const n = Number(t.get("Specplane-Step"));
  return {
    sha,
    time,
    step: Number.isInteger(n) && t.has("Specplane-Step") ? n : null,
    agent: t.get("Specplane-Agent") ?? null,
    session: t.get("Specplane-Session") ?? null,
  };
}

/** Activity of one plan; never throws for a missing remote, missing branch, or shallow history. */
export function getPlanActivity(id: string, config: Config, root: string): PlanActivity {
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

  const readRef = ref ?? defaultBranch(root);
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
