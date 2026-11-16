#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { specImplementCommand } from "./commands/spec-implement.js";
import { reportError } from "./errors.js";
import { requestsAccept, requestsDecline, requestsList, requestsShow } from "./commands/requests.js";
import { registerDecisionCommands } from "./commands/decision-cli.js";
import { registerPlanCommands } from "./commands/plan-cli.js";
import { registerHarnessCommands } from "./commands/harness.js";
import { initCommand } from "./commands/init.js";
import { specListCommand, specShowCommand } from "./commands/spec-read.js";
import { mapCommand, mappingsCommand, roleApproveCommand, roleCreateCommand, roleDeleteCommand, roleDescribeCommand, roleEditCommand, roleListCommand, ruleApproveCommand, ruleCreateCommand, ruleDeleteCommand, ruleEditCommand, ruleListCommand, ruleShowCommand, ruleTrustCommand, unmapCommand } from "./commands/role.js";
import { presetCreateCommand, presetDeleteCommand, presetEditCommand, presetListCommand, presetShowCommand } from "./commands/preset.js";
import { configGetCommand, configListCommand, configSetCommand, configUnsetCommand, permissionsCommand } from "./commands/config.js";
import { roleShowHuman, roleSwitchHuman, specApproveHuman, specMetaGetHuman, specMetaSetHuman, specOverrideHuman, migrateStatusHuman, specReopenHuman, syncHuman } from "./commands/spec-human.js";
import { docsCommand, docsEssentialsCommand, docsSearchCommand } from "./commands/docs.js";
import { validateCommand } from "./commands/validate.js";
import { warningsCommand } from "./commands/warnings.js";
import { steeringCommand } from "./commands/steering.js";
import { coverageCommand } from "./commands/coverage.js";
import { checkRequirementIdsCommand, checkStrictCommand, checkTestsCommand } from "./commands/check.js";
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
registerDecisionCommands(program);
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
const presetCmd = program.command("preset").description("Create, edit and delete permission presets (feature/roles-and-permissions R56)");
const collect = (v: string, prev: string[]): string[] => [...prev, v];
presetCmd.command("list").description("List the default and custom presets").option("--json").action((opts) => runCommand({ command: "preset list", json: opts.json }, () => presetListCommand()));
presetCmd.command("show <id>").description("Show the mode every role has for every permission in a preset").option("--json").action((id: string, opts) => runCommand({ command: "preset show", args: [id], json: opts.json }, () => presetShowCommand(id)));
presetCmd.command("create <id>").description("Create a custom preset (needs the config.change permission and a management level above the roles it applies to)")
  .option("--default-mode <mode>", "mode of every permission the preset does not list: allow, request-user or deny").option("--from <preset>", "copy the modes of this preset").option("--title <text>", "a readable title")
  .option("--set <role:permission=mode>", "set a mode; use <role>:* for the role default (repeatable)", collect, []).option("--json")
  .action((id: string, opts) => runCommand({ command: "preset create", args: [id], json: opts.json }, () => presetCreateCommand(id, { defaultMode: opts.defaultMode, from: opts.from, title: opts.title, sets: opts.set })));
presetCmd.command("edit <id>").description("Change a custom preset; the default presets cannot be edited")
  .option("--default-mode <mode>", "mode of every permission the preset does not list").option("--title <text>", "a readable title")
  .option("--set <role:permission=mode>", "set a mode; use <role>:* for the role default (repeatable)", collect, []).option("--unset <role:permission>", "remove a mode so the default applies (repeatable)", collect, []).option("--json")
  .action((id: string, opts) => runCommand({ command: "preset edit", args: [id], json: opts.json }, () => presetEditCommand(id, { defaultMode: opts.defaultMode, title: opts.title, sets: opts.set, unsets: opts.unset })));
presetCmd.command("delete <id>").description("Delete a custom preset that is not the active preset").option("--json").action((id: string, opts) => runCommand({ command: "preset delete", args: [id], json: opts.json }, () => presetDeleteCommand(id)));
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
requests.command("accept <id>").description("Accept a request: the action is done once, under your permission").option("--note <text>").option("--commit", "commit the config or preset file the action wrote, so it is in effect now").option("--json").action((id: string, opts) => runCommand({ command: "requests accept", args: [id], json: opts.json }, () => requestsAccept(id, opts.note, { commit: opts.commit })));
requests.command("decline <id>").description("Decline a request: nothing changes").option("--note <text>").option("--json").action((id: string, opts) => runCommand({ command: "requests decline", args: [id], json: opts.json }, () => requestsDecline(id, opts.note)));
const role = program.command("role").description("Show or switch the CLI role; create, approve and map custom roles (feature/roles-and-permissions R43, R44, R48, R49, R60)");
role.command("show [id]").description("Show the CLI role, or one role with its management level and permissions").option("--json").action((id: string | undefined, opts) => runCommand({ command: "role show", ...(id ? { args: [id] } : {}), json: opts.json }, () => (id ? roleDescribeCommand(id) : roleShowHuman())));
role.command("list").description("List the default and custom roles with their management levels and approval state").option("--json").action((opts) => runCommand({ command: "role list", json: opts.json }, () => roleListCommand()));
const levelOption = (v: string): number => Number(v);
role.command("create <id>").description("Create a custom role (needs the role.manage permission and a management level above the new role)")
  .option("--level <n>", "management level, 1 to 99 (R49)", levelOption).option("--default-mode <mode>", "mode of every permission the role does not list: allow, request-user or deny").option("--title <text>", "a readable title")
  .option("--set <permission=mode>", "set a mode (repeatable)", collect, []).option("--json")
  .action((id: string, opts) => runCommand({ command: "role create", args: [id], json: opts.json }, () => roleCreateCommand(id, { level: opts.level, defaultMode: opts.defaultMode, title: opts.title, sets: opts.set })));
role.command("edit <id>").description("Change a custom role; the change is pending until approved")
  .option("--level <n>", "management level, 1 to 99", levelOption).option("--default-mode <mode>", "mode of every permission the role does not list").option("--title <text>", "a readable title")
  .option("--set <permission=mode>", "set a mode (repeatable)", collect, []).option("--unset <permission>", "remove a mode so the default applies (repeatable)", collect, []).option("--json")
  .action((id: string, opts) => runCommand({ command: "role edit", args: [id], json: opts.json }, () => roleEditCommand(id, { level: opts.level, defaultMode: opts.defaultMode, title: opts.title, sets: opts.set, unsets: opts.unset })));
role.command("delete <id>").description("Delete a custom role").option("--json").action((id: string, opts) => runCommand({ command: "role delete", args: [id], json: opts.json }, () => roleDeleteCommand(id)));
role.command("approve <id>").description("Approve the committed file of a custom role (needs role.manage and a management level above the role)").option("--json").action((id: string, opts) => runCommand({ command: "role approve", args: [id], json: opts.json }, () => roleApproveCommand(id)));
role.command("map <os-user> <role>").description("Map an operating system user to a role on this machine (needs the role.map permission; local, not in git)")
  .option("--allow-admin-switch", "let this user switch to the Administrator (Administrator only)").option("--json")
  .action((u: string, r: string, opts) => runCommand({ command: "role map", args: [u, r], json: opts.json }, () => mapCommand(u, r, !!opts.allowAdminSwitch)));
role.command("unmap <os-user>").description("Remove the mapping of an operating system user on this machine").option("--json").action((u: string, opts) => runCommand({ command: "role unmap", args: [u], json: opts.json }, () => unmapCommand(u)));
role.command("mappings").description("List the operating system user mappings of this machine").option("--json").action((opts) => runCommand({ command: "role mappings", json: opts.json }, () => mappingsCommand()));
const rule = role.command("rule").description("LLM role rules: which role an LLM gets, by subagent, agent type, provider, model (R44.1)");
rule.command("list").description("List the rules and whether each applies").option("--json").action((opts) => runCommand({ command: "role rule list", json: opts.json }, () => ruleListCommand()));
rule.command("show <id>").description("Show one rule").option("--json").action((id: string, opts) => runCommand({ command: "role rule show", args: [id], json: opts.json }, () => ruleShowCommand(id)));
rule.command("create <id>").description("Create a rule (needs the role.map permission and a role below your level)")
  .option("--role <role>", "the role the rule gives").option("--match <factor=value>", "a factor to match: subagent, agent_type, provider, model, delegated (repeatable)", collect, [])
  .option("--priority <n>", "higher wins when several rules match (default 0)", levelOption).option("--title <text>", "a readable title").option("--json")
  .action((id: string, opts) => runCommand({ command: "role rule create", args: [id], json: opts.json }, () => ruleCreateCommand(id, { role: opts.role, matches: opts.match, priority: opts.priority, title: opts.title })));
rule.command("edit <id>").description("Change a rule; a changed rule is approved again before it applies")
  .option("--role <role>", "the role the rule gives").option("--match <factor=value>", "set a factor (repeatable)", collect, []).option("--unmatch <factor>", "remove a factor (repeatable)", collect, [])
  .option("--priority <n>", "higher wins when several rules match", levelOption).option("--title <text>", "a readable title").option("--json")
  .action((id: string, opts) => runCommand({ command: "role rule edit", args: [id], json: opts.json }, () => ruleEditCommand(id, { role: opts.role, matches: opts.match, unmatches: opts.unmatch, priority: opts.priority, title: opts.title })));
rule.command("delete <id>").description("Delete a rule").option("--json").action((id: string, opts) => runCommand({ command: "role rule delete", args: [id], json: opts.json }, () => ruleDeleteCommand(id)));
rule.command("approve <id>").description("Approve the committed file of a rule (needs role.manage and a level above the role it gives)").option("--json").action((id: string, opts) => runCommand({ command: "role rule approve", args: [id], json: opts.json }, () => ruleApproveCommand(id)));
rule.command("trust <id>").description("Trust an approved rule that gives a role above the default LLM role, on this machine only").option("--json").action((id: string, opts) => runCommand({ command: "role rule trust", args: [id], json: opts.json }, () => ruleTrustCommand(id)));
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

const checkCmd = program.command("check").description("Pre-commit checks on the staged changes");
checkCmd
  .command("requirement-ids")
  .description("Refuse duplicate requirement IDs in the index; installed by pre_commit.duplicate_requirement_ids")
  .option("--staged", "check the index (required)")
  .option("--json", "output JSON")
  .action((opts: { staged?: boolean; json?: boolean }) => runCommand({ command: "check requirement-ids", args: opts.staged ? ["--staged"] : [], json: opts.json }, () => checkRequirementIdsCommand(opts)));
checkCmd
  .command("tests")
  .description("Run the deterministic tests of all architecture specs on the index when anything is staged; installed by pre_commit.tests")
  .option("--staged", "check the index (required)")
  .option("--timeout <seconds>", "wall-clock limit per command (default 120)")
  .option("--json", "output JSON")
  .action((opts: { staged?: boolean; timeout?: string; json?: boolean }) => runCommand({ command: "check tests", args: opts.staged ? ["--staged"] : [], json: opts.json }, () => checkTestsCommand(opts)));

checkCmd
  .command("strict")
  .description("Refuse a commit by an LLM process that stages changes its role may not make directly; installed by strict_mode.git_commit_guard")
  .option("--staged", "check the index (required)")
  .option("--json", "output JSON")
  .action((opts: { staged?: boolean; json?: boolean }) => runCommand({ command: "check strict", args: opts.staged ? ["--staged"] : [], json: opts.json }, () => checkStrictCommand(opts)));

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
