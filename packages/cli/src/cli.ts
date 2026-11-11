#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { specImplementCommand } from "./commands/spec-implement.js";
import { reportError } from "./errors.js";
import { requestsAccept, requestsDecline, requestsList, requestsShow } from "./commands/requests.js";
import { registerPlanCommands } from "./commands/plan-cli.js";
import { registerHarnessCommands } from "./commands/harness.js";
import { initCommand } from "./commands/init.js";
import { specListCommand, specShowCommand } from "./commands/spec-read.js";
import { configGetCommand, configListCommand, configSetCommand, configUnsetCommand, permissionsCommand } from "./commands/config.js";
import { roleShowHuman, roleSwitchHuman, specApproveHuman, specMetaGetHuman, specMetaSetHuman, specOverrideHuman, migrateStatusHuman, specReopenHuman, syncHuman } from "./commands/spec-human.js";
import { docsCommand, docsEssentialsCommand, docsSearchCommand } from "./commands/docs.js";
import { validateCommand } from "./commands/validate.js";
import { warningsCommand } from "./commands/warnings.js";
import { steeringCommand } from "./commands/steering.js";
import { coverageCommand } from "./commands/coverage.js";
import { testRunCommand } from "./commands/test.js";
import { runCommand } from "./commands/runner.js";
import { auditCommand } from "./commands/audit.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("specplane")
  .description("Specplane reference CLI")
  .version(pkg.version)
  .exitOverride();

program.on("command:*", (args: string[]) => {
  if (args[0] === "generate") process.stderr.write("The generate command was removed.\n");
  else process.stderr.write(`Unknown command: ${args[0]}\n`);
  process.exitCode = 2;
});
// Usage errors (unknown option, missing argument) exit 2; help and version exit 0 (`reference-cli` §13.3).
registerPlanCommands(program);
registerHarnessCommands(program);
program.command("steering <target>").description("Show complete generated LLM steering for a command, permission, or role")
  .option("--spec-type <type>", "scope to requirement, feature, or architecture")
  .option("--plan-id <id>", "scope to a plan")
  .option("--json")
  .action((target: string, opts) => {
    if (opts.specType && !["requirement", "feature", "architecture"].includes(opts.specType)) {
      return runCommand({ command: "steering", args: [target], json: opts.json }, () => ({ ok: false, findings: ["Unknown spec type"] }));
    }
    return runCommand({ command: "steering", args: [target], json: opts.json }, () => steeringCommand(target, { specType: opts.specType, planId: opts.planId }));
  });

const spec = program.command("spec").description("Work with specs (list, show, approve, reopen, meta, override)");
spec.command("implement <id>").description("Verify committed architecture content and mark implemented when every check passes")
  .option("--json", "output JSON")
  .action((id: string, opts) => runCommand({ command: "spec implement", args: [id], json: opts.json }, () => specImplementCommand(id)));
spec
  .command("approve <ids...>")
  .description("Approve specs by ID (committed content only; a group is approved together)")
  .option("--yes", "confirm group approval in advance")
  .option("--ref <branch>", "approve the specs as written on this branch (default: the current branch)")
  .option("--json", "output JSON")
  .action((ids: string[], opts) => runCommand({ command: "spec approve", args: ids, json: opts.json }, () => specApproveHuman(ids, opts)));
spec
  .command("reopen <id>")
  .description("Set a spec back to awaiting review")
  .option("--json", "output JSON")
  .action((id: string, opts) => runCommand({ command: "spec reopen", args: [id], json: opts.json }, () => specReopenHuman(id)));
const meta = spec.command("meta").description("Read or correct spec metadata");
meta.command("get <id>").description("Show metadata, with overrides marked").option("--json").action((id: string, opts) => runCommand({ command: "spec meta get", args: [id], json: opts.json }, () => specMetaGetHuman(id)));
meta
  .command("set <id> <field> <value>")
  .description("Set title, authors, covers, implements or references (lists are comma separated; authors are human:<name> or llm:<model>)")
  .option("--no-commit", "stage instead of committing")
  .option("--json")
  .action((id: string, field: string, value: string, opts) => runCommand({ command: "spec meta set", args: [id, field], json: opts.json }, () => specMetaSetHuman(id, field, value, opts)));
const override = spec.command("override").description("Protected overrides (Administrator by default)");
override.command("status <id> <status>").description("Set status by hand: approved or awaiting-review").option("--json")
  .action((id: string, status: string, opts) => runCommand({ command: "spec override status", args: [id, status], json: opts.json }, () => specOverrideHuman("status", id, [status], opts)));
override.command("approver <id> <approver>").description("Set the approver: human:<name> or llm:<model>@<human>").option("--json")
  .action((id: string, approver: string, opts) => runCommand({ command: "spec override approver", args: [id, approver], json: opts.json }, () => specOverrideHuman("approver", id, [approver], opts)));
override.command("approval-commit <id> <commit>").description("Set the commit shown as the approved one (display only)").option("--json")
  .action((id: string, commit: string, opts) => runCommand({ command: "spec override approval-commit", args: [id, commit], json: opts.json }, () => specOverrideHuman("approval-commit", id, [commit], opts)));
override.command("test <id> <test> <result>").description("Set a test result (passed, failed) or clear it").option("--summary <text>").option("--json")
  .action((id: string, test: string, result: string, opts) => runCommand({ command: "spec override test", args: [id, test, result], json: opts.json }, () => specOverrideHuman("test", id, [test, result], opts)));
program.command("sync [remote]").description("Fetch, merge and push the notes store (approval records) with a remote").option("--json").action((remote: string | undefined, opts) => runCommand({ command: "sync", args: remote ? [remote] : [], json: opts.json }, () => syncHuman(remote)));
const migrate = program.command("migrate").description("One-time moves of older data");
migrate.command("status").description("Move frontmatter status, approval, results and implementation records into the notes store").option("--dry-run", "list the records and edits without writing").option("--json").action((opts) => runCommand({ command: "migrate status", json: opts.json }, () => migrateStatusHuman(opts)));
const configCmd = program.command("config").description("Read or change settings (feature/configuration)");
configCmd.command("get [key]").description("Show a setting, its source and default; all settings without a key").option("--json").action((key: string | undefined, opts) => runCommand({ command: "config get", args: key ? [key] : [], json: opts.json }, () => configGetCommand(key)));
configCmd.command("list").description("Show every setting").option("--json").action((opts) => runCommand({ command: "config list", json: opts.json }, () => configListCommand()));
configCmd.command("set <key> <value>").description("Set a setting (needs the config.change permission)").option("--json").action((k: string, v: string, opts) => runCommand({ command: "config set", args: [k, v], json: opts.json }, () => configSetCommand(k, v)));
configCmd.command("unset <key>").description("Remove a setting so its default applies").option("--json").action((k: string, opts) => runCommand({ command: "config unset", args: [k], json: opts.json }, () => configUnsetCommand(k)));
program.command("permissions [id]").description("Show which role holds which permission, or the documentation of one permission").option("--json").action((id: string | undefined, opts) => runCommand({ command: "permissions", args: id ? [id] : [], json: opts.json }, () => permissionsCommand(id)));
program
  .command("audit")
  .description("Read the audit log (needs info.retrieve)")
  .option("--since <date>", "only entries on or after this date")
  .option("--branch <name>", "only entries made on this branch")
  .option("--actor <role>", "only entries by this role")
  .option("--json")
  .action((opts) => runCommand({ command: "audit", json: opts.json }, () => auditCommand(opts)));
const requests = program.command("requests").description("The requests list: what an LLM asked you to approve (feature/requests)");
requests.command("list", { isDefault: true }).description("List requests, pending first").option("--json").action((opts) => runCommand({ command: "requests list", json: opts.json }, () => requestsList()));
requests.command("show <id>").description("Show one request in full, with the change as a diff").option("--json").action((id: string, opts) => runCommand({ command: "requests show", args: [id], json: opts.json }, () => requestsShow(id)));
requests.command("accept <id>").description("Accept a request: the action is done once, under your permission").option("--note <text>").option("--json").action((id: string, opts) => runCommand({ command: "requests accept", args: [id], json: opts.json }, () => requestsAccept(id, opts.note)));
requests.command("decline <id>").description("Decline a request: nothing changes").option("--note <text>").option("--json").action((id: string, opts) => runCommand({ command: "requests decline", args: [id], json: opts.json }, () => requestsDecline(id, opts.note)));
const role = program.command("role").description("Show or switch the CLI role");
role.command("show").option("--json").action((opts) => runCommand({ command: "role show", json: opts.json }, () => roleShowHuman()));
role.command("switch <role>").description("administrator or standard-user").option("--json").action((r: string, opts) => runCommand({ command: "role switch", args: [r], json: opts.json }, () => roleSwitchHuman(r)));

spec
  .command("list")
  .description("List specs with effective status, authors, current results and implementation (needs info.retrieve)")
  .option("--status <status>", "filter by effective status")
  .option("--type <type>", "filter by type (requirement, feature or architecture)")
  .option("--json", "output JSON")
  .action((opts: { status?: string; type?: string; json?: boolean }) => runCommand({ command: "spec list", args: [], json: opts.json }, () => specListCommand(opts)));
spec
  .command("show <id>")
  .description("Show one spec's effective status, reasons, authors, results and implementation (needs info.retrieve)")
  .option("--json", "output JSON")
  .action((id: string, opts: { json?: boolean }) => runCommand({ command: "spec show", args: [id], json: opts.json }, () => specShowCommand(id)));

const docs = program
  .command("docs [topic]")
  .description("Read the bundled product documentation (offline)")
  .option("--json", "output JSON")
  .action((topic: string | undefined, opts) => docsCommand(topic, opts));
docs
  .command("essentials")
  .description("Print the short essentials file a harness loads into the model's context")
  .action(() => docsEssentialsCommand());
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
  .action((ids: string[], opts: { json?: boolean }) => runCommand({ command: "validate", args: ids, json: opts.json }, () => validateCommand(ids)));
program
  .command("warnings [id]")
  .description("List the current warnings, or those of one spec or plan (needs info.retrieve)")
  .option("--json", "output JSON")
  .action((id: string | undefined, opts: { json?: boolean }) => runCommand({ command: "warnings", args: id ? [id] : [], json: opts.json }, () => warningsCommand(id)));
program
  .command("coverage")
  .description("Show which specs cover each requirement and feature spec (needs info.retrieve)")
  .option("--uncovered", "only the items nothing covers")
  .option("--json", "output JSON")
  .action((opts: { uncovered?: boolean; json?: boolean }) => runCommand({ command: "coverage", args: opts.uncovered ? ["--uncovered"] : [], json: opts.json }, () => coverageCommand(opts)));
const testCmd = program.command("test").description("Run the tests the specs declare");
testCmd
  .command("run [target]")
  .description("Run deterministic tests on the committed content at HEAD: <spec>[#<section>] or --all (needs info.retrieve)")
  .option("--all", "run every declared test")
  .option("--timeout <seconds>", "wall-clock limit per command (default 120)")
  .option("--json", "output JSON")
  .action((target: string | undefined, opts: { all?: boolean; timeout?: string; json?: boolean }) => runCommand({ command: "test run", args: [...(target ? [target] : []), ...(opts.all ? ["--all"] : [])], json: opts.json }, () => testRunCommand(target, opts)));

program
  .command("init")
  .description("Initialise Specplane in a repository")
  .option("--harness <name>", "also install the named agent harness (claude or codex)")
  .action((opts: { harness?: string }) => initCommand(opts));

try {
  await program.parseAsync(process.argv);
} catch (e) {
  const code = (e as { code?: string; exitCode?: number }).code;
  if (typeof code === "string" && code.startsWith("commander.")) {
    // help and version are successes; every other commander error is a usage error (its message is already printed)
    process.exitCode = ["commander.helpDisplayed", "commander.help", "commander.version"].includes(code) ? 0 : 2;
  } else if (!reportError(e)) {
    process.stderr.write(`Internal error: ${(e as Error).message}\n`);
    process.exitCode = 4;
  }
}
