import type { CommandResult } from "../commands/runner.js";

/** The short human form of a command result (`architecture/reference-cli` §13.3): what happened, then details. */
export function formatText(r: CommandResult): { stdout: string; stderr: string } {
  const nl = (ls: string[]) => (ls.length ? ls.join("\n") + "\n" : "");
  const findings = (r.findings ?? []).map((f) => (typeof f === "string" ? f : null)).filter((f): f is string => f !== null);
  const warnings = (r.warnings ?? []).map((w) => `warning: ${w}`);
  return { stdout: nl(r.lines ?? []), stderr: nl([...findings, ...warnings]) };
}
