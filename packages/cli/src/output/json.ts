import type { CommandResult } from "../commands/runner.js";

/** The JSON form of a command result: `{ok, data, findings, warnings}` (`architecture/reference-cli` §13.3). */
export function formatJson(r: CommandResult): string {
  return JSON.stringify({ ok: r.ok, data: r.data ?? null, findings: r.findings ?? [], warnings: r.warnings ?? [], ...(r.warningCount !== undefined ? { warning_count: r.warningCount } : {}) }) + "\n";
}
