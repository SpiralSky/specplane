#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { executeOperation } from "./core/index.js";
import { reportError } from "./errors.js";
import { requestsAccept, requestsDecline, requestsList, requestsShow } from "./commands/requests.js";
import { registerPlanCommands } from "./commands/plan-cli.js";
import { decisionAcceptCommand, decisionNewCommand } from "./commands/decision.js";
import { initCommand } from "./commands/init.js";
import { specListCommand, specNewCommand, specShowCommand, specValidateCommand } from "./commands/spec.js";
import { configGetCommand, configListCommand, configSetCommand, configUnsetCommand, permissionsCommand } from "./commands/config.js";
import { roleShowHuman, roleSwitchHuman, specApproveHuman, specMetaGetHuman, specMetaSetHuman, specOverrideHuman, migrateStatusHuman, specReopenHuman, syncHuman } from "./commands/spec-human.js";
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

program.on("command:*", (args: string[]) => {
  if (args[0] === "generate") { process.stderr.write("The generate command was removed.\n"); process.exitCode = 1; }
  else { process.stderr.write(`Unknown command: ${args[0]}\n`); process.exitCode = 1; }
});
registerPlanCommands(program);

const spec = program.command("spec").description("Work with specs (new, list, show, validate, approve, reopen, meta, override)");
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
  .description("Approve specs by ID (committed content only; a group is approved together)")
  .option("--yes", "confirm group approval in advance")
  .option("--ref <branch>", "approve the specs as written on this branch (default: the current branch)")
  .option("--json", "output JSON")
  .action((ids: string[], opts) => specApproveHuman(ids, opts));
spec
  .command("reopen <id>")
  .description("Set a spec back to awaiting review")
  .option("--json", "output JSON")
  .action((id: string, opts) => specReopenHuman(id, opts));
const meta = spec.command("meta").description("Read or correct spec metadata");
meta.command("get <id>").description("Show metadata, with overrides marked").option("--json").action((id: string, opts) => specMetaGetHuman(id, opts));
meta
  .command("set <id> <field> <value>")
  .description("Set title, authors, covers, implements or references (lists are comma separated; authors are human:<name> or llm:<model>)")
  .option("--no-commit", "stage instead of committing")
  .option("--json")
  .action((id: string, field: string, value: string, opts) => specMetaSetHuman(id, field, value, opts));
const override = spec.command("override").description("Protected overrides (Administrator by default)");
override.command("status <id> <status>").description("Set status by hand: approved or awaiting-review").option("--json")
  .action((id: string, status: string, opts) => specOverrideHuman("status", id, [status], opts));
override.command("approver <id> <approver>").description("Set the approver: human:<name> or llm:<model>@<human>").option("--json")
  .action((id: string, approver: string, opts) => specOverrideHuman("approver", id, [approver], opts));
override.command("test <id> <test> <result>").description("Set a test result (passed, failed) or clear it").option("--summary <text>").option("--no-commit").option("--json")
  .action((id: string, test: string, result: string, opts) => specOverrideHuman("test", id, [test, result], opts));
program.command("sync [remote]").description("Fetch, merge and push the notes store (approval records) with a remote").option("--json").action((remote: string | undefined, opts) => syncHuman(remote, opts));
const migrate = program.command("migrate").description("One-time moves of older data");
migrate.command("status").description("Move frontmatter status, approval, results and implementation records into the notes store").option("--dry-run", "list the records and edits without writing").option("--json").action((opts) => migrateStatusHuman(opts));
const configCmd = program.command("config").description("Read or change settings (feature/configuration)");
configCmd.command("get [key]").description("Show a setting, its source and default; all settings without a key").option("--json").action((key: string | undefined, opts) => configGetCommand(key, opts));
configCmd.command("list").description("Show every setting").option("--json").action((opts) => configListCommand(opts));
configCmd.command("set <key> <value>").description("Set a setting (needs the config.change permission)").option("--json").action((k: string, v: string, opts) => configSetCommand(k, v, opts));
configCmd.command("unset <key>").description("Remove a setting so its default applies").option("--json").action((k: string, opts) => configUnsetCommand(k, opts));
program.command("permissions [id]").description("Show which role holds which permission, or the documentation of one permission").option("--json").action((id: string | undefined, opts) => permissionsCommand(id, opts));
const requests = program.command("requests").description("The requests list: what an LLM asked you to approve (feature/requests)");
requests.command("list", { isDefault: true }).description("List requests, pending first").option("--json").action((opts) => requestsList(opts));
requests.command("show <id>").description("Show one request in full, with the change as a diff").option("--json").action((id: string, opts) => requestsShow(id, opts));
requests.command("accept <id>").description("Accept a request: the action is done once, under your permission").option("--note <text>").option("--json").action((id: string, opts) => requestsAccept(id, opts));
requests.command("decline <id>").description("Decline a request: nothing changes").option("--note <text>").option("--json").action((id: string, opts) => requestsDecline(id, opts));
const role = program.command("role").description("Show or switch the CLI role");
role.command("show").action(() => roleShowHuman());
role.command("switch <role>").description("administrator or standard-user").action((r: string) => roleSwitchHuman(r));

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
  .command("validate [ids...]")
  .description("Validate the requirements and specs (format, cites, requirement IDs, status)")
  .option("--json", "output JSON")
  .action((ids: string[], opts: { json?: boolean }) => validateCommand(ids, opts));


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
