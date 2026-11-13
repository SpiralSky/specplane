import { readStoreJson, writeStoreJson } from "../repo/store.js";
import { STEERING_COMMANDS } from "./steering.js";

function file(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) throw new Error("Invalid command session ID");
  return `sessions/${id}.command.json`;
}

/** Separate from instruction delivery proofs: compaction must not lift a command restriction. */
export function activeCommand(root: string, session: string): string | undefined {
  return readStoreJson<{ command: string }>(root, file(session))?.command;
}

/** Shared by the command runner, steering entry and MCP; never supplied as an action identity. */
export function beginCommand(root: string, session: string, command: string): void {
  if (!Object.hasOwn(STEERING_COMMANDS, command)) throw new Error(`Unknown harness command: ${command}`);
  writeStoreJson(root, file(session), { command });
}
