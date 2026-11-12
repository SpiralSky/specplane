import { checkoutRoot } from "../git/repo.js";
import { formatReport, validateProject } from "../verify/validate.js";
import type { CommandResult } from "./runner.js";

export function validateCommand(ids: string[], root: string = checkoutRoot()): CommandResult {
  const report = validateProject(root, { ids });
  return { ok: report.counts.errors === 0, data: report, findings: [], lines: formatReport(report).replace(/\n$/, "").split("\n"), permission: "info.retrieve" };
}
