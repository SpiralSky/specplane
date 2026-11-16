import type { Command } from "commander";
import { RequestSent } from "../requests/hold.js";
import { UsageError } from "../errors.js";
import { runCommand } from "./runner.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, type Actor } from "../perm/permissions.js";
import { approvePlan, createPlan } from "../plan/create.js";
import { guarded, liveRoot, requirePlan, type PlanCtx } from "../plan/ctx.js";
import { abandonPlan, deletePlan, finishPlan, formatReview, mergePlan, reviewPlan } from "../plan/finish.js";
import { resumePlan, retargetPlan, setBudget, startPlan, stepDone, stopPlan } from "../plan/run.js";
import { planMetaGet, planMetaSet } from "../plan/meta.js";
import { checkSelectionText, describePlan, listInfos, type PlanInfo } from "../plan/status.js";

/** Human CLI commands for plans (`architecture/reference-cli` §11, §13.1). */

function context(): PlanCtx {
  const root = checkoutRoot();
  const actor: Actor = cliActor(root);
  // A harness adapter names the resources it can measure; without it nothing is refused (`reference-cli` §11.4).
  const measurable = process.env.SPECPLANE_MEASURABLE_RESOURCES?.split(",").map((x) => x.trim()).filter(Boolean);
  return { root, actor, preset: activePreset(root), ...(measurable ? { measurable } : {}) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** What the running command has produced; the runner prints it (`reference-cli` §13.3). */
let lines: string[] = [];
let data: unknown = null;
let failed = false;
const out = (s: string) => { lines.push(...s.replace(/\n$/, "").split("\n")); };
/** The JSON form of the command's result; text mode prints the lines instead. */
const json = (v: unknown) => { data = v; };

function run(command: string, args: string[], opts: { json?: boolean } | undefined, fn: (ctx: PlanCtx) => void): Promise<void> {
  return runCommand({ command: `plan ${command}`, args, json: opts?.json }, () => {
    lines = []; data = null; failed = false;
    try { fn(context()); } catch (e) {
      // A held action: the request was stored and nothing was done (exit status 0, `reference-cli` §13.3).
      if (e instanceof RequestSent) return { ok: true, held: true, lines: [e.message], data: { request: e.request.id } };
      throw e;
    }
    // When a command prints JSON only, the text form is empty; give it the same data.
    return { ok: !failed, data, lines };
  });
}

function line(i: PlanInfo): string {
  const next = i.next ? `next ${pad(i.next.number)} ${i.next.title}${i.next.waiting ? ` (${i.next.waiting})` : ""}` : i.reviewPending ? "final review pending" : "";
  const stop = i.stop?.reason ? ` [${i.stop.reason}]` : i.idle ? " [idle between steps]" : "";
  return `${i.id}  ${i.status}${i.archived ? " (archived)" : ""}${stop}  ${i.approval}  ${i.stepsDone}/${i.stepsTotal} steps  ${next}`.trimEnd();
}

function read<T>(ctx: PlanCtx, command: string, args: string[], fn: () => T): T {
  return guarded(ctx, command, args, ["info.retrieve"], "Reading plans", fn);
}

export function registerPlanCommands(program: Command): void {
  const plan = program.command("plan").description("Work with plans (create, approve, list, status, next, start, step-done, stop, resume, budget, retarget, review, finish, merge, abandon, delete)");
  const collect = (v: string, prev: string[] = []): string[] => [...prev, v];

  plan.command("create <words...>").description("Scaffold a plan named <today>-<two to four words>")
    .option("--title <title>").option("--implements <spec>", "specification the plan implements (repeatable)", collect).option("--writes <spec>", "specification the plan writes (repeatable)", collect)
    .option("--reference <cite>", "cite the plan references (repeatable)", collect)
    .action((words: string[], o) => run("create", words, o, (ctx) => { const r = createPlan(ctx, { words, title: o.title, implements: o.implements, writes: o.writes, references: o.reference }); out(`Created plan ${r.id} (awaiting review). Approve it with: specplane plan approve ${r.id}`); }));

  plan.command("approve <id>").description("Approve a plan (a person only; committed content)")
    .action((id: string) => run("approve", [id], undefined, (ctx) => { const r = approvePlan(ctx, id); out(r.already ? `Plan ${id} is already approved.` : `Approved plan ${id} (${r.commit?.slice(0, 12)}).`); }));

  plan.command("list").description("List plans with their statuses and next steps").option("--live", "read each started plan from its own checkout").option("--json")
    .action((o) => run("list", [], o, (ctx) => {
      const infos = read(ctx, "plan list", [], () => listInfos(ctx, !!o.live, (id) => liveRoot(ctx, id)));
      if (o.json) json(infos); else if (!infos.length) out("No plans."); else infos.forEach((i) => out(line(i)));
    }));

  plan.command("status <id>").description("Show a plan's live status and next step").option("--json")
    .action((id: string, o) => run("status", [id], o, (ctx) => {
      const info = read(ctx, "plan status", [id], () => { const { root, rec } = requirePlan(ctx, id); return describePlan(ctx, root, rec); });
      if (o.json) { json(info); return; }
      out(line(info));
      if (info.stop) out(`Stopped: ${info.stop.reason ?? ""}${info.stop.needs ? `; needs: ${info.stop.needs}` : ""}`);
      if (info.branch) out(`Branch ${info.branch}, target ${info.target}, checkout ${info.location}`);
    }));

  plan.command("next <id>").description("Show the next step and check a selection (read-only)").option("--from <n>", "first step of a selection", (v) => Number(v)).option("--count <n>", "number of steps, or all", "1").option("--selection <s>", "next, a count, all or <first>..<last>").option("--json")
    .action((id: string, o) => run("next", [id], o, (ctx) => {
      const res = read(ctx, "plan next", [id], () => { const { root, rec } = requirePlan(ctx, id); const info = describePlan(ctx, root, rec); return { info, sel: checkSelectionText(info, o.selection, o.from ?? null, o.count === "all" ? "all" : Number(o.count)) }; });
      if (o.json) json({ next: res.info.next, selection: res.sel }); else { if (res.info.next) out(`Next step: ${pad(res.info.next.number)} ${res.info.next.title}${res.info.next.waiting ? ` (${res.info.next.waiting})` : ""}`); out(res.sel.message); }
      if (!res.sel.ok) failed = true;
    }));

  plan.command("start <id>").description("Start a plan in its own worktree on branch plan/<id>").option("--target <branch>").option("--force-deps <ids>", "start although these referenced plans are not completed (comma separated)")
    .action((id: string, o) => run("start", [id], o, (ctx) => { const r = startPlan(ctx, id, { target: o.target, forceDeps: o.forceDeps?.split(",").map((x: string) => x.trim()).filter(Boolean) }); out(`Started ${id} on ${r.branch} (target ${r.target}).\nWorktree: ${r.path}`); }));

  plan.command("step-done <id>").description("Record a step from its handoff entry and commit it").requiredOption("--step <n>", "step number", (v) => Number(v)).requiredOption("--outcome <outcome>", "done or partial")
    .option("--summary <text>").option("--type <type>", "Conventional Commits type", "feat")
    .action((id: string, o) => run("step-done", [id], o, (ctx) => {
      if (o.outcome !== "done" && o.outcome !== "partial") { throw new UsageError("--outcome must be done or partial"); }
      const r = stepDone(ctx, id, { step: o.step, outcome: o.outcome, summary: o.summary, type: o.type });
      out(`Recorded step ${pad(o.step)} (${o.outcome}) in ${r.commit.slice(0, 12)}.${r.allDone ? ` Every step is done; open the final review with: specplane plan review ${id}` : r.next ? ` Next: step ${pad(r.next)}.` : ""}`);
    }));

  plan.command("stop <id>").description("Stop a plan (soft stop)").option("--kind <kind>", "soft, user, hard or failure", "user").option("--reason <text>").option("--needs <text>")
    .action((id: string, o) => run("stop", [id], o, (ctx) => { stopPlan(ctx, id, { kind: o.kind, reason: o.reason, needs: o.needs }); out(`Stopped ${id}.`); }));

  plan.command("resume <id>").description("Resume a stopped plan and print what the new session reads").option("--json")
    .action((id: string, o) => run("resume", [id], o, (ctx) => {
      const r = resumePlan(ctx, id);
      if (o.json) { json(r); return; }
      out(`Resumed ${id} in ${r.path}${r.recreatedWorktree ? " (worktree recreated)" : ""}.`);
      if (r.next) out(`Continue at step ${pad(r.next.number)} ${r.next.title} (${r.next.file}).`);
      if (r.sessionLog) out(`Skim the log of session ${r.sessionLog}; trust the files and the last commit over it.`);
    }));

  plan.command("retarget <id>").description("Choose a new target branch for a started plan").requiredOption("--target <branch>")
    .action((id: string, o) => run("retarget", [id], o, (ctx) => { retargetPlan(ctx, id, o.target); out(`Target of ${id} is now ${o.target}.`); }));

  plan.command("budget <id>").description("Set or remove a budget for a resource (percent of the limit)").requiredOption("--resource <name>").option("--soft <n>", "soft stop", (v) => Number(v)).option("--hard <n>", "hard stop", (v) => Number(v)).option("--remove")
    .action((id: string, o) => run("budget", [id], o, (ctx) => { setBudget(ctx, id, { resource: o.resource, soft: o.soft, hard: o.hard, remove: !!o.remove }); out(`Budget for ${o.resource} ${o.remove ? "removed" : `set to soft ${o.soft}, hard ${o.hard}`}.`); }));

  plan.command("review <id>").description("Open the final review").option("--json")
    .action((id: string, o) => run("review", [id], o, (ctx) => { const r = reviewPlan(ctx, id); if (o.json) json(r); else out(formatReview(r)); }));

  plan.command("finish <id>").description("Decide the final review: --complete (archives) or --back <reason>").option("--complete").option("--back <reason>")
    .action((id: string, o) => run("finish", [id], o, (ctx) => { const r = finishPlan(ctx, id, { complete: !!o.complete, back: o.back }); out(r.decision === "completed" ? `Completed and archived ${id}. Merge with: specplane plan merge ${id} --pr | --local${r.unrun.length ? `\nSteps that never ran: ${r.unrun.map(pad).join(", ")}` : ""}` : `${id} is back in progress.`); }));

  plan.command("merge <id>").description("Merge a completed plan's branch by pull request or local merge").option("--pr").option("--local").option("--force", "discard uncommitted work in the plan worktree")
    .action((id: string, o) => run("merge", [id], o, (ctx) => {
      if (!!o.pr === !!o.local) throw new UsageError("Give exactly one of --pr or --local.");
      out(mergePlan(ctx, id, { mode: o.pr ? "pr" : "local", force: !!o.force }).message);
    }));

  plan.command("abandon <id>").description("Abandon a plan: archive it, remove its worktree, keep its branch").option("--force", "remove the worktree even with uncommitted changes")
    .action((id: string, o) => run("abandon", [id], o, (ctx) => { const r = abandonPlan(ctx, id, { force: !!o.force }); out(`Abandoned ${id}.${r.kept ? ` Branch ${r.kept} was kept.` : ""}`); }));

  const meta = plan.command("meta").description("Read and change plan metadata (get, set)");
  meta.command("get <id>").description("Show a plan's metadata, approval and execution status").option("--json")
    .action((id: string, o) => run("meta get", [id], o, (ctx) => {
      const m = planMetaGet(ctx, id);
      if (o.json) { json(m); return; }
      out(`id: ${m.id}\ntitle: ${m.title}\napproval: ${m.approval}\nstatus: ${m.status}${m.archived ? " (archived)" : ""}${m.stop?.reason ? ` [${m.stop.reason}]` : ""}`);
      out(`authors: ${JSON.stringify(m.authors)}\nimplements: ${JSON.stringify(m.implements)}\nreferences: ${JSON.stringify(m.references)}`);
      out(`current step: ${m.current_step ?? "none"}; done: ${JSON.stringify(m.done)}\nbranch: ${m.branch ?? "none"}; target: ${m.target_branch ?? "none"}; session: ${m.session ?? "none"}`);
      if (m.budget.length) out(`budget: ${JSON.stringify(m.budget)}`);
    }));

  meta.command("set <id> <field> <value>").description("Set title, authors, references or implements of a plan (lists are comma separated; empty clears)")
    .action((id: string, field: string, value: string) => run("meta set", [id, field], undefined, (ctx) => {
      const r = planMetaSet(ctx, id, field, value);
      out(`Set ${field} of ${id} (${r.commit.slice(0, 12)}). A change to the title, references or specifications changes the plan's approval, so approve it again.`);
    }));

  plan.command("delete <id>").description("Delete a plan").option("--force", "remove the worktree even with uncommitted changes")
    .action((id: string, o) => run("delete", [id], o, (ctx) => { deletePlan(ctx, id, { force: !!o.force }); out(`Deleted ${id}.`); }));
}
