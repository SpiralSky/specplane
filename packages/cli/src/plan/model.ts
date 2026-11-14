import { parseYaml } from "../yaml.js";
import { splitFrontmatter, type FrontmatterResult } from "../spec/frontmatter.js";
import type { Source } from "../spec/source.js";

/**
 * Reading a plan record: PLAN.md, step files, progress.yaml, HANDOFF.md and spec-gaps.md
 * (`architecture/file-formats` §5, `architecture/reference-cli` §11.1).
 */

export const PLAN_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+){1,3}$/;
export const MAX_PLAN_ID = 64;
export const STEP_FILE_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
export const HANDOFF_SECTIONS = ["What changed", "Deviations from the step", "Gaps found", "Open issues", "What the next step must know"] as const;
export const GAP_FIELDS = ["Kind", "Step", "Case", "Resolution", "Target spec", "State"] as const;
export const EXEC_STATUSES = ["not-started", "in-progress", "stopped", "completed", "abandoned"] as const;
export type ExecStatus = (typeof EXEC_STATUSES)[number];

export interface StepFile {
  file: string;
  name: string;
  /** Number from the file name, or null when the name is not `NN-<slug>.md`. */
  number: number | null;
  fm: FrontmatterResult;
  text: string;
}

export interface Progress {
  status: ExecStatus | string;
  target_branch?: string;
  start_commit?: string;
  branch?: string;
  current_step?: number;
  done: number[];
  budget?: { resource: string; soft: number; hard: number }[];
  session?: string;
  stop?: { kind?: string; reason?: string; needs?: string };
  final_review?: { decision?: string; reason?: string; by?: Record<string, string> };
  [k: string]: unknown;
}

export interface HandoffEntry {
  step: number;
  title: string;
  line: number;
  date: string | null;
  outcome: string | null;
  sections: Record<string, string>;
  missing: string[];
}

export interface GapEntry {
  n: number;
  title: string;
  line: number;
  fields: Record<string, string>;
  missing: string[];
}

export interface PlanRecord {
  id: string;
  /** Repository-relative folder. */
  dir: string;
  archived: boolean;
  planFile: string;
  planText: string | null;
  fm: FrontmatterResult | null;
  steps: StepFile[];
  progressFile: string;
  progress: Progress | null;
  progressError: string | null;
  handoffFile: string;
  handoffText: string | null;
  handoff: HandoffEntry[];
  gapsFile: string;
  gapsText: string | null;
  gaps: GapEntry[];
  /** True when the folder has no progress.yaml: a plan in the retired format. */
  legacy: boolean;
}

export function parseProgress(text: string): { progress: Progress | null; error: string | null } {
  let data: unknown;
  try { data = parseYaml(text); } catch (e) { return { progress: null, error: `invalid YAML: ${(e as Error).message.split("\n")[0]}` }; }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) return { progress: null, error: "progress.yaml is not a mapping" };
  const d = data as Record<string, unknown>;
  const done = Array.isArray(d.done) ? d.done.filter((x): x is number => Number.isInteger(x)) : [];
  return { progress: { ...d, status: typeof d.status === "string" ? d.status : "", done } as Progress, error: null };
}

export function parseHandoff(text: string): HandoffEntry[] {
  const lines = text.split("\n");
  const starts: { i: number; step: number; title: string }[] = [];
  lines.forEach((l, i) => {
    const m = /^## Step (\d+): (.*)$/.exec(l);
    if (m) starts.push({ i, step: Number(m[1]), title: m[2].trim() });
  });
  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    const block = lines.slice(s.i + 1, end);
    const field = (name: string) => block.map((l) => new RegExp(`^\\*\\*${name}\\*\\*:\\s*(.*)$`).exec(l)).find(Boolean)?.[1]?.trim() ?? null;
    const sections: Record<string, string> = {};
    let cur: string | null = null;
    for (const l of block) {
      const h = /^### (.*)$/.exec(l);
      if (h) { cur = h[1].trim(); sections[cur] = ""; } else if (cur) sections[cur] += `${l}\n`;
    }
    for (const k2 of Object.keys(sections)) sections[k2] = sections[k2].trim();
    const missing = HANDOFF_SECTIONS.filter((n) => !sections[n]);
    return { step: s.step, title: s.title, line: s.i + 1, date: field("Date"), outcome: field("Outcome"), sections, missing: [...missing] };
  });
}

const ENTRY_PLACEHOLDERS: Record<(typeof HANDOFF_SECTIONS)[number], string> = {
  "What changed": "- `<path>`: <reason>",
  "Deviations from the step": "None. | <text>",
  "Gaps found": "None. | - G<n> (<kind>): <one line>",
  "Open issues": "None. | - <text>",
  "What the next step must know": "<self-contained facts>",
};

/**
 * The one definition of a HANDOFF.md entry (`architecture/file-formats` §5.5). `parseHandoff` reads this form, the
 * step-done refusals print it for the step in question, and the plan-step contract and the plans documentation quote
 * `handoffEntryTemplate()` verbatim; a test keeps all of them equal.
 */
export function handoffEntryTemplate(o: { step?: number; title?: string; outcome?: string; date?: string } = {}): string {
  const heading = `## Step ${o.step === undefined ? "NN" : String(o.step).padStart(2, "0")}: ${o.title ?? "<step title>"}`;
  return [
    heading, "",
    `**Date**: ${o.date ?? "YYYY-MM-DD"}`,
    `**Outcome**: ${o.outcome ?? "done | partial"}`,
    ...HANDOFF_SECTIONS.flatMap((n) => ["", `### ${n}`, ENTRY_PLACEHOLDERS[n]]),
  ].join("\n");
}

export function parseGaps(text: string): GapEntry[] {
  const lines = text.split("\n");
  const starts: { i: number; n: number; title: string }[] = [];
  lines.forEach((l, i) => {
    const m = /^## G(\d+): (.*)$/.exec(l);
    if (m) starts.push({ i, n: Number(m[1]), title: m[2].trim() });
  });
  return starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    const fields: Record<string, string> = {};
    for (const l of lines.slice(s.i + 1, end)) {
      const m = /^\*\*([A-Za-z ]+)\*\*:\s*(.*)$/.exec(l);
      if (m) fields[m[1]] = m[2].trim();
    }
    return { n: s.n, title: s.title, line: s.i + 1, fields, missing: GAP_FIELDS.filter((f) => fields[f] === undefined || fields[f] === "") };
  });
}

export function readPlan(source: Source, base: string, id: string, archived: boolean): PlanRecord {
  const dir = `${base}/${id}`;
  const planText = source.read(`${dir}/PLAN.md`);
  const progressText = source.read(`${dir}/progress.yaml`);
  const parsed = progressText === null ? { progress: null, error: null } : parseProgress(progressText);
  const steps: StepFile[] = source.list(`${dir}/steps`).filter((n) => n.endsWith(".md")).map((name) => {
    const text = source.read(`${dir}/steps/${name}`) ?? "";
    const m = STEP_FILE_RE.exec(name);
    return { file: `${dir}/steps/${name}`, name, number: m ? Number(m[1]) : null, fm: splitFrontmatter(text), text };
  });
  steps.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || (a.name < b.name ? -1 : 1));
  const handoffText = source.read(`${dir}/HANDOFF.md`);
  const gapsText = source.read(`${dir}/spec-gaps.md`);
  return {
    id, dir, archived, planFile: `${dir}/PLAN.md`, planText, fm: planText === null ? null : splitFrontmatter(planText), steps,
    progressFile: `${dir}/progress.yaml`, progress: parsed.progress, progressError: parsed.error,
    handoffFile: `${dir}/HANDOFF.md`, handoffText, handoff: handoffText ? parseHandoff(handoffText) : [],
    gapsFile: `${dir}/spec-gaps.md`, gapsText, gaps: gapsText ? parseGaps(gapsText) : [], legacy: progressText === null,
  };
}

/** Every plan folder, active first and then archived. */
export function loadPlans(source: Source, plansDir: string): PlanRecord[] {
  const out: PlanRecord[] = [];
  for (const id of source.listDirs(plansDir)) if (id !== "archive") out.push(readPlan(source, plansDir, id, false));
  for (const id of source.listDirs(`${plansDir}/archive`)) out.push(readPlan(source, `${plansDir}/archive`, id, true));
  return out;
}

export function findPlan(source: Source, plansDir: string, id: string): PlanRecord | null {
  if (source.exists(`${plansDir}/${id}`)) return readPlan(source, plansDir, id, false);
  if (source.exists(`${plansDir}/archive/${id}`)) return readPlan(source, `${plansDir}/archive`, id, true);
  return null;
}

/** The latest handoff entry for a step (the authoritative one). */
export function latestEntry(p: PlanRecord, step: number): HandoffEntry | null {
  const all = p.handoff.filter((e) => e.step === step);
  return all.length ? all[all.length - 1] : null;
}

/** Step numbers of the plan's step files. */
export function stepNumbers(p: PlanRecord): number[] {
  return p.steps.map((s) => s.number).filter((n): n is number => n !== null);
}

/** Lowest-numbered step that is not done, or null when every step is done (`plans §3.1`). */
export function nextStep(p: PlanRecord): number | null {
  const done = new Set(p.progress?.done ?? []);
  return stepNumbers(p).find((n) => !done.has(n)) ?? null;
}

export function stepTitle(s: StepFile): string {
  const t = s.fm.data?.title;
  return typeof t === "string" && t ? t : s.name;
}

/** Cites a plan lists: its `references` strings and the `implements` spec IDs. */
export function planReferences(fm: FrontmatterResult | null): string[] {
  const v = fm?.data?.references;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export interface ImplementsEntry { spec: string; commit: string | null; mode: string }
export function planImplements(fm: FrontmatterResult | null): ImplementsEntry[] {
  const v = fm?.data?.implements;
  if (!Array.isArray(v)) return [];
  return v.map((e) => (e && typeof e === "object" && !Array.isArray(e) ? { spec: String((e as Record<string, unknown>).spec ?? ""), commit: typeof (e as Record<string, unknown>).commit === "string" ? ((e as Record<string, unknown>).commit as string) : null, mode: String((e as Record<string, unknown>).mode ?? "") } : { spec: String(e), commit: null, mode: "" }));
}

/** Plan IDs cited as `plan/<id>` in `references`. */
export function referencedPlans(fm: FrontmatterResult | null): string[] {
  return planReferences(fm).map((r) => /^plan\/(.+)$/.exec(r.trim())?.[1]).filter((x): x is string => !!x);
}
