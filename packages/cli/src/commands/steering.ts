import { checkoutRoot } from "../git/repo.js";
import { CATALOG } from "../perm/permissions.js";
import { inspectSteering, STEERING_COMMANDS, type SteeringContext } from "../harness/steering.js";
import type { CommandResult } from "./runner.js";
import { beginCommand } from "../harness/active-command.js";

/** A public view of exactly the LLM's generated steering, with no permission required. */
export function steeringCommand(target: string, context: SteeringContext = {}): CommandResult {
  if (target !== "role" && !CATALOG.includes(target) && !Object.hasOwn(STEERING_COMMANDS, target)) {
    return { ok: false, findings: [`Unknown steering command or permission: ${target}`] };
  }
  const root = checkoutRoot();
  const session = process.env.SPECPLANE_SESSION?.trim();
  if (session && Object.hasOwn(STEERING_COMMANDS, target)) beginCommand(root, session, target);
  const result = inspectSteering(root, target, context);
  return { ok: result.trusted, data: result, lines: [result.text], findings: result.warnings };
}
