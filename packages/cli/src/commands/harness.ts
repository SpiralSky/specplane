import type { Command } from "commander";
import { checkoutRoot } from "../git/repo.js";
import { runHarnessCommand } from "../harness/run.js";
import { runCommand } from "./runner.js";

/** `specplane harness run <command> [args]` and `specplane mcp` (`architecture/reference-cli` §12.2, §12.1). */
export function registerHarnessCommands(program: Command): void {
  const harness = program.command("harness").description("Harness plumbing: the user-command runner the harness hooks invoke");
  harness
    .command("run <command> [args...]")
    .description("Run a harness command as the person who typed it, with no model call (refuses anything outside the harness command list)")
    .allowUnknownOption()
    .option("--json")
    .action((command: string, args: string[], opts: { json?: boolean }) =>
      runCommand({ command: "harness run", args: [command, ...args], json: opts.json }, () => runHarnessCommand(command, args, checkoutRoot())));
  program
    .command("mcp")
    .description("Serve the Specplane MCP server on stdio (started by a harness adapter, not by hand)")
    .action(async () => { await (await import("../harness/mcp-run.js")).runMcp(); });
}
