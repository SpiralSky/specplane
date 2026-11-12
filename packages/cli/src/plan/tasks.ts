import type { StepFile } from "./model.js";

/**
 * Tasks of a step and how they run in parallel (`features/plan-execution` R31.2, `architecture/reference-cli` §11.5.1).
 * A task is a top-level list item of the step's `## Tasks` section. An item that starts with `[parallel]` is declared
 * independent of the other `[parallel]` items right next to it; a run of such neighbours is one parallel group. An item
 * without the marker is its own group and runs alone, after the group before it.
 */

export interface StepTask {
  /** Position in the Tasks list, from 1. */
  n: number;
  /** The task text without the marker. */
  text: string;
  parallel: boolean;
  /** Repository paths the task names in backticks; used to warn when parallel tasks name the same file. */
  files: string[];
}

export interface TaskGroup { tasks: number[]; parallel: boolean }

export interface TaskPlan {
  tasks: StepTask[];
  groups: TaskGroup[];
  /** The setting `plans.parallelism`. */
  parallelism: number;
  /** Greatest number of tasks run at once for this step on this harness. */
  concurrency: number;
  /** Whether the harness can start subagents. */
  subagents: boolean;
  /** Tells the user why tasks run one after another, or null. */
  note: string | null;
}

const MARK = /^\[parallel\]\s*/i;
const ITEM = /^( {0,3})(?:\d+[.)]|[-*+])\s+(.*)$/;

/** Tasks of a step body; no `## Tasks` section gives an empty list. */
export function parseTasks(body: string): StepTask[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s+Tasks\s*$/i.test(l));
  if (start < 0) return [];
  const raw: string[] = [];
  let fence = false;
  for (const line of lines.slice(start + 1)) {
    if (/^```/.test(line.trim())) fence = !fence;
    if (!fence && /^##\s/.test(line)) break;
    const m = !fence ? ITEM.exec(line) : null;
    if (m) raw.push(m[2]);
    else if (raw.length && line.trim() && /^\s+\S/.test(line)) raw[raw.length - 1] += ` ${line.trim()}`;
  }
  return raw.map((t, i) => {
    const parallel = MARK.test(t);
    const text = t.replace(MARK, "").trim();
    return { n: i + 1, text, parallel, files: taskFiles(text) };
  });
}

const PATHISH = /^[\w./@-]+\/[\w./@-]+$|^[\w-]+\.[a-z]{1,5}$/i;
/** Backticked tokens that look like repository paths. */
function taskFiles(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([^`\s]+)`/g)) if (PATHISH.test(m[1]) && !m[1].startsWith("http")) out.push(m[1].replace(/^\.\//, ""));
  return [...new Set(out)];
}

/** Consecutive `[parallel]` tasks form a group; every other task is a group of its own. */
export function groupTasks(tasks: StepTask[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  for (const t of tasks) {
    const last = groups[groups.length - 1];
    if (t.parallel && last?.parallel) last.tasks.push(t.n);
    else groups.push({ tasks: [t.n], parallel: t.parallel });
  }
  return groups;
}

/**
 * How the step's tasks run. At most `parallelism` tasks of a group run at once, and only when the harness has subagents;
 * the next group starts after every task of the group before it is done.
 */
export function planTasks(body: string, parallelism: number, subagents: boolean, harness = "this harness"): TaskPlan {
  const tasks = parseTasks(body);
  const groups = groupTasks(tasks);
  const widest = Math.max(1, ...groups.filter((g) => g.parallel).map((g) => g.tasks.length));
  const wantsParallel = groups.some((g) => g.parallel && g.tasks.length > 1);
  const concurrency = subagents ? Math.max(1, Math.min(parallelism, widest)) : 1;
  let note: string | null = null;
  if (wantsParallel && parallelism > 1 && !subagents) note = `Parallelism is not available in ${harness}: it cannot start subagents, so the tasks run one after another.`;
  else if (wantsParallel && parallelism <= 1) note = "plans.parallelism is 1, so the tasks run one after another.";
  return { tasks, groups, parallelism, concurrency, subagents, note };
}

/** The tasks of a step file, for `plan.next` and the validation rule. */
export function stepTaskPlan(step: StepFile | undefined, parallelism: number, subagents: boolean, harness?: string): TaskPlan {
  const body = step ? step.text.replace(/^---\n[\s\S]*?\n---\n?/, "") : "";
  return planTasks(body, parallelism, subagents, harness);
}

/** Problems with a step's parallel tasks that the validator warns about. */
export function taskProblems(tasks: StepTask[]): string[] {
  const out: string[] = [];
  const groups = groupTasks(tasks);
  for (const g of groups) {
    if (!g.parallel) continue;
    if (g.tasks.length === 1) { out.push(`task ${g.tasks[0]} is marked [parallel] but has no [parallel] neighbour, so it runs alone`); continue; }
    const seen = new Map<string, number>();
    for (const n of g.tasks) for (const f of tasks[n - 1].files) {
      const prev = seen.get(f);
      if (prev !== undefined && prev !== n) out.push(`parallel tasks ${prev} and ${n} both name \`${f}\`; tasks that share a file depend on each other`);
      else seen.set(f, n);
    }
  }
  return out;
}
