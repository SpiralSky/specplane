import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { parseCite } from "../spec/cites.js";
import { planFingerprint } from "../spec/fingerprint.js";
import { editKeys } from "../spec/fm-edit.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveCite, targetFingerprint } from "../spec/project.js";
import { committedSource, worktreeSource } from "../spec/source.js";
import { AlreadyExistsError } from "../errors.js";
import { MAX_PLAN_ID, PLAN_ID_RE, findPlan, planReferences } from "./model.js";
import { PlanOpError, commitPaths, gitTry, guarded, humanName, isDirty, plansDir, planSlug, today, type PlanCtx } from "./ctx.js";
import { planApproval } from "./status.js";
import { committedProject } from "./ctx.js";

/** Create (scaffold) and approve plans (`plan-execution R31`, `architecture/reference-cli` §11.5). */

export interface CreateOpts { words: string[]; title?: string; implements?: string[]; writes?: string[]; references?: string[] }

const titleCase = (words: string[]): string => words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

export function planAuthor(ctx: PlanCtx): Record<string, string> {
  if (ctx.actor.kind === "llm") return { llm: ctx.actor.model ?? ctx.actor.name };
  return { human: humanName(ctx.root) ?? ctx.actor.name };
}

export function createPlan(ctx: PlanCtx, o: CreateOpts): { id: string; files: string[]; commit: string } {
  return guarded(ctx, "plan create", [o.words.join("-")], ["plan.create"], "Creating a plan", () => createInner(ctx, o));
}

function createInner(ctx: PlanCtx, o: CreateOpts): { id: string; files: string[]; commit: string } {
  const words = o.words.flatMap((w) => w.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (words.length < 2 || words.length > 4) throw new PlanOpError("A plan name is two to four words, for example `export-formats`.");
  const id = `${today(ctx)}-${words.join("-")}`;
  if (!PLAN_ID_RE.test(id) || id.length > MAX_PLAN_ID) throw new PlanOpError(`Plan ID ${id} is longer than ${MAX_PLAN_ID} characters or malformed; use shorter words.`);
  const dir = plansDir(ctx.root);
  const src = worktreeSource(ctx.root);
  if (findPlan(src, dir, id)) throw new AlreadyExistsError("Plan", id);
  const project = loadProject(src, loadSpecPaths(ctx.root).paths);

  const impls: Record<string, unknown>[] = [];
  for (const spec of o.implements ?? []) {
    const doc = project.specs.get(spec);
    if (!doc) throw new PlanOpError(`Specification \`${spec}\` does not exist; name it as feature/<slug> or architecture/<slug>.`);
    const commit = gitTry(ctx.root, ["log", "-1", "--format=%H", "--", doc.file])?.trim();
    impls.push({ spec, ...(commit ? { commit } : {}), mode: "implements" });
  }
  for (const spec of o.writes ?? []) impls.push({ spec, mode: "writes" });
  for (const raw of o.references ?? []) {
    const cite = parseCite(raw);
    if (!cite) throw new PlanOpError(`Reference ${JSON.stringify(raw)} is not a valid cite.`);
    const r = resolveCite(project, cite);
    if (!r.ok && r.code === "error") throw new PlanOpError(`Reference \`${raw}\` does not resolve: ${r.reason}`);
  }
  const title = o.title?.trim() || titleCase(words);
  const fm: Record<string, unknown> = { id: `plan/${id}`, title, status: "awaiting-review", authors: [planAuthor(ctx)] };
  if (impls.length) fm.implements = impls;
  if (o.references?.length) fm.references = o.references;
  const dump = (v: unknown) => yaml.dump(v, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true, flowLevel: -1 });
  const planText = `---\n${dump(fm)}---\n# ${title}\n\n## Goal\n\nDescribe what this plan changes and why.\n\n## Scope\n\n- In: \n- Out: \n\n## Specifications\n\nName the specifications this plan implements or writes.\n\n## Acceptance criteria\n\n- Describe a condition that confirms the plan is complete.\n\n## Risks\n\nNone known.\n\n## Steps\n\n01 First step: describe the first piece of work\n`;
  const stepText = `---\n${dump({ plan: id, step: 1, title: "First step" })}---\n## Goal\n\nOne paragraph, small enough for one session.\n\n## Acceptance criteria\n\n- A condition checked before the step is committed.\n\n## Tasks\n\n1. An imperative action.\n`;
  const progress = `status: not-started\ndone: []\n`;
  const files = [`${dir}/${id}/PLAN.md`, `${dir}/${id}/progress.yaml`, `${dir}/${id}/steps/01-first-step.md`];
  for (const [f, t] of [[files[0], planText], [files[1], progress], [files[2], stepText]] as const) {
    const abs = path.join(ctx.root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, t);
  }
  const commit = commitPaths(ctx, ctx.root, files, { type: "docs", scope: planSlug(id), summary: "create plan", workflow: "plan-create", planId: id });
  return { id, files, commit };
}

/** Last commit that changed PLAN.md to its current `plan-v1` content. */
function contentCommit(root: string, file: string, fp: string): string | null {
  const hashes = (gitTry(root, ["log", "--format=%H", "--", file]) ?? "").split("\n").filter(Boolean);
  let found: string | null = null;
  for (const h of hashes) {
    const t = gitTry(root, ["show", `${h}:${file}`]);
    if (t !== null && planFingerprint(t) === fp) found = h; else break;
  }
  return found;
}

/** Approve a plan: the spec approval flow applied to PLAN.md (`file-formats` §5.2). Only a person can. */
export function approvePlan(ctx: PlanCtx, id: string): { commit: string | null; already: boolean } {
  return guarded(ctx, "plan approve", [id], ["spec.approve"], "Approving a plan", () => approveInner(ctx, id));
}

function approveInner(ctx: PlanCtx, id: string): { commit: string | null; already: boolean } {
  const name = ctx.actor.kind === "human" ? humanName(ctx.root) ?? ctx.actor.name : null;
  if (!name) throw new PlanOpError("Only a person can approve a plan; no human identity is available (set git user.name).");
  const dir = plansDir(ctx.root);
  const file = `${dir}/${id}/PLAN.md`;
  const project = committedProject(ctx.root);
  const rec = findPlan(committedSource(ctx.root, "HEAD"), dir, id);
  if (!rec || !rec.planText || !rec.fm?.data) throw new PlanOpError(`Plan \`${id}\` is not committed; commit it before approving.`);
  if (rec.archived) throw new PlanOpError(`Plan \`${id}\` is archived and cannot be approved.`);
  if (isDirty(ctx.root) && (gitTry(ctx.root, ["status", "--porcelain", "--", file]) ?? "").trim()) throw new PlanOpError(`${file} has uncommitted changes; approval is of committed content.`);
  if (planApproval(project, rec).status === "approved") return { commit: null, already: true };
  const fp = planFingerprint(rec.planText)!;
  const cited: Record<string, string> = {};
  for (const raw of planReferences(rec.fm)) {
    const c = parseCite(raw);
    const r = c ? resolveCite(project, c) : null;
    if (r?.ok) cited[raw] = targetFingerprint(r.target);
  }
  const block = { by: { human: name }, date: today(ctx), commit: contentCommit(ctx.root, file, fp), fingerprint: fp, cited };
  const abs = path.join(ctx.root, file);
  fs.writeFileSync(abs, editKeys(fs.readFileSync(abs, "utf8"), { status: "approved", approval: block, "review-reason": undefined }));
  const commit = commitPaths(ctx, ctx.root, [file], { type: "docs", scope: id, summary: "approve plan", workflow: "approve", planId: id });
  return { commit, already: false };
}
