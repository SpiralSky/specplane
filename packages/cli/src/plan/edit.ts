import * as fs from "node:fs";
import * as path from "node:path";
import { dumpYaml } from "../yaml.js";
import { splitFrontmatter } from "../spec/frontmatter.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject } from "../spec/project.js";
import { committedSource, worktreeSource, type Source } from "../spec/source.js";
import { planAuthor } from "./create.js";
import { branchExists, commitPaths, gitTry, guardedWith, plansDir, worktreeOf, PlanOpError, planSlug, requirePlan, type PlanCtx } from "./ctx.js";
import { MAX_PLAN_ID, PLAN_ID_RE, STEP_FILE_RE, findPlan, loadPlans, readPlan } from "./model.js";
import { ensureWorktree } from "./run.js";
import { validatePlanRecords } from "./validate.js";

/** Paths are relative to the plan folder. `before: null` adds a file; `after: null` removes it. */
export interface PlanChange { path: string; before: string | null; after: string | null }
export interface EditPlanOpts { changes: PlanChange[] }

/** Shape validation is shared with request acceptance; current-state validation still runs on execution. */
export function validateEditParams(id: unknown, changes: unknown): asserts changes is PlanChange[] {
  if (typeof id !== "string" || !PLAN_ID_RE.test(id) || id.length > MAX_PLAN_ID) throw new PlanOpError("Invalid plan ID.");
  if (!Array.isArray(changes) || !changes.length) throw new PlanOpError("A plan edit needs a non-empty changes list.");
  const seen = new Set<string>();
  for (const c of changes) {
    if (!c || typeof c !== "object" || typeof c.path !== "string" ||
      !(c.path === "PLAN.md" || /^steps\/\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(c.path)) ||
      ![c.before, c.after].every((v) => v === null || typeof v === "string") ||
      c.before === c.after || (c.path === "PLAN.md" && c.after === null) || seen.has(c.path)) {
      throw new PlanOpError("Plan edits need unique PLAN.md or steps/NN-slug.md paths, and different before/after text (null means absent).");
    }
    seen.add(c.path);
  }
}

/** Refuse symlinks even within the plan: an edit must never follow them out of the checkout. */
function assertOrdinaryPath(root: string, rel: string): void {
  let abs = root;
  for (const part of rel.split("/")) {
    abs = path.join(abs, part);
    try { if (fs.lstatSync(abs).isSymbolicLink()) throw new PlanOpError(`Cannot edit symlink path ${rel}.`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}

/** Core harness operation; no human CLI command is implied (plan metadata CLI is a later release). */
export function editPlan(ctx: PlanCtx, id: string, o: EditPlanOpts): { commit: string; files: string[] } {
  validateEditParams(id, o.changes);
  return guardedWith({ id, changes: o.changes }, ctx, "plan edit", [id], ["plan.edit"], "Editing a plan", () => {
    // A started plan whose worktree is gone lives only on its branch: recreate the worktree so the edit commits there.
    if (!worktreeOf(ctx.root, id) && branchExists(ctx.root, `plan/${id}`)) {
      const onBranch = findPlan(committedSource(ctx.root, `plan/${id}`), plansDir(ctx.root), id);
      if (onBranch && !onBranch.legacy && onBranch.progress) ensureWorktree(ctx, id, onBranch.progress.branch ?? `plan/${id}`);
    }
    const { root, rec } = requirePlan(ctx, id);
    if (rec.archived || ["completed", "abandoned"].includes(rec.progress!.status)) throw new PlanOpError("An archived or finished plan cannot be edited.");
    // Refuse rather than absorb existing edits into the command's commit, including untouched plan files.
    if ((gitTry(root, ["status", "--porcelain", "--", rec.planFile, `${rec.dir}/steps`, rec.progressFile, rec.handoffFile]) ?? "").trim()) {
      throw new PlanOpError("The plan, steps, progress.yaml or HANDOFF.md have uncommitted changes; commit or restore them before editing.");
    }
    const source = worktreeSource(root);
    const edits = new Map<string, string | null>();
    const started = new Set([...rec.progress!.done, ...rec.handoff.map((e) => e.step)]);
    // Conservative boundary: current_step may only be preselected after step-done, but there is no durable
    // step-start event yet. Freeze it too so an active step without a handoff can never be changed.
    if (rec.progress!.status !== "not-started") started.add(rec.progress!.current_step ?? 1);
    // Any later step may already have partial work recorded in the handoff; its original path and text are immutable.
    for (const c of o.changes) {
      const rel = `${rec.dir}/${c.path}`;
      assertOrdinaryPath(root, rel);
      if (source.read(rel) !== c.before) throw new PlanOpError(`${c.path} no longer matches the proposed edit's before text.`);
      if (c.path.startsWith("steps/")) {
        const n = Number(STEP_FILE_RE.exec(path.posix.basename(c.path))![1]);
        if (started.has(n)) throw new PlanOpError(`Step ${n} has started; record deviations in HANDOFF.md and edit only later steps.`);
      }
      if (c.after !== null) {
        const fm = splitFrontmatter(c.after);
        if (!fm.data) throw new PlanOpError(`${c.path}: ${fm.error}`);
        for (const key of ["status", "approval", "progress", "done", "current_step", "session", "stop", "final_review"]) {
          if (key in fm.data) throw new PlanOpError(`${c.path}: execution or approval field ${key} cannot be edited.`);
        }
      }
      edits.set(rel, c.after);
    }
    // Preserve existing authors; the executing actor is added using the same convention as plan creation.
    const plan = edits.get(rec.planFile) ?? rec.planText!;
    const fm = splitFrontmatter(plan);
    if (!fm.data || !Array.isArray(fm.data.authors)) throw new PlanOpError("PLAN.md needs valid frontmatter and an authors list.");
    const original = rec.fm?.data?.authors;
    if (Array.isArray(original) && original.some((a) => !(fm.data!.authors as unknown[]).some((b: unknown) => JSON.stringify(a) === JSON.stringify(b)))) {
      throw new PlanOpError("Existing plan authors must be preserved.");
    }
    const author = planAuthor({ ...ctx, root });
    if (!(fm.data.authors as unknown[]).some((a) => JSON.stringify(a) === JSON.stringify(author))) {
      (fm.data.authors as unknown[]).push(author);
      edits.set(rec.planFile, `---\n${dumpYaml(fm.data)}---\n${fm.body}`);
    }
    const projected: Source = {
      ...source,
      read: (file) => edits.has(file) ? edits.get(file)! : source.read(file),
      list: (dir) => [...new Set([...source.list(dir), ...[...edits.keys()].filter((f) => path.posix.dirname(f) === dir).map((f) => path.posix.basename(f))])]
        .filter((name) => !edits.has(`${dir}/${name}`) || edits.get(`${dir}/${name}`) !== null).sort(),
    };
    const next = readPlan(projected, path.posix.dirname(rec.dir), id, false);
    const all = loadPlans(source, path.posix.dirname(rec.dir)).map((p) => p.id === id ? next : p);
    const issues: string[] = [];
    validatePlanRecords(all, loadProject(projected, loadSpecPaths(root).paths), null, (severity, _rule, message) => {
      if (severity === "error") issues.push(message);
    }, new Set([id]));
    if (issues.length) throw new PlanOpError(`Invalid plan edit:\n${issues.join("\n")}`);
    const files = [...edits.keys()];
    for (const [file, text] of edits) {
      assertOrdinaryPath(root, file);
      if (text === null) fs.unlinkSync(path.join(root, file));
      else { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
    }
    const commit = commitPaths(ctx, root, files, { type: "docs", scope: planSlug(id), summary: "edit plan", workflow: "plan-edit", planId: id });
    return { commit, files };
  });
}
