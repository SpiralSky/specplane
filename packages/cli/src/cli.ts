#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { generateCommand } from "./commands/generate.js";
import { reportError } from "./errors.js";
import { planRunCommand, planGraphCommand, planListCommand, planNewCommand, planShowCommand, planFinishCommand, planStartCommand, planAbandonCommand, planCleanupCommand, planArchiveCommand, planRestackCommand, planNextCommand, planStepDoneCommand } from "./commands/plan.js";
import { planApproveCommand } from "./commands/plan-approve.js";
import { decisionAcceptCommand, decisionNewCommand } from "./commands/decision.js";
import { initCommand } from "./commands/init.js";
import { specListCommand, specNewCommand, specShowCommand, specValidateCommand } from "./commands/spec.js";
import { specPinCommand } from "./commands/spec-pin.js";
import { specApproveCommand, specReopenCommand } from "./commands/spec-approve.js";
import { searchCommand } from "./commands/search.js";
import { validateCommand } from "./commands/validate.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("specplane")
  .description("Specplane reference CLI")
  .version(pkg.version);

const plan = program.command("plan").description("Work with plans (list, new, show, graph, next, step-done, start, approve, finish, abandon, cleanup, archive, restack)");
plan
  .command("list")
  .description("List plans with their effective statuses")
  .option("--status <status>", "filter by effective status")
  .option("--json", "output JSON")
  .option("--live", "include plan activity (branches, steps, last step commit) and remote-only plans")
  .option("--no-fetch", "with --live, do not fetch origin first")
  .action((opts) => planListCommand(opts));
plan
  .command("new")
  .description("Create a draft plan folder")
  .option("--id <id>", "full plan ID (YYYY-MM-DD-slug)")
  .option("--title <title>", "plan title")
  .option("--specs <ids>", "comma-separated spec IDs")
  .option("--depends-on <ids>", "comma-separated plan IDs")
  .option("--target <branch>", "intended integration branch")
  .option("--comparison-base <commit>", "comparison baseline commit")
  .option("--dry-run", "validate without creating the plan")
  .action((opts) => planNewCommand(opts));
plan.command("show <id>").description("Print a plan's PLAN.md").action((id) => planShowCommand(id));
plan.command("start <id>").description("Start or resume a plan (branch, worktree, setup hook)").option("--no-fetch", "do not fetch origin before starting").option("--target <branch>", "select an integration target").option("--dry-run", "prepare without mutation").option("--json", "print the result as JSON").option("--run", "unavailable in standalone CLI; use an installed execution extension").action((id, opts) => planStartCommand(id, opts));
plan
  .command("finish <id>")
  .description("Finish a plan: tests, rebase, done and archive commit, merge (lists open spec-gaps.md entries)")
  .option("--yes", "confirm the local merge without asking")
  .option("--no-fetch", "do not fetch origin during the flow")
  .action((id, opts) => planFinishCommand(id, opts));
plan
  .command("abandon <id>")
  .description("Abandon a plan: mark it abandoned, remove its worktree")
  .option("--delete-branch", "also delete branch plan/<id>")
  .option("--force", "remove the worktree even if it has uncommitted changes")
  .action((id, opts) => planAbandonCommand(id, opts));
plan
  .command("cleanup <id>")
  .description("Remove the worktree and delete plan/<id> once the plan is done on the default branch")
  .option("--force", "remove the worktree even if it has uncommitted changes")
  .action((id, opts) => planCleanupCommand(id, opts));
plan.command("archive <id>").description("Move a done or abandoned plan into the archive").action((id) => planArchiveCommand(id));
plan
  .command("restack <id>")
  .description("Rebase a stacked plan's own commits onto its new base")
  .option("--dry-run", "check and report without rewriting history")
  .action((id, opts) => planRestackCommand(id, opts));
plan
  .command("next <id>")
  .description("Show the next step, its context, and the recommended action (read-only)")
  .option("--json", "print the result as JSON")
  .option("--no-fetch", "accepted for symmetry with `plan list --live`; `plan next` never fetches")
  .action((id, opts) => planNextCommand(id, opts));
plan.command("run <ids...>")
  .description("Run isolated plan steps through a capability-checked harness; never approve, finish or merge")
  .option("--harness <name>", "session adapter: claude; codex CLI-only integration fails closed")
  .option("--until <target>", "step or finish", "step")
  .option("--max-steps <n>", "maximum sessions per plan", "1")
  .option("--max-parallel <n>", "maximum distinct plans in flight")
  .option("--max-budget-usd <n>", "total reserved budget per plan, divided among maximum steps")
  .option("--timeout-seconds <n>", "stop observing after this duration; leave session running", "900")
  .option("--force", "request completed-step rerun; never bypass safety gates")
  .option("--reason <text>", "required explanation for a forced rerun")
  .option("--step <n>", "explicit completed step to rerun with --force --reason")
  .option("--dry-run", "read-only gate/capability check, no session launched")
  .option("--json", "output structured result")
  .action((ids, opts) => planRunCommand(ids, opts));
const collect = (v: string, prev: string[] = []): string[] => [...prev, v];
plan
  .command("step-done <id>")
  .description("Append the step's HANDOFF.md section, set its status, and make the step commit (never pushes)")
  .requiredOption("--outcome <outcome>", "done, blocked, or skipped")
  .requiredOption("--summary <text>", "commit subject text after `<type>(<slug>): `")
  .option("--type <type>", "Conventional Commits type of the step's main change", "feat")
  .option("--changed <path:reason>", "file changed and why (repeatable, order kept)", collect)
  .option("--deviation <text>", "deviation from the plan (repeatable)", collect)
  .option("--open-issue <text>", "open issue (repeatable; `BLOCKED: ...` when blocked)", collect)
  .option("--gap <id>", "spec-gaps.md entry this step added, e.g. G3 (repeatable)", collect)
  .option("--next-knows <text>", "what the next step must know")
  .option("--step <n>", "step number (default: the lowest step not done or skipped)", (v) => Number(v))
  .option("--force", "override the blocker guard and mark the step done anyway")
  .option("--reason <text>", "audit reason required when re-recording a completed step")
  .option("--trailer <line>", "extra trailer such as `Co-Authored-By: ...` (repeatable)", collect)
  .action((id, opts) => planStepDoneCommand(id, opts));
plan.command("graph").description("Print the Mermaid dependency graph").action(() => planGraphCommand());
plan
  .command("approve <ids...>")
  .description("Approve plans and commit the status change")
  .option("--dry-run", "report the planned changes and commits")
  .action((ids: string[], opts: { dryRun?: boolean }) => planApproveCommand(ids, opts));

const spec = program.command("spec").description("Work with specs (new, list, show, validate, pin, approve, reopen)");
spec
  .command("approve <ids...>")
  .description("Approve specs and commit the status change")
  .option("--dry-run", "report the planned changes and commits")
  .action((ids: string[], opts: { dryRun?: boolean }) => specApproveCommand(ids, opts));
spec
  .command("reopen <id>")
  .description("Set an approved spec back to review")
  .option("--dry-run", "report the planned change and commit")
  .action((id: string, opts: { dryRun?: boolean }) => specReopenCommand(id, opts));
spec
  .command("pin [id] [refs...]")
  .description("Write or check base pins (based_on) of a spec")
  .option("--check", "list stale pins for all specs; exit 1 if any")
  .action((id: string | undefined, refs: string[], opts: { check?: boolean }) => specPinCommand(id, refs, opts));

spec
  .command("new <type> <slug>")
  .description("Create a draft spec")
  .option("--root <name>", "spec root to create in", "base")
  .option("--title <title>", "spec title")
  .option("--implements <ids>", "feature spec IDs implemented (architecture specs)")
  .option("--extends <ids>", "base spec IDs extended (overlay specs)")
  .action((type: string, slug: string, opts) => specNewCommand(type, slug, opts));
spec
  .command("list")
  .description("List specs")
  .option("--status <status>", "filter by status")
  .option("--type <type>", "filter by type (feature or architecture)")
  .option("--root <name>", "filter by root")
  .option("--json", "output JSON")
  .action((opts) => specListCommand(opts));
spec
  .command("show <id>")
  .description("Print a spec file")
  .option("--root <name>", "qualify the root")
  .action((id: string, opts: { root?: string }) => specShowCommand(id, opts));
spec
  .command("validate [ids...]")
  .description("Validate one, several, or all specs")
  .option("--json", "output JSON")
  .action((ids: string[], opts: { json?: boolean }) => specValidateCommand(ids, opts));

const decision = program.command("decision").description("Work with decision records (new, accept)");
decision.command("new <title>").description("Create a proposed decision record").action((title: string) => decisionNewCommand(title));
decision
  .command("accept <ids...>")
  .description("Accept decision records and commit the status change")
  .option("--dry-run", "report the planned changes and commits")
  .action((ids: string[], opts: { dryRun?: boolean }) => decisionAcceptCommand(ids, opts));

program
  .command("search <text>")
  .description("Search specs and plans")
  .option("--kind <kind>", "restrict to spec or plan files")
  .option("--status <status>", "filter by status")
  .option("--root <name>", "restrict to a spec root")
  .option("--json", "output JSON")
  .action((text: string, opts) => searchCommand(text, opts));

program
  .command("validate")
  .description("Validate the repository")
  .option("--json", "output JSON")
  .action((opts: { json?: boolean }) => validateCommand(opts));

program
  .command("generate")
  .description("Generate PLANS.md")
  .option("--print", "write to stdout instead of the file")
  .option("--live", "with --print, show effective (git-derived) statuses")
  .action((opts: { print?: boolean; live?: boolean }) => generateCommand(opts));

program
  .command("init")
  .description("Initialise Specplane in a repository")
  .option("--harness <name>", "also install the named agent harness (e.g. claude)")
  .action((opts: { harness?: string }) => initCommand(opts));

try {
  await program.parseAsync(process.argv);
} catch (e) {
  if (!reportError(e)) throw e;
}
