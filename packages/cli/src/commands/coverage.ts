import { loadSettings } from "../config.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject } from "../spec/project.js";
import { worktreeSource } from "../spec/source.js";
import { computeCoverage, formatCoverage } from "../verify/coverage.js";
import type { CommandResult } from "./runner.js";

/** `specplane coverage [--uncovered]` (`architecture/reference-cli` §6.4). Needs `info.retrieve`. */
export function coverageCommand(opts: { uncovered?: boolean }): CommandResult {
  const root = checkoutRoot();
  const g = guard(activePreset(root), cliActor(root), ["info.retrieve"], "Reading coverage");
  if (g.kind !== "allow") return { ok: false, findings: [g.kind === "deny" ? g.message : "Reading coverage needs approval from the user."], permission: "info.retrieve" };
  const { paths } = loadSpecPaths(root);
  const only = loadSettings(root).config.values["coverage.requirement_only"] as string[] | undefined;
  const coverage = computeCoverage(loadProject(worktreeSource(root), paths), only ?? []);
  const data = opts.uncovered ? { ...coverage, items: coverage.uncovered } : coverage;
  return { ok: true, data, lines: formatCoverage(coverage, Boolean(opts.uncovered)), permission: "info.retrieve" };
}
