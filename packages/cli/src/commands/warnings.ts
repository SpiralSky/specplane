import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { collectWarnings, narrowWarnings } from "../verify/warnings.js";
import type { CommandResult } from "./runner.js";

/** `specplane warnings [<id>]` (`architecture/reference-cli` §6.3). Needs `info.retrieve`. */
export function warningsCommand(id?: string): CommandResult {
  const root = checkoutRoot();
  const g = guard(activePreset(root), cliActor(root), ["info.retrieve"], "Listing warnings");
  if (g.kind !== "allow") return { ok: false, findings: [g.kind === "deny" ? g.message : "Listing warnings needs approval from the user."], permission: "info.retrieve" };
  const all = collectWarnings(root);
  const list = id ? narrowWarnings(all, id) : all;
  const lines = list.length ? list.flatMap((w) => [`[${w.subject}] ${w.text}`, `    why: ${w.why}`]) : [id ? `No warnings for ${id}.` : "No warnings."];
  return { ok: true, data: list, lines, permission: "info.retrieve" };
}
