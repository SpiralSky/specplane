import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo } from "../test-repo.js";
import { DEFAULT_PRESET } from "../perm/permissions.js";
import { createActionRuntime } from "../harness/actions.js";
import { validateProject } from "../verify/validate.js";
import { createPlan } from "./create.js";
import { loadPlanAt } from "./ctx.js";
import { startPlan } from "./run.js";
import { groupTasks, parseTasks, planTasks, taskProblems } from "./tasks.js";

const ID = "2026-11-10-export-things";
const body = (tasks: string) => `## Goal\n\nDo it.\n\n## Acceptance criteria\n\n- Done.\n\n## Tasks\n\n${tasks}\n\n## Context\n\nNone.\n`;
const FOUR = "1. Prepare `src/a.ts`.\n2. [parallel] Write `src/b.ts`.\n3. [parallel] Write `src/c.ts`.\n4. [parallel] Write `src/d.ts`.\n5. [parallel] Write `src/e.ts`.\n6. Wire everything together.";

test("tasks: markers, groups and continuation lines are read from the Tasks section only", () => {
  const tasks = parseTasks(`${body(`${FOUR}\n   More about the last task.`)}\n- [parallel] not a task of this step\n`);
  assert.equal(tasks.length, 6);
  assert.deepEqual(tasks.map((t) => t.parallel), [false, true, true, true, true, false]);
  assert.equal(tasks[0].text, "Prepare `src/a.ts`.");
  assert.match(tasks[5].text, /More about the last task/);
  assert.deepEqual(tasks[1].files, ["src/b.ts"]);
  assert.deepEqual(groupTasks(tasks).map((g) => g.tasks), [[1], [2, 3, 4, 5], [6]]);
  assert.deepEqual(parseTasks("## Goal\n\nNo tasks section.\n"), []);
});

test("tasks: concurrency is the setting capped by the widest group, and one without subagents", () => {
  const three = planTasks(body(FOUR), 3, true);
  assert.equal(three.concurrency, 3, "four independent tasks, at most three at once");
  assert.equal(three.note, null);
  assert.equal(planTasks(body(FOUR), 9, true).concurrency, 4, "never wider than the group");
  const none = planTasks(body(FOUR), 3, false, "codex");
  assert.equal(none.concurrency, 1);
  assert.match(none.note ?? "", /not available in codex.*one after another/);
  const one = planTasks(body(FOUR), 1, true);
  assert.equal(one.concurrency, 1);
  assert.match(one.note ?? "", /plans\.parallelism is 1/);
  assert.equal(planTasks(body("1. A.\n2. B."), 3, true).note, null, "no parallel tasks, nothing to say");
});

test("tasks: a lone marker and a shared file are reported", () => {
  const problems = taskProblems(parseTasks(body("1. [parallel] Edit `src/x.ts`.\n2. Middle.\n3. [parallel] Edit `src/x.ts`.\n4. [parallel] Edit `src/x.ts`.")));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /task 1 is marked \[parallel\] but has no \[parallel\] neighbour/);
  assert.match(problems[1], /parallel tasks 3 and 4 both name `src\/x\.ts`/);
});

function fixture(config: string): { root: string; wt: string } {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-tasks-wt-"));
  const root = makeRepo({ ".specplane/config.yaml": `plans:\n  dir: plans\n  worktree_dir: ${wt}\n  start_conditions: off\n${config}` });
  const sh = (...a: string[]) => { const r = spawnSync("git", a, { cwd: root, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  sh("init", "-q", "-b", "main"); sh("config", "user.name", "Pat"); sh("config", "user.email", "pat@example.com"); sh("add", "-A"); sh("commit", "-qm", "init");
  const ctx = { root, actor: { role: "standard-user" as const, kind: "human" as const, name: "Pat" }, preset: DEFAULT_PRESET, now: new Date("2026-11-10T12:00:00Z"), env: {} };
  createPlan(ctx, { words: ["export", "things"] });
  const stepFile = path.join(root, "plans", ID, "steps", "01-first-step.md");
  fs.writeFileSync(stepFile, `---\nplan: ${ID}\nstep: 1\ntitle: First step\n---\n${body(FOUR)}`);
  sh("add", "-A"); sh("commit", "-qm", "tasks");
  return { root, wt };
}

test("plan.next reports the next step's tasks by harness: Claude runs three at once, Codex one at a time", async () => {
  const { root } = fixture("  parallelism: 3\n");
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "info.retrieve": "allow" };
  try {
    const call = async (adapter?: string) => (await createActionRuntime({ root, id: "s", reportsContext: false, model: "m", ...(adapter ? { adapter } : {}) }).call("plan.next", { id: ID })).data as any;
    const claude = await call("claude");
    assert.equal(claude.tasks.concurrency, 3);
    assert.deepEqual(claude.tasks.groups.map((g: any) => g.tasks), [[1], [2, 3, 4, 5], [6]]);
    assert.equal(claude.tasks.note, null);
    const codex = await call("codex");
    assert.equal(codex.tasks.concurrency, 1);
    assert.match(codex.tasks.note, /not available in codex/);
    assert.equal((await call()).tasks.concurrency, 1, "no adapter named: no subagents claimed");
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("validation warns about parallel tasks that name the same file", () => {
  const { root } = fixture("");
  const stepFile = path.join(root, "plans", ID, "steps", "01-first-step.md");
  fs.writeFileSync(stepFile, `---\nplan: ${ID}\nstep: 1\ntitle: First step\n---\n${body("1. [parallel] Edit `src/x.ts`.\n2. [parallel] Edit `src/x.ts` again.")}`);
  const found = validateProject(root).findings.filter((f) => f.rule === "plans" && /parallel/.test(f.message));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
});

const entry = `\n## Step 01: Step 1\n\n**Date**: 2026-11-10\n**Outcome**: done\n\n### What changed\n- \`f1.txt\`: work\n\n### Deviations from the step\nNone.\n\n### Gaps found\nNone.\n\n### Open issues\nNone.\n\n### What the next step must know\nNone.\n`;
const dist = (file: string) => new URL(file, import.meta.url).href;
const here = fileURLToPath(import.meta.url);

/** Concurrency test: five processes report the same step at once; one records it, the rest are denied, nothing is corrupted. */
test("concurrent step reports queue on the plan lock: one records the step, the others are denied cleanly", async () => {
  const { root, wt } = fixture("  parallelism: 3\n");
  const ctx = { root, actor: { role: "standard-user" as const, kind: "human" as const, name: "Pat" }, preset: DEFAULT_PRESET, now: new Date("2026-11-10T12:00:00Z"), env: {} };
  const started = startPlan(ctx, ID);
  fs.writeFileSync(path.join(started.path, "plans", ID, "HANDOFF.md"), `# H\n${entry}`);
  fs.writeFileSync(path.join(started.path, "f1.txt"), "work\n");
  const script = `import { stepDone } from ${JSON.stringify(dist("./run.js"))};
import { DEFAULT_PRESET } from ${JSON.stringify(dist("../perm/permissions.js"))};
const ctx = { root: ${JSON.stringify(root)}, actor: { role: "standard-user", kind: "human", name: "Pat" }, preset: DEFAULT_PRESET, now: new Date("2026-11-10T12:00:00Z"), env: {} };
try { stepDone(ctx, ${JSON.stringify(ID)}, { step: 1, outcome: "done" }); console.log("RECORDED"); } catch (e) { console.log("DENIED " + e.message.split("\\n")[0]); }`;
  const runOne = () => new Promise<string>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: path.dirname(here), env: { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", () => resolve(out.trim()));
  });
  const results = await Promise.all([1, 2, 3, 4, 5].map(runOne));
  assert.equal(results.filter((r) => r === "RECORDED").length, 1, results.join(" | "));
  for (const r of results.filter((r) => r !== "RECORDED")) assert.match(r, /^DENIED .*(Every step is done|cannot be recorded|is completed|in progress)/, r);
  assert.deepEqual(loadPlanAt(started.path, ID)!.progress!.done, [1]);
  const git = spawnSync("git", ["log", "--format=%s", "-3"], { cwd: started.path, encoding: "utf8" }).stdout;
  assert.equal(git.split("\n").filter((l) => /first step/i.test(l)).length, 1, git);
  assert.equal(fs.existsSync(path.join(root, ".git", "specplane", `plan-${ID}.lock`)), false, "the lock is released");
  fs.rmSync(wt, { recursive: true, force: true });
});
