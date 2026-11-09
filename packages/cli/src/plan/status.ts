import { parseCite } from "../spec/cites.js";
import { planFingerprint } from "../spec/fingerprint.js";
import { resolveCite, targetFingerprint, type Project } from "../spec/project.js";
import { CommitProjects, computeStatus } from "../spec/status.js";
import { headCommit, worktreeSource } from "../spec/source.js";
import { runIsLive, committedProject, loadPlanAt, plansDir, type PlanCtx } from "./ctx.js";
import { loadPlans, planReferences, stepNumbers, stepTitle, type ExecStatus, type PlanRecord } from "./model.js";

/** Effective plan status and the next step (`architecture/reference-cli` §11.2). */

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface PlanApproval { status: "approved" | "awaiting-review"; reasons: string[] }

/** Effective approval of a plan, from committed content: stored approved, same `plan-v1` content, cited parts unchanged. */
export function planApproval(project: Project, rec: PlanRecord): PlanApproval {
  const d = rec.fm?.data;
  if (!d || d.status !== "approved" || !isMap(d.approval)) return { status: "awaiting-review", reasons: ["never-approved"] };
  const a = d.approval;
  const reasons: string[] = [];
  if (rec.planText && typeof a.fingerprint === "string" && planFingerprint(rec.planText) !== a.fingerprint) reasons.push("edited");
  const cited = isMap(a.cited) ? a.cited : {};
  for (const raw of planReferences(rec.fm)) {
    const cite = parseCite(raw);
    if (!cite) continue;
    const res = resolveCite(project, cite);
    if (!res.ok) continue;
    const exp = cited[raw];
    if (typeof exp === "string" && exp !== targetFingerprint(res.target)) reasons.push(`outdated: ${raw}`);
  }
  return { status: reasons.length ? "awaiting-review" : "approved", reasons };
}

/** Effective approval of a spec at a project snapshot. */
export function specApproved(root: string, project: Project, id: string): boolean {
  const doc = project.specs.get(id);
  if (!doc || !doc.fm.data) return false;
  return computeStatus(project, doc, new CommitProjects(root, project)).status === "approved";
}

export interface StepInfo { number: number; title: string; done: boolean; waiting: string | null }

export interface PlanInfo {
  id: string;
  title: string;
  archived: boolean;
  legacy: boolean;
  approval: "approved" | "awaiting-review";
  stored: string;
  /** Status after the unexpected-end rule. */
  status: ExecStatus | string;
  stop: { kind?: string; reason?: string; needs?: string } | null;
  stepsTotal: number;
  stepsDone: number;
  steps: StepInfo[];
  next: StepInfo | null;
  /** Every step is done and the plan is waiting for the final review. */
  reviewPending: boolean;
  branch: string | null;
  target: string | null;
  location: string;
}

/**
 * Describe a plan read from checkout `root`. `in-progress` with no live run marker is reported `stopped` with the
 * reason `session ended unexpectedly`, without rewriting the file, unless every step is done (`plan-execution R27`).
 */
export function describePlan(ctx: PlanCtx, root: string, rec: PlanRecord): PlanInfo {
  const pr = rec.progress;
  const done = new Set(pr?.done ?? []);
  let project: Project | null = null;
  try { if (headCommit(root)) project = committedProject(root); } catch { project = null; }
  const steps: StepInfo[] = stepNumbers(rec).map((n) => {
    const s = rec.steps.find((x) => x.number === n)!;
    let waiting: string | null = null;
    if (!done.has(n) && project) {
      const impl = Array.isArray(s.fm.data?.implements) ? (s.fm.data!.implements as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const bad = impl.filter((id) => !specApproved(root, project!, id));
      if (bad.length) waiting = `waiting for approval of ${bad.join(", ")}`;
    }
    return { number: n, title: stepTitle(s), done: done.has(n), waiting };
  });
  const next = steps.find((s) => !s.done) ?? null;
  let status: string = pr?.status ?? "unknown";
  let stop = pr?.stop ? { ...pr.stop } : null;
  const reviewPending = status === "in-progress" && next === null && steps.length > 0;
  if (status === "in-progress" && next !== null && !runIsLive(ctx.root, rec.id, ctx.now)) {
    status = "stopped";
    stop = { kind: "failure", reason: "session ended unexpectedly", needs: "resume the plan" };
  }
  const approval = project ? planApproval(project, rec).status : "awaiting-review";
  const title = typeof rec.fm?.data?.title === "string" ? (rec.fm.data.title as string) : rec.id;
  return {
    id: rec.id, title, archived: rec.archived, legacy: rec.legacy, approval, stored: pr?.status ?? "", status, stop,
    stepsTotal: steps.length, stepsDone: steps.filter((s) => s.done).length, steps, next, reviewPending,
    branch: pr?.branch ?? null, target: pr?.target_branch ?? null, location: root,
  };
}

/** Selection check: the first step must be the next step; a waiting step ends the selection (`plan-execution R27`). */
export function checkSelection(info: PlanInfo, from: number | null, count: number | "all"): { ok: boolean; steps: StepInfo[]; message: string } {
  const next = info.next;
  if (!next) return { ok: false, steps: [], message: "Every step is done; the final review is next." };
  if (from !== null && from !== next.number) {
    return { ok: false, steps: [], message: `Denied: step ${String(from).padStart(2, "0")} cannot run before step ${String(next.number).padStart(2, "0")} ${next.title}, which comes first.` };
  }
  const todo = info.steps.filter((s) => !s.done);
  const wanted = count === "all" ? todo : todo.slice(0, count);
  const out: StepInfo[] = [];
  for (const s of wanted) {
    if (s.waiting) { if (out.length === 0) return { ok: false, steps: [], message: `Step ${String(s.number).padStart(2, "0")} ${s.title} is ${s.waiting}; the plan stops here.` }; break; }
    out.push(s);
  }
  return { ok: true, steps: out, message: `Selected: ${out.map((s) => String(s.number).padStart(2, "0")).join(", ")}` };
}

/** Plans of the checkout the command runs in, each read from its own live checkout when `live` (`reference-cli` §11.2). */
export function listInfos(ctx: PlanCtx, live: boolean, resolveRoot: (id: string) => string): PlanInfo[] {
  const dir = plansDir(ctx.root);
  const out: PlanInfo[] = [];
  const base = loadPlans(worktreeSource(ctx.root), dir);
  for (const rec of base) {
    const root = live && !rec.archived ? resolveRoot(rec.id) : ctx.root;
    const own = root === ctx.root ? rec : loadPlanAt(root, rec.id) ?? rec;
    if (own.legacy) { out.push(describeLegacy(own, root)); continue; }
    out.push(describePlan(ctx, root, own));
  }
  return out;
}

function describeLegacy(rec: PlanRecord, root: string): PlanInfo {
  return { id: rec.id, title: typeof rec.fm?.data?.title === "string" ? (rec.fm.data.title as string) : rec.id, archived: rec.archived, legacy: true, approval: "awaiting-review", stored: "", status: "legacy", stop: null, stepsTotal: 0, stepsDone: 0, steps: [], next: null, reviewPending: false, branch: null, target: null, location: root };
}

