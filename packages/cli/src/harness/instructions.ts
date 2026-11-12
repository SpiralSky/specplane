import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadSettings } from "../config.js";
import { permissionDoc } from "../perm/catalog.js";
import { type RoleId } from "../perm/permissions.js";
import { updateStoreJson } from "../repo/store.js";
import { inspectSteering, STEERING_COMMANDS, type SteeringContext } from "./steering.js";

export const COMMANDS = Object.keys(STEERING_COMMANDS);
const WRITES_SPECS = new Set(["spec-assist", "spec-draft-architecture", "plan-step", "migrate"]);
export function readContract(command: string): string {
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command contract: ${command}`);
  return readFileSync(new URL(`../../assets/commands/${command}.md`, import.meta.url), "utf8").trim();
}

/** Generated from user documentation at build time; U13 can extend the documentation bundle. */
export function commandDocumentation(command: string): string {
  const docs = JSON.parse(readFileSync(new URL("../../assets/commands/documentation.json", import.meta.url), "utf8")) as Record<string, string>;
  if (!Object.hasOwn(docs, command) || typeof docs[command] !== "string") throw new Error(`Missing command documentation: ${command}`);
  return docs[command];
}

export interface InstructionText { key: string; text: string; hash: string; warnings: string[]; trusted: boolean }
export interface InstructionOptions extends SteeringContext { role?: RoleId }
export function assembleInstructions(root: string, key: string, options: InstructionOptions = {}): InstructionText {
  const permission = permissionDoc(key);
  if (!permission && !COMMANDS.includes(key)) throw new Error(`Unknown instruction key: ${key}`);
  const { config, findings } = loadSettings(root);
  const steering = inspectSteering(root, key, options, options.role ?? "llm");
  const parts: string[] = [];
  // A failed generation must never deliver a cached promise of wider permissions.
  if (steering.trusted) {
    if (permission) {
      parts.push(`Permission: ${key}\nAllows: ${permission.allows}\nDoes not allow: ${permission.doesNotAllow}`);
    } else {
      parts.push(readContract(key));
      const replacements = config.values["harness.instructions"] as Record<string, string>;
      const documentation = Object.hasOwn(replacements, key) ? replacements[key] : commandDocumentation(key);
      if (documentation) parts.push(`## Command documentation\n\n${documentation}`);
    }
  }
  parts.push(steering.text);
  if (steering.trusted && key === "spec-review" && config.values["harness.separation_check"]) {
    parts.push("## Separation check\n\nFor each specification reviewed, verify that feature content describes behaviour and architecture content describes implementation. Report mixing of the layers as a finding; change nothing.");
  }
  if (steering.trusted && WRITES_SPECS.has(key) && config.values["harness.separation_check"]) {
    parts.push("## Separation check\n\nFor each specification change, verify that feature content describes behaviour and architecture content describes implementation. Warn the user about mixing the layers; do not silently rewrite a higher layer.");
  }
  const text = parts.join("\n\n");
  return { key, text, hash: createHash("sha256").update(text).digest("hex"), trusted: steering.trusted,
    warnings: [...findings.map((f) => f.message), ...steering.warnings] };
}

interface SessionState { epoch: number; delivered: { key: string; hash: string }[] }
function state(value: unknown): SessionState {
  const s = value as SessionState | null;
  if (!s || !Number.isSafeInteger(s.epoch) || s.epoch < 0 || !Array.isArray(s.delivered) ||
      s.delivered.some((d) => !d || typeof d.key !== "string" || typeof d.hash !== "string" || !/^[a-f0-9]{64}$/.test(d.hash))) {
    return { epoch: 0, delivered: [] }; // Missing or damaged state never proves context is present.
  }
  return s;
}
function sessionFile(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) throw new Error("Invalid instruction session ID");
  return `sessions/${id}.json`;
}

export interface InstructionSession {
  root: string;
  id: string;
  /** False if compaction or current context cannot reliably be reported. */
  reportsContext: boolean;
  canDeliverAtCommand?: boolean;
  point?: "command" | "session-start";
  /** Adapter packages this exact assembled text; return a pointer only after packaging succeeds. */
  prepareOnDemand?: (instruction: InstructionText) => string;
}
export interface InstructionDelivery {
  key: string; hash: string;
  status: "delivered" | "already-delivered" | "unavailable";
  text?: string; pointer?: string; notices: string[];
}

/** The caller attaches the returned payload in the same command reply. No action permissions are changed. */
export function deliver(session: InstructionSession, key: string, options: InstructionOptions = {}): InstructionDelivery {
  const file = sessionFile(session.id);
  const instruction = assembleInstructions(session.root, key, options);
  const result: InstructionDelivery = { key, hash: instruction.hash, status: "delivered", notices: [...instruction.warnings] };
  const payload = (): void => {
    if (session.canDeliverAtCommand === false && session.point !== "session-start") {
      result.status = "unavailable";
      result.notices.push("This harness cannot deliver instructions at a command. Deliver them at session start before running this command.");
      return;
    }
    if (session.prepareOnDemand && instruction.trusted) {
      const pointer = session.prepareOnDemand(instruction);
      if (!pointer.trim()) throw new Error("Empty on-demand instruction pointer");
      result.pointer = pointer;
    } else result.text = instruction.text;
    if (session.canDeliverAtCommand === false) result.notices.push("Command instructions were delivered at session start because this harness cannot deliver them at a command.");
  };
  let prepared = false;
  try {
    updateStoreJson<SessionState>(session.root, file, (previous) => {
      const current = state(previous);
      if (session.reportsContext && instruction.trusted && current.delivered.some((d) => d.key === key && d.hash === instruction.hash)) {
        result.status = "already-delivered";
        return current;
      }
      payload();
      prepared = true;
      // Unknown context invalidates prior proofs, but never marks anything delivered.
      if (!session.reportsContext) return { epoch: current.epoch, delivered: [] };
      if (result.status !== "delivered" || !instruction.trusted) return current;
      return { epoch: current.epoch, delivered: [...current.delivered.filter((d) => d.key !== key), { key, hash: instruction.hash }] };
    });
  } catch {
    // Store unavailable, lock contention or packaging failure: repeat safely, never suppress delivery.
    if (!prepared) {
      result.status = "delivered";
      try { payload(); } catch {
        result.status = "unavailable";
        result.notices.push("The harness could not prepare on-demand instructions; the command cannot proceed.");
      }
    }
    result.notices.push("Instruction delivery could not be recorded reliably; instructions will be sent again when context is uncertain.");
  }
  return result;
}

/** Called by an adapter's compaction hook. The same session may now receive every key again. */
export function advanceEpoch(session: Pick<InstructionSession, "root" | "id">): number {
  let epoch = 0;
  updateStoreJson<SessionState>(session.root, sessionFile(session.id), (previous) => {
    epoch = state(previous).epoch + 1;
    if (!Number.isSafeInteger(epoch)) throw new Error("Instruction epoch overflow");
    return { epoch, delivered: [] };
  });
  return epoch;
}
