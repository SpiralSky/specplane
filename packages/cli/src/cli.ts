#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";

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
  ["validate", "Validate the repository"],
  ["generate", "Generate PLANS.md"],
  ["init", "Initialise Specplane in a repository"],
] as const) {
  program
    .command(name)
    .description(description)
    .action(() => {
      process.stderr.write(`specplane ${name}: not implemented yet\n`);
      process.exitCode = 1;
    });
}

program.parse(process.argv);
