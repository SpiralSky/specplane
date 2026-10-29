import * as fs from "node:fs";
import * as path from "node:path";
import { AmbiguousIdError, GitError, PlanNotFoundError, PlanStateError, SetupHookError, SpecNotFoundError, UnknownRootError } from "../errors.js";
import { branchExists, createBranch, remoteBranchExists } from "../git/branch.js";
import { cliTrailers, findLatest, formatMessage, readTrailers } from "../git/commit.js";
import { run } from "../git/exec.js";
import { defaultBranch, mainRoot } from "../git/repo.js";
import { createWorktree, listWorktrees, removeWorktree } from "../git/worktree.js";
import { TYPE_DIRS } from "../spec/resolve.js";
import type { Config, PlanStatus } from "../types.js";
import { fetchPlanBranches, getPlanActivity, hasRemote, lenientFrontmatter, showFile } from "./activity.js";
import { runSetupHook } from "./hooks.js";

export interface StartResult {
  planId: string;
  branch: string;
  backend: Config["execution"]["backend"];
  /** True when `plan/<id>` already existed. */
  resumed: boolean;
  /** Worktree path (worktree backend), otherwise null. */
  path: string | null;
  next: { number: number; title: string; status: string } | null;
  /** Messages for stderr (e.g. the base plan has merged). */
  notices: string[];
}

interface PlanAt {
  title: string;
  status: PlanStatus;
  specs: string[];
  depends_on: string[];
}

function tryRun(args: string[], cwd: string): string | null {
  try {
    return run("git", args, { cwd });
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
}

/** Plan frontmatter at `ref` (active, then archived); null when absent or malformed. */
function planAt(ref: string, id: string, config: Config, cwd: string): PlanAt | null {
  for (const dir of [`${config.plans.dir}/${id}`, `${config.plans.dir}/archive/${id}`]) {
    const text = showFile(ref, `${dir}/PLAN.md`, cwd);
    if (text === null) continue;
    const d = lenientFrontmatter(text);
    if (!d || d.id !== id || typeof d.status !== "string") return null;
    return {
      title: String(d.title ?? id),
      status: d.status as PlanStatus,
      specs: Array.isArray(d.specs) ? d.specs.map(String) : [],
      depends_on: Array.isArray(d.depends_on) ? d.depends_on.map(String) : [],
    };
  }
  return null;
}

/** Status of a spec at `ref`, resolved without root context (`root:id` pins a root). */
function specStatusAt(rawId: string, config: Config, ref: string, cwd: string): { id: string; status: string } {
  let id = rawId.split("#")[0];
  let roots = config.spec_roots;
  const colon = id.indexOf(":");
  if (colon !== -1) {
    const name = id.slice(0, colon);
    id = id.slice(colon + 1);
    roots = roots.filter((r) => r.name === name);
    if (roots.length === 0) throw new UnknownRootError(name);
  }
  const [type, ...rest] = id.split("/");
  const dir = TYPE_DIRS[type];
  if (!dir || rest.length === 0) throw new SpecNotFoundError(id);
  const hits = roots
    .map((r) => ({ root: r.name, text: showFile(ref, `${r.path}/${dir}/${rest.join("/")}.md`, cwd) }))
    .filter((h) => h.text !== null);
  if (hits.length === 0) throw new SpecNotFoundError(id);
  if (hits.length > 1) throw new AmbiguousIdError(id, hits.map((h) => h.root));
  return { id, status: String(lenientFrontmatter(hits[0].text!)?.status ?? "unknown") };
}

/** Ref of the default branch tip: the local branch, or `origin/<default>` when that is strictly ahead. */
function defaultTip(def: string, cwd: string): string {
  if (!remoteBranchExists(def, cwd)) return def;
  if (!branchExists(def, cwd)) return `origin/${def}`;
  const behind = tryRun(["merge-base", "--is-ancestor", def, `origin/${def}`], cwd) !== null;
  const same = tryRun(["rev-parse", def], cwd)?.trim() === tryRun(["rev-parse", `origin/${def}`], cwd)?.trim();
  return behind && !same ? `origin/${def}` : def;
}

function revParse(ref: string, cwd: string): string {
  return run("git", ["rev-parse", `${ref}^{commit}`], { cwd }).trim();
}

const STARTED = new Set<string>(["ready", "in_progress", "review"]);

/**
 * `specplane plan start <id>` (feature/plan-execution § Start flow). All checks run before the first
 * write; `root` is the checkout the command runs in.
 */
export function startPlan(id: string, config: Config, root: string): StartResult {
  const main = mainRoot(root);
  const def = defaultBranch(main);
  const remote = hasRemote(main);
  if (remote) {
    run("git", ["fetch", "origin", def], { cwd: main });
    fetchPlanBranches(main);
  }
  const branch = `plan/${id}`;
  const localBranch = branchExists(branch, main);
  const remoteOnly = !localBranch && remoteBranchExists(branch, main);
  const first = !localBranch && !remoteOnly;
  const tip = defaultTip(def, main);
  const planPath = `${config.plans.dir}/${id}/PLAN.md`;

  const plan =
    planAt(tip, id, config, main) ??
    (first ? null : planAt(localBranch ? branch : `origin/${branch}`, id, config, main));
  if (!plan) throw new PlanNotFoundError(id);

  // 1. Validate (no writes).
  const frontmatterMode = config.plans.status_source === "frontmatter";
  const startable = plan.status === "ready" || (!first && frontmatterMode && (plan.status === "in_progress" || plan.status === "review"));
  if (!startable) throw new PlanStateError(`Cannot start plan: \`${id}\` is \`${plan.status}\`, not \`ready\`.`);

  let stackBase: string | null = null;
  if (first) {
    const unmerged: string[] = [];
    for (const dep of plan.depends_on) {
      if (planAt(tip, dep, config, main)?.status !== "done") unmerged.push(dep);
    }
    if (config.plans.dependency_mode === "wait_for_merge") {
      if (unmerged.length > 0) throw new PlanStateError(`Cannot start plan: dependency \`${unmerged[0]}\` is not done.`);
    } else if (unmerged.length > 1) {
      throw new PlanStateError(`Cannot stack on more than one unmerged dependency: ${unmerged.map((u) => `\`${u}\``).join(", ")}.`);
    } else if (unmerged.length === 1) {
      const dep = unmerged[0];
      const depPlan = planAt(tip, dep, config, main);
      const depBranch = `plan/${dep}`;
      const hasBranch = branchExists(depBranch, main) || remoteBranchExists(depBranch, main);
      if (!depPlan || !STARTED.has(depPlan.status) || !hasBranch) {
        throw new PlanStateError(`Cannot start plan: dependency \`${dep}\` has not been started.`);
      }
      stackBase = branchExists(depBranch, main) ? depBranch : `origin/${depBranch}`;
    }

    const policy = config.plans.require_approved_specs;
    if (policy !== "none") {
      for (const raw of plan.specs) {
        const s = specStatusAt(raw, config, tip, main);
        if (policy === "feature" && !s.id.startsWith("feature/")) continue;
        if (s.status !== "approved") throw new PlanStateError(`Cannot start plan: \`${s.id}\` is \`${s.status}\`, not \`approved\`.`);
      }
    }

    if (frontmatterMode) {
      const cur = tryRun(["rev-parse", "--abbrev-ref", "HEAD"], main)?.trim();
      if (cur !== def) {
        throw new PlanStateError(`Cannot claim plan \`${id}\`: the main checkout is on \`${cur}\`, not \`${def}\`. Switch to \`${def}\` and run start again.`);
      }
      if ((tryRun(["status", "--porcelain", "--", planPath], main) ?? "").trim() !== "") {
        throw new PlanStateError(`Cannot claim plan \`${id}\`: \`${planPath}\` has uncommitted changes in the main checkout. Commit or discard them and run start again.`);
      }
    }
  }
  if (config.execution.backend === "branch" && (tryRun(["status", "--porcelain"], main) ?? "").trim() !== "") {
    throw new PlanStateError("Cannot start plan: the working tree has uncommitted changes. Commit or stash them first.");
  }

  // 2. Write.
  if (first) {
    if (frontmatterMode) claimPlan(id, planPath, def, remote, main);
    let from: string;
    if (stackBase) {
      const baseSha = revParse(stackBase, main);
      const baseId = stackBase.replace(/^(origin\/)?plan\//, "");
      const msg = formatMessage({
        type: "chore",
        scope: "specplane",
        summary: `stack ${id} on ${baseId}`,
        trailers: { ...cliTrailers("stack", id), "Specplane-Stack-Base": baseSha },
      });
      from = run("git", ["commit-tree", `${baseSha}^{tree}`, "-p", baseSha, "-F", "-"], { cwd: main, input: msg }).trim();
    } else {
      from = frontmatterMode ? def : tip;
    }
    createBranch(branch, from, main);
  } else if (remoteOnly) {
    run("git", ["branch", "--track", branch, `origin/${branch}`], { cwd: main });
  }

  const notices: string[] = [];
  if (!first) {
    const marker = findLatest(branch, "stack", main);
    if (marker) {
      const subject = run("git", ["log", "-1", "--format=%s", marker], { cwd: main }).trim();
      const baseId = /^chore\(specplane\): stack \S+ on (\S+)$/.exec(subject)?.[1];
      if (baseId && planAt(tip, baseId, config, main)?.status === "done" && readTrailers(marker, main).has("Specplane-Stack-Base")) {
        notices.push(`Base plan \`${baseId}\` has merged; run \`specplane plan restack ${id}\`.`);
      }
    }
  }

  let checkout: string | null = null;
  const backend = config.execution.backend;
  if (backend === "worktree") {
    const existed = listWorktrees(main).some((w) => w.branch === branch);
    checkout = createWorktree(id, branch, config, main);
    const hook = config.plans.setup_hook;
    if (!existed && hook.trim() !== "") {
      try {
        runSetupHook(hook, checkout);
      } catch (e) {
        if (e instanceof SetupHookError) removeWorktree(id, config, { force: true }, main);
        throw e;
      }
    }
  } else if (backend === "branch") {
    run("git", ["switch", branch], { cwd: main });
  }

  const next = getPlanActivity(id, config, main).steps.next;
  return { planId: id, branch, backend, resumed: !first, path: checkout, next, notices };
}

/** Claim commit on the default branch (architecture/reference-cli § Claim commits): sets `status: in_progress`. */
function claimPlan(id: string, planPath: string, def: string, remote: boolean, main: string): void {
  const file = path.join(main, planPath);
  const text = fs.readFileSync(file, "utf8");
  const end = text.indexOf("\n---", 3);
  const head = text.slice(0, end).replace(/^status:.*$/m, "status: in_progress");
  fs.writeFileSync(file, head + text.slice(end));
  const msg = formatMessage({
    type: "chore",
    scope: "specplane",
    summary: `claim ${id} in_progress`,
    trailers: cliTrailers("claim", id),
  });
  run("git", ["commit", "-F", "-", "--", planPath], { cwd: main, input: msg });
  if (remote) run("git", ["push", "origin", def], { cwd: main });
}
