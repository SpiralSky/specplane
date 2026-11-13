import type { Command } from "commander";
import { UsageError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor } from "../perm/permissions.js";
import { runHarnessCommand } from "../harness/run.js";
import { runCommand } from "./runner.js";

/** `specplane harness run <command> [args]` and `specplane mcp` (`architecture/reference-cli` §12.2, §12.1). */
export function registerHarnessCommands(program: Command): void {
  const harness = program.command("harness").description("Harness plumbing: the user-command runner the harness hooks invoke");
  harness
    .command("guard-config", { hidden: true })
    .description("Print resolved working-tree hook protections as JSON (read-only)")
    .action(async () => {
      const { guardConfig } = await import("../harness/guard-config.js");
      process.stdout.write(`${JSON.stringify(guardConfig(process.cwd()))}\n`);
    });
  harness
    .command("run <command> [args...]")
    .description("Run a harness command as the person who typed it, with no model call (refuses anything outside the harness command list)")
    .allowUnknownOption()
    .option("--json")
    .option("--adapter <name>", "the host adapter that opens plan sessions (claude or codex)")
    .action(async (command: string, args: string[], opts: { json?: boolean; adapter?: string }) => {
      if (opts.adapter !== undefined && opts.adapter !== "claude" && opts.adapter !== "codex") throw new UsageError(`Unknown adapter: ${opts.adapter}. Supported: claude, codex.`);
      const launcher = opts.adapter === "claude" ? (await import("../harness/adapter-claude.js")).claudeLauncher
        : opts.adapter === "codex" ? (await import("../harness/adapter-codex.js")).codexLauncher : undefined;
      await runCommand({ command: "harness run", args: [command, ...args], json: opts.json }, () => runHarnessCommand(command, args, checkoutRoot(), { launcher, adapter: opts.adapter }));
    });
  harness
    .command("session <plan>", { hidden: true })
    .description("Monitor a plan's Claude Code session: run it, keep the run marker, enforce budgets (started by plan-start, not by hand)")
    .requiredOption("--session <id>", "the session ID the plan record names")
    .option("--resume", "resume the session after a blocking request was answered")
    .action(async (planId: string, opts: { session: string; resume?: boolean }) => {
      const adapter = await import("../harness/adapter-claude.js");
      const root = checkoutRoot();
      const ctx = { root, actor: cliActor(root), preset: activePreset(root) };
      const r = await adapter.runPlanSession(ctx, planId, { spawn: adapter.nodeSpawnPort }, { sessionId: opts.session, resume: opts.resume });
      process.stdout.write(`${r.outcome} (session ${r.session}, exit ${r.exitCode})\n${r.notes.map((n) => `${n}\n`).join("")}`);
    });
  harness
    .command("compact <session>")
    .description("Record that a harness session's context was compacted so its instructions are delivered again (called by the harness compaction hook)")
    .action(async (session: string) => {
      const { advanceEpoch } = await import("../harness/instructions.js");
      try { advanceEpoch({ root: checkoutRoot(), id: session }); } catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exitCode = 1; }
    });
  program
    .command("mcp")
    .description("Serve the Specplane MCP server on stdio (started by a harness adapter, not by hand)")
    .action(async () => { await (await import("../harness/mcp-run.js")).runMcp(); });
}
