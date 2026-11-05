#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { executeOperation } from "./core/index.js";
import { generateCommand } from "./commands/generate.js";
import { reportError } from "./errors.js";
import { planGraphCommand, planListCommand, planNewCommand, planShowCommand, planFinishCommand, planStartCommand, planAbandonCommand, planCleanupCommand, planArchiveCommand, planRestackCommand, planNextCommand, planStepDoneCommand } from "./commands/plan.js";
import { planApproveCommand } from "./commands/plan-approve.js";
import { decisionAcceptCommand, decisionNewCommand } from "./commands/decision.js";
import { initCommand } from "./commands/init.js";
import { specListCommand, specNewCommand, specShowCommand, specValidateCommand } from "./commands/spec.js";
import { specPinCommand } from "./commands/spec-pin.js";
import { specApproveCommand, specReopenCommand } from "./commands/spec-approve.js";
import { searchCommand } from "./commands/search.js";
import { docsCommand, docsSearchCommand } from "./commands/docs.js";
import { validateCommand } from "./commands/validate.js";
import { workflowListCommand, workflowRecoverCommand } from "./commands/workflow.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("specplane")
  .description("Specplane reference CLI")
  .version(pkg.version);

const plan = program.command("plan").description("Work with plans (list, new, show, graph, next, step-done, start, approve, finish, abandon, cleanup, archive, restack, retarget)");
plan
  .command("index")
  .description("Generate the plan index from an explicit snapshot")
  .option("--source <source>", "head, staged, or working", "head")
  .option("--print", "print Markdown without writing")
  .option("--live", "include live status and targets (requires --print)")
  .action(generateCommand);
program.on("command:*", (args: string[]) => {
  if (args[0] === "generate") { process.stderr.write("The generate command was removed; use specplane plan index.\n"); process.exitCode = 1; }
  else { process.stderr.write(`Unknown command: ${args[0]}\n`); process.exitCode = 1; }
});
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
plan.command("start <id>").description("Start or resume a plan (branch, worktree, setup hook)").option("--no-fetch", "do not fetch origin before starting").option("--target <branch>", "select an integration target").option("--dry-run", "prepare without mutation").option("--json", "print the result as JSON").action((id, opts) => planStartCommand(id, opts));
plan.command("retarget <id>").description("Reconcile the recorded destination without committing").requiredOption("--target <branch>").option("--dry-run").option("--json").action((id: string, opts: { target: string; dryRun?: boolean; json?: boolean }) => {
  const result = executeOperation({ operation: 'plan.retarget', arguments: { id, target: opts.target, dryRun: !!opts.dryRun } }, { extensionId: 'cli' });
  if (!result.ok) { process.stderr.write(`${result.error.message}\n`); process.exitCode = 1; return; }
  if (opts.json) process.stdout.write(`${JSON.stringify(result.value)}\n`);
  else {
    const value = result.value;
    process.stdout.write(`${id}: ${value.old_target} -> ${value.new_target}; ${value.changed ? (opts.dryRun ? 'preview' : 'updated, uncommitted') : 'unchanged'}\n`);
    if (opts.dryRun) process.stdout.write(`Original start: ${value.start_target_branch} at ${value.start_base}\nComparison baseline: ${value.comparison_base ?? '(none)'}\nChanged paths: ${value.changed_files.map(f => f.path).join(', ') || '(none)'}\nRefs may change before the update.\n`);
  }
});
for (const operation of ['shelve', 'resume'] as const) {
  plan.command(`${operation} <id>`).description(`${operation} a started plan`).option('--dry-run', 'preview without mutation').option('--json', 'output a structured receipt').action((id: string, opts: { dryRun?: boolean; json?: boolean }) => {
    const result = executeOperation({ operation: operation === 'shelve' ? 'plan.shelve' : 'plan.resume', arguments: { id, ...(opts.dryRun ? { dryRun: true } : {}) } }, { extensionId: 'cli' });
    if (!result.ok) { process.stderr.write(`${result.error.message}\n`); process.exitCode = 1; return; }
    if (opts.json) { process.stdout.write(`${JSON.stringify(result.value)}\n`); return; }
    process.stdout.write(`${opts.dryRun ? 'Would ' + operation : operation === 'shelve' ? 'Shelved' : 'Resumed'} ${id} on ${result.value.target}${result.value.commit ? ` (${result.value.commit})` : ''}\n`);
    if (result.value.effectiveStatus) process.stdout.write(`Effective status: ${result.value.effectiveStatus}\n`);
    if (result.value.next) process.stdout.write(`Next step: ${result.value.next.number} ${result.value.next.title} (${result.value.next.status})\n`);
    if (operation === 'resume' && !result.value.checkout) process.stdout.write(`Checkout missing; run specplane plan start ${id} to recreate it.\n`);
  });
}
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
  .option("--recording-set <file>", "required reviewed digest-bound JSON manifest outside the checkout")
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
function completionCommand(id: string, opts: { root?: string; dryRun?: boolean; json?: boolean; status?: string }, alias: boolean): void {
  const common = { id, ...(opts.root !== undefined ? { root: opts.root } : {}), ...(opts.dryRun ? { dryRun: true } : {}) };
  const request = alias ? { operation: "spec.complete" as const, arguments: common } : { operation: "spec.implementation" as const, arguments: { ...common, status: opts.status as "incomplete" | "partial" | "complete" } };
  const result = executeOperation(request, { extensionId: "cli" });
  if (!result.ok) { process.stderr.write(`${result.error.message}\n`); process.exitCode = 1; return; }
  if (opts.json) process.stdout.write(`${JSON.stringify(result.value)}\n`);
  else process.stdout.write(`${result.value.id}: implementation ${result.value.implementation_status}; assessment ${result.value.assessment_status}${result.value.changed ? (result.value.dry_run ? " (dry run)" : " (updated)") : " (unchanged)"}\n`);
}
spec.command("complete <id>").description("Declare implementation complete").option("--root <name>").option("--dry-run").option("--json").action((id, opts) => completionCommand(id, opts, true));
spec.command("implementation <id>").description("Declare implementation status").requiredOption("--status <status>").option("--root <name>").option("--dry-run").option("--json").action((id, opts) => completionCommand(id, opts, false));
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
  .option("--json", "output JSON")
  .action((id: string, opts: { root?: string; json?: boolean }) => specShowCommand(id, opts));
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

const docs = program
  .command("docs [topic]")
  .description("Read the bundled product documentation (offline)")
  .option("--json", "output JSON")
  .action((topic: string | undefined, opts) => docsCommand(topic, opts));
docs
  .command("search <text...>")
  .description("Search the bundled documentation")
  .option("--json", "output JSON")
  // The parent also declares --json and consumes it wherever it appears.
  .action((words: string[], opts, command: Command) => docsSearchCommand(words, { json: Boolean(opts.json || command.parent?.opts().json) }));

program
  .command("validate")
  .description("Validate the repository")
  .option("--json", "output JSON")
  .action((opts: { json?: boolean }) => validateCommand(opts));


// D20 item 6 (spec: A3, R1): operator view and recovery of leases left by an ended host session.
const workflow = program.command("workflow").description("Inspect and recover workflow leases left by an ended session (list, recover)");
workflow.command("list").description("List leases retained with host-worker evidence (read-only)").option("--json", "output JSON").action((opts: { json?: boolean }) => workflowListCommand(opts));
workflow
  .command("recover <request-id>")
  .description("Release a lease left by an ended session; confirmed by typing the request id on a terminal")
  .option("--dry-run", "run every check without confirming or changing anything")
  .option("--json", "output JSON")
  .action((requestId: string, opts: { dryRun?: boolean; json?: boolean }) => workflowRecoverCommand(requestId, opts));

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
