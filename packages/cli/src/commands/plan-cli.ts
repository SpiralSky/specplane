import type { Command } from "commander";
import { reportError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliRole, gitUserName, type Actor } from "../perm/permissions.js";
import { approvePlan, createPlan } from "../plan/create.js";
import { guarded, liveRoot, requirePlan, writeRun, type PlanCtx } from "../plan/ctx.js";
import { abandonPlan, deletePlan, finishPlan, formatReview, mergePlan, reviewPlan } from "../plan/finish.js";
import { resumePlan, retargetPlan, setBudget, startPlan, stepDone, stopPlan } from "../plan/run.js";
import { checkSelection, describePlan, listInfos, type PlanInfo } from "../plan/status.js";

/** Human CLI commands for plans (`architecture/reference-cli` §11, §13.1). */

function context(): PlanCtx {
  const root = checkoutRoot();
  const actor: Actor = { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown" };
  return { root, actor, preset: activePreset(root) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
const json = (v: unknown) => out(JSON.stringify(v, null, 2));

function run(fn: (ctx: PlanCtx) => void): void {
  try { fn(context()); } catch (e) { if (!reportError(e)) throw e; }
}

function line(i: PlanInfo): string {
  const next = i.next ? `next ${pad(i.next.number)} ${i.next.title}${i.next.waiting ? ` (${i.next.waiting})` : ""}` : i.reviewPending ? "final review pending" : "";
  const stop = i.stop?.reason ? ` [${i.stop.reason}]` : "";
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
    .action((words: string[], o) => run((ctx) => { const r = createPlan(ctx, { words, title: o.title, implements: o.implements, writes: o.writes, references: o.reference }); out(`Created plan ${r.id} (awaiting review). Approve it with: specplane plan approve ${r.id}`); }));

  plan.command("approve <id>").description("Approve a plan (a person only; committed content)")
    .action((id: string) => run((ctx) => { const r = approvePlan(ctx, id); out(r.already ? `Plan ${id} is already approved.` : `Approved plan ${id} (${r.commit?.slice(0, 12)}).`); }));

  plan.command("list").description("List plans with their statuses and next steps").option("--live", "read each started plan from its own checkout").option("--json")
    .action((o) => run((ctx) => {
      const infos = read(ctx, "plan list", [], () => listInfos(ctx, !!o.live, (id) => liveRoot(ctx, id)));
      if (o.json) json(infos); else if (!infos.length) out("No plans."); else infos.forEach((i) => out(line(i)));
    }));

  plan.command("status <id>").description("Show a plan's live status and next step").option("--json")
    .action((id: string, o) => run((ctx) => {
      const info = read(ctx, "plan status", [id], () => { const { root, rec } = requirePlan(ctx, id); return describePlan(ctx, root, rec); });
      if (o.json) { json(info); return; }
      out(line(info));
      if (info.stop) out(`Stopped: ${info.stop.reason ?? ""}${info.stop.needs ? `; needs: ${info.stop.needs}` : ""}`);
      if (info.branch) out(`Branch ${info.branch}, target ${info.target}, checkout ${info.location}`);
    }));

  plan.command("next <id>").description("Show the next step and check a selection (read-only)").option("--from <n>", "first step of a selection", (v) => Number(v)).option("--count <n>", "number of steps, or all", "1").option("--json")
    .action((id: string, o) => run((ctx) => {
      const res = read(ctx, "plan next", [id], () => { const { root, rec } = requirePlan(ctx, id); const info = describePlan(ctx, root, rec); return { info, sel: checkSelection(info, o.from ?? null, o.count === "all" ? "all" : Number(o.count)) }; });
      if (o.json) json({ next: res.info.next, selection: res.sel }); else { if (res.info.next) out(`Next step: ${pad(res.info.next.number)} ${res.info.next.title}${res.info.next.waiting ? ` (${res.info.next.waiting})` : ""}`); out(res.sel.message); }
      if (!res.sel.ok) process.exitCode = 1;
    }));

  plan.command("start <id>").description("Start a plan in its own worktree on branch plan/<id>").option("--target <branch>").option("--force-deps <ids>", "start although these referenced plans are not completed (comma separated)")
    .action((id: string, o) => run((ctx) => { const r = startPlan(ctx, id, { target: o.target, forceDeps: o.forceDeps?.split(",").map((x: string) => x.trim()).filter(Boolean) }); out(`Started ${id} on ${r.branch} (target ${r.target}).\nWorktree: ${r.path}`); }));

  plan.command("step-done <id>").description("Record a step from its handoff entry and commit it").requiredOption("--step <n>", "step number", (v) => Number(v)).requiredOption("--outcome <outcome>", "done or partial")
    .option("--summary <text>").option("--type <type>", "Conventional Commits type", "feat")
    .action((id: string, o) => run((ctx) => {
      if (o.outcome !== "done" && o.outcome !== "partial") { process.stderr.write("--outcome must be done or partial\n"); process.exitCode = 2; return; }
      const r = stepDone(ctx, id, { step: o.step, outcome: o.outcome, summary: o.summary, type: o.type });
      out(`Recorded step ${pad(o.step)} (${o.outcome}) in ${r.commit.slice(0, 12)}.${r.allDone ? ` Every step is done; open the final review with: specplane plan review ${id}` : r.next ? ` Next: step ${pad(r.next)}.` : ""}`);
    }));

  plan.command("stop <id>").description("Stop a plan (soft stop)").option("--kind <kind>", "soft, user, hard or failure", "user").option("--reason <text>").option("--needs <text>")
    .action((id: string, o) => run((ctx) => { stopPlan(ctx, id, { kind: o.kind, reason: o.reason, needs: o.needs }); out(`Stopped ${id}.`); }));

  plan.command("resume <id>").description("Resume a stopped plan and print what the new session reads").option("--json")
    .action((id: string, o) => run((ctx) => {
      const r = resumePlan(ctx, id);
      if (o.json) { json(r); return; }
      out(`Resumed ${id} in ${r.path}${r.recreatedWorktree ? " (worktree recreated)" : ""}.`);
      if (r.next) out(`Continue at step ${pad(r.next.number)} ${r.next.title} (${r.next.file}).`);
      if (r.sessionLog) out(`Skim the log of session ${r.sessionLog}; trust the files and the last commit over it.`);
    }));

  plan.command("heartbeat <id>").description("Refresh the plan's run marker (for harness adapters)").action((id: string) => run((ctx) => { writeRun(ctx, id, process.env.SPECPLANE_SESSION || null); }));

  plan.command("retarget <id>").description("Choose a new target branch for a started plan").requiredOption("--target <branch>")
    .action((id: string, o) => run((ctx) => { retargetPlan(ctx, id, o.target); out(`Target of ${id} is now ${o.target}.`); }));

  plan.command("budget <id>").description("Set or remove a budget for a resource (percent of the limit)").requiredOption("--resource <name>").option("--soft <n>", "soft stop", (v) => Number(v)).option("--hard <n>", "hard stop", (v) => Number(v)).option("--remove")
    .action((id: string, o) => run((ctx) => { setBudget(ctx, id, { resource: o.resource, soft: o.soft, hard: o.hard, remove: !!o.remove }); out(`Budget for ${o.resource} ${o.remove ? "removed" : `set to soft ${o.soft}, hard ${o.hard}`}.`); }));

  plan.command("review <id>").description("Open the final review").option("--json")
    .action((id: string, o) => run((ctx) => { const r = reviewPlan(ctx, id); if (o.json) json(r); else out(formatReview(r)); }));

  plan.command("finish <id>").description("Decide the final review: --complete (archives) or --back <reason>").option("--complete").option("--back <reason>")
    .action((id: string, o) => run((ctx) => { const r = finishPlan(ctx, id, { complete: !!o.complete, back: o.back }); out(r.decision === "completed" ? `Completed and archived ${id}. Merge with: specplane plan merge ${id} --pr | --local${r.unrun.length ? `\nSteps that never ran: ${r.unrun.map(pad).join(", ")}` : ""}` : `${id} is back in progress.`); }));

  plan.command("merge <id>").description("Merge a completed plan's branch by pull request or local merge").option("--pr").option("--local").option("--force", "discard uncommitted work in the plan worktree")
    .action((id: string, o) => run((ctx) => {
      if (!!o.pr === !!o.local) { process.stderr.write("Give exactly one of --pr or --local.\n"); process.exitCode = 2; return; }
      out(mergePlan(ctx, id, { mode: o.pr ? "pr" : "local", force: !!o.force }).message);
    }));

  plan.command("abandon <id>").description("Abandon a plan: archive it, remove its worktree, keep its branch").option("--force", "remove the worktree even with uncommitted changes")
    .action((id: string, o) => run((ctx) => { const r = abandonPlan(ctx, id, { force: !!o.force }); out(`Abandoned ${id}.${r.kept ? ` Branch ${r.kept} was kept.` : ""}`); }));

  plan.command("delete <id>").description("Delete a plan").option("--force", "remove the worktree even with uncommitted changes")
    .action((id: string, o) => run((ctx) => { deletePlan(ctx, id, { force: !!o.force }); out(`Deleted ${id}.`); }));
}
