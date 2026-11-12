import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadSettings } from "../config.js";
import { permissionDoc } from "../perm/catalog.js";
import { CATALOG, allPresets, findPreset, mode, type Preset, type RoleId } from "../perm/permissions.js";
import { readStoreJson, writeStoreJson } from "../repo/store.js";

/** U9 generation only; U10 assembles delivery and U14 owns installed files. */
export const STEERING_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  "spec-assist": ["info.retrieve", "spec.create.feature", "spec.edit.feature", "spec.create.architecture", "spec.edit.architecture"],
  "spec-draft-architecture": ["info.retrieve", "spec.create.feature", "spec.create.architecture"],
  "plan-create": ["info.retrieve", "plan.create", "plan.edit"], "plan-start": ["plan.start"],
  "plan-step": ["info.retrieve", "spec.edit.requirement", "spec.edit.feature", "spec.edit.architecture", "test.record", "plan.softstop", "plan.resume", "plan.budget"],
  "plan-finish": ["info.retrieve", "plan.complete", "plan.edit"], "plan-status": ["info.retrieve"],
  validate: ["info.retrieve"], verify: ["info.retrieve", "test.record"],
  approve: ["info.retrieve", "spec.approve"], requests: [], "spec-view": ["info.retrieve"], "decision-new": ["decision.retrieve", "decision.add"],
  "spec-review": ["info.retrieve", "decision.retrieve", "decision.add"],
  migrate: ["info.retrieve", "spec.create.requirement", "spec.create.feature", "spec.create.architecture", "decision.add"], "plan-abandon": ["info.retrieve", "plan.abandon", "plan.delete"],
};
export interface CustomSteering { permission?: string; command?: string; scope?: string; text: string }
export interface SteeringContext { specType?: "requirement" | "feature" | "architecture"; planId?: string }
export interface SteeringInputs {
  role: RoleId; preset: Preset; custom: readonly CustomSteering[]; version: string;
}
export type TemplateReader = (name: string) => string;
export const readSteeringTemplate: TemplateReader = (name) => readFileSync(new URL(`../../assets/steering/${name}.md`, import.meta.url), "utf8").trim();
export const UNTRUSTED_STEERING = "Steering cannot be trusted because regeneration failed. Do not rely on earlier instructions or attempt to bypass limits. Use current permission checks through the harness; keep credentials out of summaries. The LLM must not call the Specplane CLI.";
const STATE = "steering.json";
interface SteeringState { stamp: string; failed: boolean }

export function steeringInputs(root: string, role: RoleId = "llm"): SteeringInputs {
  const { config } = loadSettings(root); // HEAD only: pending configuration never becomes active steering.
  return {
    role, preset: findPreset(root, config.permissionsPreset) ?? allPresets(root)[0],
    custom: (config.values["steering.custom"] ?? []) as CustomSteering[],
    version: (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version,
  };
}

/** The preset's content hash is its version, so changing any mode invalidates the stamp too. */
export function steeringStamp(input: SteeringInputs): string {
  const presetVersion = createHash("sha256").update(JSON.stringify(input.preset)).digest("hex");
  return createHash("sha256").update(JSON.stringify([input.preset.id, presetVersion, input.custom, input.version])).digest("hex");
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in values)) throw new Error(`Missing steering value: ${k}`);
    return values[k];
  });
}
function template(read: TemplateReader, name: string): string {
  const text = read(name).trim();
  if (!text) throw new Error(`Empty steering template: ${name}`);
  return text;
}

/** command:"*" is overall steering. Scope selects all, a spec type, or an exact plan id.
 * Overall before targeted, then all before spec-type before plan-id; stable within each tier.
 */
export function matchingCustom(input: SteeringInputs, target: { permission?: string; permissions?: readonly string[]; command?: string }, context: SteeringContext = {}): CustomSteering[] {
  const rank = (c: CustomSteering) => (c.command === "*" ? 0 : 10) + (c.scope && c.scope === context.planId ? 2 : c.scope && c.scope === context.specType ? 1 : 0);
  return input.custom.filter((c) =>
    (c.command === "*" || (target.permission !== undefined && c.permission === target.permission) || (c.permission !== undefined && target.permissions?.includes(c.permission)) || (target.command !== undefined && c.command === target.command)) &&
    (!c.scope || c.scope === "all" || c.scope === context.specType || c.scope === context.planId),
  ).sort((a, b) => rank(a) - rank(b));
}
function customText(items: readonly CustomSteering[]): string {
  return items.length ? "\nCustom steering: on conflict the more specific wins; permissions remain authoritative.\n" + items.map((c) =>
    `Custom steering (${c.scope ?? "all"}): ${c.text}\n[${c.command === "*" ? "overall" : c.permission ? `permission ${c.permission}` : `command ${c.command}`}]`,
  ).join("\n") : "";
}
function stamp(input: SteeringInputs, text: string): string { return `Steering stamp: ${steeringStamp(input)}\n${text}`; }

export function generateRoleSteering(input: SteeringInputs, read: TemplateReader = readSteeringTemplate): string {
  return stamp(input, fill(template(read, "role"), {
    role: input.role, preset: input.preset.id,
    limits: CATALOG.map((id) => `${id}: ${mode(input.preset, input.role, id)}`).join("\n"),
  }) + customText(matchingCustom(input, {})));
}
function permissionText(input: SteeringInputs, id: string, read: TemplateReader): string {
  const doc = permissionDoc(id);
  if (!doc) throw new Error(`Unknown permission: ${id}`);
  const current = mode(input.preset, input.role, id);
  const behavior = {
    allow: "Act directly unless custom steering asks for a request or a user-run command first. Steering does not guarantee confirmation.",
    "request-user": "Send a request naming this one action. Do not do it first; wait for acceptance.",
    deny: "The action is refused. Do not do it or look for another way. Tell the user and leave the next move to them.",
  }[current];
  return fill(template(read, "permission"), {
    permission: id, role: input.role, mode: current, allows: doc.allows, excludes: doc.doesNotAllow, behavior,
  });
}
export function generatePermissionSteering(input: SteeringInputs, id: string, context: SteeringContext = {}, read: TemplateReader = readSteeringTemplate): string {
  return stamp(input, permissionText(input, id, read) + customText(matchingCustom(input, { permission: id }, context)));
}
export function generateCommandSteering(input: SteeringInputs, command: string, context: SteeringContext = {}, read: TemplateReader = readSteeringTemplate): string {
  if (!Object.hasOwn(STEERING_COMMANDS, command)) throw new Error(`Unknown steering command: ${command}`);
  const permissions = STEERING_COMMANDS[command].filter((id) =>
    !context.specType || !id.startsWith("spec.") || id === "spec.approve" || id.endsWith(`.${context.specType}`),
  );
  return stamp(input, [
    `Command: ${command}. Role: ${input.role}.`,
    "Do not call the Specplane CLI; use harness actions. Do not bypass permission limits. Keep credentials out of test-result summaries.",
    template(read, "cases"),
    ...permissions.map((id) => permissionText(input, id, read)),
    customText(matchingCustom(input, { command, permissions }, context)),
  ].join("\n"));
}
export interface SteeringResult { text: string; stamp?: string; warnings: string[]; trusted: boolean }
function failure(): SteeringResult { return { text: UNTRUSTED_STEERING, warnings: [UNTRUSTED_STEERING], trusted: false }; }

/** Inspection and later harness assembly share this exact API, defaulting to the acting LLM. */
export function inspectSteering(root: string, target: string, context: SteeringContext = {}, role: RoleId = "llm", read: TemplateReader = readSteeringTemplate): SteeringResult {
  try {
    const input = steeringInputs(root, role);
    const state = readStoreJson<SteeringState>(root, STATE);
    if (state && (state.failed || state.stamp !== steeringStamp(input))) {
      const refreshed = regenerateSteering(root, read);
      if (!refreshed.trusted) return refreshed;
    }
    const text = target === "role" ? generateRoleSteering(input, read) : CATALOG.includes(target)
      ? generatePermissionSteering(input, target, context, read) : generateCommandSteering(input, target, context, read);
    return { text, stamp: steeringStamp(input), trusted: true, warnings: [] };
  } catch { return failure(); } // Never return cached text that might overstate current permissions.
}

export function regenerateSteering(root: string, read: TemplateReader = readSteeringTemplate): SteeringResult {
  try {
    const input = steeringInputs(root);
    for (const role of ["llm", "standard-user", "administrator"] as const) {
      const actor = { ...input, role };
      generateRoleSteering(actor, read);
      for (const id of CATALOG) generatePermissionSteering(actor, id, {}, read);
      for (const command of Object.keys(STEERING_COMMANDS)) generateCommandSteering(actor, command, {}, read);
    }
    writeStoreJson(root, STATE, { stamp: steeringStamp(input), failed: false } satisfies SteeringState);
    return { text: generateRoleSteering(input, read), stamp: steeringStamp(input), trusted: true, warnings: [] };
  } catch {
    try { writeStoreJson(root, STATE, { stamp: "", failed: true } satisfies SteeringState); } catch { /* Notice still reaches the caller. */ }
    return failure();
  }
}

export function steeringWarnings(root: string, read: TemplateReader = readSteeringTemplate): string[] {
  const current = inspectSteering(root, "role", {}, "llm", read);
  if (!current.trusted) return current.warnings;
  try {
    // Read all templates and all permissions, so a missing command/permission template is visible too.
    const input = steeringInputs(root);
    for (const p of allPresets(root)) for (const id of CATALOG) generatePermissionSteering({ ...input, preset: p }, id, {}, read);
    template(read, "cases");
    const state = readStoreJson<SteeringState>(root, STATE);
    if (state?.failed) return [UNTRUSTED_STEERING];
    if (state && state.stamp !== current.stamp) return ["The local steering stamp differs from committed configuration; steering cannot be trusted until regeneration succeeds."];
    return [];
  } catch { return [UNTRUSTED_STEERING]; }
}

/** Setting writes remain pending. Only regenerate currently effective HEAD configuration (R40). */
export function steeringConfigEffect(root: string): string[] {
  const result = regenerateSteering(root);
  return [result.trusted ? "Steering regenerated from committed configuration. Pending preset/custom edits take effect only after commit, when steering is next generated." : result.text,
    "Installed instruction delivery integration is deferred to the new harness installer; legacy managed files were not rewritten.", ...result.warnings.filter((w) => w !== result.text)];
}
