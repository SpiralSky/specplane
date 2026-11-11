import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor } from "../perm/permissions.js";
import { implementSpec } from "../verify/implementation.js";
import type { CommandResult } from "./runner.js";

export async function specImplementCommand(id: string): Promise<CommandResult> {
  const root = checkoutRoot();
  const report = await implementSpec({ root, actor: cliActor(root), preset: activePreset(root) }, id);
  const findings = [
    ...report.failed.map((t) => `${t}: failed`),
    ...report.missing.map((t) => `${t}: no passing result from this run`),
    ...report.needsHarness.map((t) => `${t}: needs harness for intelligent judgement`),
  ];
  const lines = [`${report.id}: ${report.implemented ? "implemented" : "unimplemented"} (checked ${report.commit.slice(0, 8)})`];
  if (report.dirty) lines.push("note: uncommitted changes were ignored; checks used the committed content");
  return { ok: report.implemented, data: report, lines, findings, warnings: report.warnings, permission: "test.record" };
}
