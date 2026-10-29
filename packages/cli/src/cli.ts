#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { generateCommand } from "./commands/generate.js";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();
program
  .name("specplane")
  .description("Specplane reference CLI")
  .version(pkg.version);

// Placeholders; implemented in later steps.
for (const [name, description] of [
  ["spec", "Work with specs (new, list, show, validate, pin)"],
  ["plan", "Work with plans (new, list, show, graph, start, finish, abandon, cleanup, archive)"],
  ["search", "Search specs and plans"],
] as const) {
  program
    .command(name)
    .description(description)
    .action(() => {
      process.stderr.write(`specplane ${name}: not implemented yet\n`);
      process.exitCode = 1;
    });
}

program
  .command("validate")
  .description("Validate the repository")
  .option("--json", "output JSON")
  .action((opts: { json?: boolean }) => validateCommand(opts));

program
  .command("generate")
  .description("Generate PLANS.md")
  .option("--print", "write to stdout instead of the file")
  .action((opts: { print?: boolean }) => generateCommand(opts));

program
  .command("init")
  .description("Initialise Specplane in a repository")
  .action(() => initCommand());

program.parse(process.argv);
