import { run } from "../git/exec.js";
import { citeKey, extractBodyCites, parseCite, type Layer } from "../spec/cites.js";
import { LEGACY_RECORD_KEYS as LEGACY_KEYS } from "../spec/fingerprint.js";
import { indexSections } from "../spec/sections.js";
import { resolveCite, type Project, findDoc } from "../spec/project.js";
import { EXEC_STATUSES, GAP_FIELDS, HANDOFF_SECTIONS, MAX_PLAN_ID, handoffEntryTemplate, PLAN_ID_RE, latestEntry, planImplements, planReferences, referencedPlans, stepNumbers, type PlanRecord } from "./model.js";
import { parseTasks, taskProblems } from "./tasks.js";

/** Plan validation rules (`architecture/reference-cli` §11.1, `architecture/file-formats` §5). */

export type PlanEmit = (severity: "error" | "warning" | "note", rule: string, message: string, file: string, line?: number) => void;

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX40 = /^[0-9a-f]{40}$/;

/** Latest commit on the current branch that changed a file, or null. */
function latestCommitOf(root: string, file: string): string | null {
  try { return run("git", ["log", "-1", "--format=%H", "--", file], { cwd: root }).trim() || null; } catch { return null; }
}

/** Strongly connected cycles among plan references; returns each cycle as a list of IDs. */
export function planCycles(plans: PlanRecord[]): string[][] {
  const edges = new Map<string, string[]>();
  for (const p of plans) edges.set(p.id, referencedPlans(p.fm).filter((x) => plans.some((q) => q.id === x)));
  const cycles: string[][] = [];
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (v: string): void => {
    state.set(v, 1); stack.push(v);
    for (const w of edges.get(v) ?? []) {
      if (state.get(w) === 1) { const c = stack.slice(stack.indexOf(w)); if (!cycles.some((x) => x.length === c.length && c.every((id) => x.includes(id)))) cycles.push(c); }
      else if (!state.has(w)) visit(w);
    }
    stack.pop(); state.set(v, 2);
  };
  for (const id of edges.keys()) if (!state.has(id)) visit(id);
  return cycles;
}

function checkOne(p: PlanRecord, project: Project, root: string | null, emit: PlanEmit): void {
  const err = (m: string, file = p.planFile, line?: number) => emit("error", "plans", m, file, line);
  const warn = (m: string, file = p.planFile, line?: number) => emit("warning", "plans", m, file, line);
  if (p.legacy) { warn(`plan ${p.id} has no progress.yaml: it is in the retired plan format and is not checked`); return; }
  if (!PLAN_ID_RE.test(p.id)) err(`plan folder name ${p.id} is not YYYY-MM-DD-<w1>-<w2>[-<w3>[-<w4>]] with lower-case words`);
  if (p.id.length > MAX_PLAN_ID) err(`plan ID ${p.id} is longer than ${MAX_PLAN_ID} characters`);
  const fm = p.fm;
  if (!fm || !fm.data) { err(fm?.error ?? "PLAN.md is missing"); }
  else {
    const d = fm.data;
    if (d.id !== `plan/${p.id}`) err(`PLAN.md id is ${JSON.stringify(d.id)} but the folder gives plan/${p.id}`, p.planFile, 1);
    if (typeof d.title !== "string" || !d.title.trim()) err("title must be a non-empty string", p.planFile, 1);
    for (const k of LEGACY_KEYS) if (d[k] !== undefined) warn(`legacy record key \`${k}\` is ignored; run \`specplane migrate status\` (architecture/file-formats §2)`, p.planFile, 1);
    if (!Array.isArray(d.authors)) err("authors is required and must be a list", p.planFile, 1);
    if (d.implements !== undefined && !Array.isArray(d.implements)) err("implements must be a list", p.planFile, 1);
    if (d.references !== undefined && (!Array.isArray(d.references) || d.references.some((x) => typeof x !== "string"))) err("references must be a list of cite strings", p.planFile, 1);
  }

  // implements entries
  const impls = planImplements(fm);
  for (const e of impls) {
    if (e.mode !== "writes" && e.mode !== "implements") err(`implements entry ${JSON.stringify(e.spec)}: mode must be writes or implements`, p.planFile, 1);
    const exists = findDoc(project, e.spec) !== undefined;
    if (!exists && e.mode === "implements") err(`implements entry ${JSON.stringify(e.spec)} does not resolve to a specification`, p.planFile, 1);
    if (e.commit !== null && !HEX40.test(e.commit)) err(`implements entry ${e.spec}: commit must be 40 hex digits`, p.planFile, 1);
    const doc = findDoc(project, e.spec);
    if (doc && e.commit && root) {
      const latest = latestCommitOf(root, doc.file);
      if (latest && latest !== e.commit) warn(`outdated reference: ${e.spec} was recorded at ${e.commit.slice(0, 12)} and its latest commit on this branch is ${latest.slice(0, 12)} (plan ${p.id}); check what changed before continuing (plans R29.3)`, p.planFile, 1);
    }
  }
  // references resolve
  for (const raw of planReferences(fm)) {
    const cite = parseCite(raw);
    if (!cite) { err(`reference ${JSON.stringify(raw)} is not a valid cite`, p.planFile, 1); continue; }
    const r = resolveCite(project, cite);
    if (!r.ok) err(`unresolved reference \`${raw}\`: ${r.reason}`, p.planFile, 1);
  }
  // body cites must be listed
  if (fm?.data && p.planText) {
    const lines = p.planText.split("\n");
    const listed = new Set([...planReferences(fm), ...impls.map((e) => e.spec)].map((c) => citeKey(c)));
    const body = extractBodyCites(lines, fm.bodyStartLine, indexSections(lines, fm.bodyStartLine), { layer: "feature" as Layer, slug: "\0plan" }, (l, s) => project.specs.has(`${l}/${s}`));
    const seen = new Set<string>();
    for (const b of body) {
      const key = citeKey(b.raw);
      if (listed.has(key) || seen.has(key)) continue;
      seen.add(key);
      if ("project" in b.cite && b.cite.project !== null && b.cite.project !== "root") continue;
      if (b.cite.kind === "spec") warn(`whole-spec cite \`${b.raw}\` in the body is not listed in references or implements`, p.planFile, b.line);
      else err(`cite \`${b.raw}\` is used in the plan body but missing from references and implements`, p.planFile, b.line);
      if (!parseCite(b.raw)) continue;
      const r = resolveCite(project, b.cite);
      if (!r.ok && r.code === "error") err(`unresolved cite \`${b.raw}\` in the body: ${r.reason}`, p.planFile, b.line);
    }
  }

  // steps
  const nums = p.steps.map((s) => s.number);
  p.steps.forEach((s) => { if (s.number === null) err(`step file ${s.name} is not named NN-<slug>.md`, s.file); });
  const good = nums.filter((n): n is number => n !== null);
  good.forEach((n, i) => { if (good.indexOf(n) !== i) err(`duplicate step number ${String(n).padStart(2, "0")}`, p.steps[i].file); });
  const uniq = [...new Set(good)].sort((a, b) => a - b);
  uniq.forEach((n, i) => { if (n !== i + 1) { err(`step numbers must be contiguous from 01; expected ${String(i + 1).padStart(2, "0")} but found ${String(n).padStart(2, "0")}`, p.planFile); uniq.length = i; } });
  for (const s of p.steps) {
    if (!s.fm.data) { err(s.fm.error ?? "step frontmatter is missing", s.file, 1); continue; }
    const d = s.fm.data;
    if (d.plan !== p.id) err(`step plan is ${JSON.stringify(d.plan)} but the folder is ${p.id}`, s.file, 1);
    if (s.number !== null && d.step !== s.number) err(`step field is ${JSON.stringify(d.step)} but the file name gives ${s.number}`, s.file, 1);
    if (typeof d.title !== "string" || !d.title.trim()) err("step title must be a non-empty string", s.file, 1);
    for (const k of ["writes", "implements"] as const) {
      const v = d[k];
      if (v === undefined) continue;
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) { err(`${k} must be a list of spec IDs`, s.file, 1); continue; }
      if (k === "implements") for (const id of v as string[]) if (!findDoc(project, id)) err(`implements item ${JSON.stringify(id)} does not resolve to a specification`, s.file, 1);
    }
    for (const problem of taskProblems(parseTasks(s.text.replace(/^---\n[\s\S]*?\n---\n?/, "")))) warn(problem, s.file);
    const ctx = d.context;
    if (ctx !== undefined) {
      if (!Array.isArray(ctx) || ctx.some((x) => typeof x !== "string")) err("context must be a list of cite strings", s.file, 1);
      else for (const raw of ctx as string[]) {
        const cite = parseCite(raw);
        if (!cite) { err(`context item ${JSON.stringify(raw)} is not a valid cite`, s.file, 1); continue; }
        const r = resolveCite(project, cite);
        if (!r.ok && r.code === "error") { if (cite.kind === "file") warn(`context ${raw}: ${r.reason}`, s.file, 1); else err(`unresolved context \`${raw}\`: ${r.reason}`, s.file, 1); }
      }
    }
  }

  // progress.yaml
  const pr = p.progress;
  if (p.progressError) err(p.progressError, p.progressFile);
  else if (pr) {
    if (!(EXEC_STATUSES as readonly string[]).includes(pr.status)) err(`status must be one of ${EXEC_STATUSES.join(", ")}, not ${JSON.stringify(pr.status)}`, p.progressFile, 1);
    const all = new Set(stepNumbers(p));
    for (const n of pr.done) if (!all.has(n)) err(`done lists step ${n}, which has no step file`, p.progressFile);
    if (pr.status === "stopped" && !pr.stop) err("status is stopped but `stop` is missing", p.progressFile);
    if (pr.status !== "stopped" && pr.stop) err("`stop` is present but status is not stopped", p.progressFile);
    if (["in-progress", "stopped"].includes(pr.status) && (!pr.target_branch || !pr.start_commit || !pr.branch)) err("a started plan needs target_branch, start_commit and branch", p.progressFile);
    if (pr.status === "completed" && !p.archived) warn("a completed plan is archived; this one is not", p.progressFile);
    if (pr.status === "abandoned" && !p.archived) warn("an abandoned plan is archived; this one is not", p.progressFile);
    const cur = stepNumbers(p).find((n) => !pr.done.includes(n));
    if (pr.current_step !== undefined && cur !== undefined && pr.current_step !== cur) warn(`current_step is ${pr.current_step} but the lowest step not done is ${cur}; the stored value is ignored`, p.progressFile);
    if (pr.budget !== undefined) {
      if (!Array.isArray(pr.budget)) err("budget must be a list", p.progressFile);
      else for (const b of pr.budget) if (!isMap(b) || typeof b.resource !== "string" || !(Number(b.soft) > 0) || !(Number(b.hard) >= Number(b.soft))) err("budget entries need a resource and 0 < soft <= hard", p.progressFile);
    }
    if (pr.status === "not-started" && pr.done.length) err("a plan that has not started has done steps", p.progressFile);
  }

  // handoff
  const form = (step: number) => `\nRequired form:\n\n${handoffEntryTemplate({ step })}\n`;
  const doneSet = new Set(pr?.done ?? []);
  for (const e of p.handoff) {
    if (e.outcome !== "done" && e.outcome !== "partial") err(`handoff entry for step ${e.step}: Outcome must be done or partial; the line must read exactly \`**Outcome**: done\` or \`**Outcome**: partial\`${form(e.step)}`, p.handoffFile, e.line);
    if (e.missing.length) err(`handoff entry for step ${e.step} is missing ${e.missing.join(", ")} (all of ${HANDOFF_SECTIONS.length} sections are required)${form(e.step)}`, p.handoffFile, e.line);
    if (!stepNumbers(p).includes(e.step)) err(`handoff entry names step ${e.step}, which has no step file`, p.handoffFile, e.line);
  }
  for (const n of stepNumbers(p)) {
    const last = latestEntry(p, n);
    if (doneSet.has(n) && last?.outcome !== "done") err(`step ${n} is done in progress.yaml but its latest handoff entry is ${last ? last.outcome : "missing"}`, p.handoffFile);
    if (!doneSet.has(n) && last?.outcome === "done" && pr && pr.status !== "not-started") err(`step ${n} has a done handoff entry but is not in the done list of progress.yaml`, p.progressFile);
  }

  // gaps
  let prev = 0;
  for (const g of p.gaps) {
    if (g.n !== prev + 1) err(`gap IDs must count up from G1 without gaps or reuse; found G${g.n} after G${prev}`, p.gapsFile, g.line);
    prev = Math.max(prev, g.n);
    if (g.missing.length) err(`G${g.n} is missing ${g.missing.join(", ")} (all of ${GAP_FIELDS.join(", ")} are required)`, p.gapsFile, g.line);
    const f = g.fields;
    if (f.Kind && !["gap", "assumption", "proposal"].includes(f.Kind)) err(`G${g.n}: Kind must be gap, assumption or proposal`, p.gapsFile, g.line);
    if (f.State && !["open", "applied", "rejected"].includes(f.State)) err(`G${g.n}: State must be open, applied or rejected`, p.gapsFile, g.line);
    if (f.Step && !stepNumbers(p).includes(Number(f.Step))) err(`G${g.n}: Step ${f.Step} has no step file`, p.gapsFile, g.line);
    if (f["Target spec"]) for (const id of f["Target spec"].split(",").map((x) => x.trim().replace(/^`|`$/g, ""))) if (id && !findDoc(project, id)) err(`G${g.n}: target spec ${id} does not exist`, p.gapsFile, g.line);
  }
}

export function validatePlanRecords(plans: PlanRecord[], project: Project, root: string | null, emit: PlanEmit, only?: Set<string> | null): void {
  const known = new Set(plans.map((p) => p.id));
  for (const p of plans) {
    if (only && !only.has(`plan/${p.id}`) && !only.has(p.id)) continue;
    checkOne(p, project, root, emit);
    for (const ref of referencedPlans(p.fm)) if (!known.has(ref)) emit("error", "plans", `referenced plan ${ref} does not exist`, p.planFile, 1);
  }
  for (const c of planCycles(plans)) {
    const p = plans.find((x) => x.id === c[0])!;
    emit("error", "plans", `reference cycle among plans: ${[...c, c[0]].join(" -> ")}`, p.planFile, 1);
  }
}
