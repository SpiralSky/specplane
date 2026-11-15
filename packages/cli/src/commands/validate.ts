import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { formatReport, validateProject } from "../verify/validate.js";
import type { CommandResult } from "./runner.js";

export function validateCommand(ids: string[], root: string = checkoutRoot()): CommandResult {
  const g = guard(activePreset(root), cliActor(root), ["info.retrieve"], "Validating specifications");
  if (g.kind !== "allow") return { ok: false, findings: [g.kind === "deny" ? g.message : "Validating specifications needs approval from the user."], permission: "info.retrieve" };
  const report = validateProject(root, { ids });
  return { ok: report.counts.errors === 0, data: report, findings: [], lines: formatReport(report).replace(/\n$/, "").split("\n"), permission: "info.retrieve" };
}
