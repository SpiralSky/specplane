import { activePreset, guard, mode, type Mode, type Preset } from "../perm/permissions.js";
import { COMMANDS, readContract } from "./instructions.js";

/**
 * Required permissions of a typed command (`harness R71`, `architecture/agent-skills` "Required permissions"). A
 * contract names the permissions its command cannot do anything without in one `Requires:` line in its Preconditions.
 * Before a typed command with arguments starts a model turn, the harness asks for this check; a deny for the LLM role
 * refuses the command with the standard denial text and no model call. Allow and request user never block the turn.
 */

export interface RequiredPermission { permission: string; mode: Mode }
export interface RequiresCheck { command: string; required: RequiredPermission[]; denied: string | null; message: string | null }

/** The permissions named in a contract's `Requires:` line, in order; none when the contract has no line. */
export function requiresOf(contract: string): string[] {
  const line = /^Requires: (.+)\.$/m.exec(contract)?.[1];
  return line ? [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
}

/** The LLM role's mode for each required permission of `command`, and the first denied one with its refusal text. */
export function checkRequires(command: string, preset: Preset): RequiresCheck {
  if (!COMMANDS.includes(command)) return { command, required: [], denied: null, message: null };
  const needs = requiresOf(readContract(command));
  const required = needs.map((permission) => ({ permission, mode: mode(preset, "llm", permission) }));
  const g = guard(preset, { role: "llm", kind: "llm", name: "llm" }, needs, `/${command}`);
  if (g.kind !== "deny") return { command, required, denied: null, message: null };
  return { command, required, denied: g.permission, message: `${g.message} No model turn started.` };
}

export function checkRequiresAt(root: string, command: string): RequiresCheck {
  return checkRequires(command, activePreset(root));
}
