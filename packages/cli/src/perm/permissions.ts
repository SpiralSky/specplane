import { parseYaml } from "../yaml.js";
import { readStoreJson, writeStoreJson } from "../repo/store.js";
import { readCommittedConfig } from "../config-source.js";
import { run } from "../git/exec.js";

/**
 * Minimal permission engine: catalog IDs, the four default presets, mode resolution and the guard
 * (`architecture/file-formats` §7, `architecture/reference-cli` §7). Only what the human spec commands need.
 */

export type Mode = "allow" | "request-user" | "deny";
export type RoleId = "standard-user" | "administrator" | "llm";

export const PROTECTED = ["override.status", "override.approver", "override.approval-commit", "override.test"] as const;
export const GRANULAR_PIECES = ["title", "authors", "references", "covers", "approval"] as const;
export type Piece = (typeof GRANULAR_PIECES)[number];

/** Permission IDs of `architecture/file-formats` §7.1 (plan permissions listed for completeness). */
export const CATALOG: readonly string[] = [
  "spec.create.requirement", "spec.create.feature", "spec.create.architecture",
  "spec.edit.requirement", "spec.edit.feature", "spec.edit.architecture",
  "spec.delete.requirement", "spec.delete.feature", "spec.delete.architecture",
  "spec.approve", "meta.read", "meta.write",
  ...GRANULAR_PIECES.map((p) => `meta.write.${p}`),
  ...PROTECTED, "test.record", "info.retrieve",
  "plan.meta.read", "plan.meta.write", "plan.edit", "plan.create", "plan.delete", "plan.start", "plan.abandon", "plan.complete",
  "plan.budget", "plan.resume", "plan.softstop", "decision.add", "decision.retrieve", "decision.edit", "decision.delete", "config.change",
];

export interface Preset {
  id: string;
  number: number;
  defaultMode: Mode;
  standardUser: { defaultMode: Mode; modes: Record<string, Mode> };
  llm: { defaultMode?: Mode; modes: Record<string, Mode> };
}

function llmModes(req: Mode, feat: Mode, arch: Mode, planEdit: Mode): Record<string, Mode> {
  const m: Record<string, Mode> = {};
  for (const [t, mode] of [["requirement", req], ["feature", feat], ["architecture", arch]] as const) {
    for (const a of ["create", "edit", "delete"]) m[`spec.${a}.${t}`] = mode;
  }
  return {
    ...m,
    "spec.approve": "request-user", "config.change": "request-user", "info.retrieve": "allow", "test.record": "allow",
    "meta.read": "allow", "meta.write": "deny",
    "plan.create": planEdit, "plan.edit": planEdit, "plan.start": "request-user", "plan.resume": "request-user",
    "plan.abandon": "request-user", "plan.complete": "request-user", "plan.delete": "request-user", "plan.budget": "request-user",
    "plan.softstop": "allow", "decision.retrieve": "allow", "decision.add": "request-user", "decision.edit": "request-user",
    "decision.delete": "request-user",
  };
}

const standard = { defaultMode: "allow" as Mode, modes: { "override.status": "deny", "override.approver": "deny", "override.approval-commit": "deny", "override.test": "deny" } as Record<string, Mode> };

export const PRESETS: Preset[] = [
  { id: "architecture-level-llm-control", number: 1, defaultMode: "deny", standardUser: standard, llm: { modes: llmModes("request-user", "request-user", "allow", "allow") } },
  { id: "full-manual-editing", number: 2, defaultMode: "deny", standardUser: standard, llm: { modes: llmModes("deny", "deny", "deny", "request-user") } },
  { id: "feature-level-llm-control", number: 3, defaultMode: "deny", standardUser: standard, llm: { modes: llmModes("request-user", "allow", "allow", "allow") } },
  { id: "full-llm-control", number: 4, defaultMode: "deny", standardUser: standard, llm: { modes: llmModes("allow", "allow", "allow", "allow") } },
];
export const DEFAULT_PRESET = PRESETS[0];

/** Role entry, else role default, else preset default, else deny (`file-formats` §7.2). The Administrator has everything. */
export function mode(preset: Preset, role: RoleId, permission: string): Mode {
  if (role === "administrator") return "allow";
  const r = role === "llm" ? preset.llm : preset.standardUser;
  return r.modes[permission] ?? r.defaultMode ?? preset.defaultMode ?? "deny";
}

/** The preset named by `permissions.preset`; an unknown or missing ID gives the default preset. */
export function activePreset(root: string): Preset {
  try {
    const text = readCommittedConfig(root);
    if (text === null) return DEFAULT_PRESET;
    const doc = parseYaml(text) as { permissions?: { preset?: unknown } } | null;
    const id = doc?.permissions?.preset;
    return PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
  } catch { return DEFAULT_PRESET; }
}

/** The role CLI calls run as: `standard-user`, or `administrator` after `role switch` (`reference-cli` §7.1). */
export function cliRole(root: string): RoleId {
  return readStoreJson<{ role?: string }>(root, "role.json")?.role === "administrator" ? "administrator" : "standard-user";
}

/**
 * Switch the role CLI calls run as (`roles-and-permissions` R44). Only a person can switch: an LLM actor is refused,
 * whatever its mode table says. Switching back to the Standard User needs no permission.
 */
export function switchRole(root: string, role: "standard-user" | "administrator", actor?: Actor): void {
  if (actor && actor.kind === "llm") throw new Error("Refused: an LLM cannot switch roles (`roles-and-permissions` R44).");
  writeStoreJson(root, "role.json", { role });
}

/** Git `user.name`; never invented. */
export function gitUserName(root: string): string | null {
  try { return run("git", ["config", "user.name"], { cwd: root }).trim() || null; } catch { return null; }
}

export interface Actor { role: RoleId; kind: "human" | "llm"; name: string; model?: string; session?: string; delegatedBy?: string }

/** The actor for a person's CLI call: the CLI role, the git user, and the harness session when `SPECPLANE_SESSION` names one (`reference-cli` §7.1). */
export function cliActor(root: string): Actor {
  const session = process.env.SPECPLANE_SESSION?.trim();
  return { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown", ...(session ? { session } : {}) };
}

declare const authorizedBrand: unique symbol;
/** Opaque proof that the guard allowed these permissions for this actor. Only `guard` creates one. */
export class Authorized {
  declare private readonly [authorizedBrand]: true;
  private constructor(readonly permissions: readonly string[], readonly actor: Actor) {}
  static create(permissions: readonly string[], actor: Actor): Authorized { return new Authorized(permissions, actor); }
  covers(p: string): boolean { return this.permissions.includes(p); }
}

export type GuardResult =
  | { kind: "allow"; token: Authorized; permissions: string[] }
  | { kind: "request"; permission: string; permissions: string[]; message: string }
  | { kind: "deny"; permission: string; message: string };

const RANK: Record<Mode, number> = { allow: 2, "request-user": 1, deny: 0 };

/**
 * Decide a command that needs all of `needs`. Each entry is one permission, or a list of alternatives (granular first,
 * then general) where the more permissive mode wins (`cli R17.1`).
 */
export function guard(preset: Preset, actor: Actor, needs: (string | string[])[], describe: string): GuardResult {
  let request: string | null = null;
  const used: string[] = [];
  for (const need of needs) {
    const alts = Array.isArray(need) ? need : [need];
    let best = { p: alts[0], m: mode(preset, actor.role, alts[0]) };
    for (const p of alts.slice(1)) {
      const m = mode(preset, actor.role, p);
      if (RANK[m] > RANK[best.m]) best = { p, m };
    }
    if (best.m === "deny") {
      return { kind: "deny", permission: alts[0], message: `Refused: ${describe} needs the \`${alts[0]}\` permission, which the ${actor.role} role does not have.` };
    }
    if (best.m === "request-user" && !request) request = best.p;
    used.push(best.p);
  }
  if (request) return { kind: "request", permission: request, permissions: used, message: `${describe} needs the \`${request}\` permission, which is set to request user, so a request was sent and nothing was done yet.` };
  return { kind: "allow", token: Authorized.create(used, actor), permissions: used };
}
