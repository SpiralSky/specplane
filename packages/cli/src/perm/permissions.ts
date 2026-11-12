import { parseYaml } from "../yaml.js";
import { readStoreJson, writeStoreJson } from "../repo/store.js";
import { readCommittedConfig } from "../config-source.js";
import { run } from "../git/exec.js";
import * as os from "node:os";
import { readCustomPresets, type PresetFinding } from "./presets.js";
import { identityOf, loadRoleSet, readMappings, type RoleFinding } from "./roles.js";

/**
 * Minimal permission engine: catalog IDs, the four default presets, mode resolution and the guard
 * (`architecture/file-formats` §7, `architecture/reference-cli` §7). Only what the human spec commands need.
 */

export type Mode = "allow" | "request-user" | "deny";
/** A default role (`standard-user`, `llm`, `administrator`) or the ID of a custom role (`R48`). */
export type RoleId = string;
export const BUILTIN_ROLES = ["standard-user", "llm", "administrator"] as const;
/** Management permission (`R43`) and system permission (`R60`): never set by a preset, never granted by a default mode. */
export const MANAGEMENT_PERMISSIONS = ["role.manage"] as const;
export const SYSTEM_PERMISSIONS = ["role.map"] as const;
export const ROLE_PERMISSIONS: readonly string[] = [...MANAGEMENT_PERMISSIONS, ...SYSTEM_PERMISSIONS];

export const PROTECTED = ["override.status", "override.approver", "override.approval-commit", "override.test"] as const;
export const GRANULAR_PIECES = ["title", "authors", "references", "covers", "approval"] as const;
export const PLAN_PIECES = ["title", "authors", "references", "implements"] as const;
export type Piece = (typeof GRANULAR_PIECES)[number];

/** Permission IDs of `architecture/file-formats` §7.1 (plan permissions listed for completeness). */
export const CATALOG: readonly string[] = [
  "spec.create.requirement", "spec.create.feature", "spec.create.architecture",
  "spec.edit.requirement", "spec.edit.feature", "spec.edit.architecture",
  "spec.delete.requirement", "spec.delete.feature", "spec.delete.architecture",
  "spec.approve", "meta.read", "meta.write",
  ...GRANULAR_PIECES.map((p) => `meta.write.${p}`),
  ...PROTECTED, "test.record", "info.retrieve",
  "plan.meta.read", "plan.meta.write", ...PLAN_PIECES.map((p) => `plan.meta.write.${p}`), "plan.edit", "plan.create", "plan.delete", "plan.start", "plan.abandon", "plan.complete",
  "plan.budget", "plan.resume", "plan.softstop", "decision.add", "decision.retrieve", "decision.edit", "decision.delete", "config.change",
  ...ROLE_PERMISSIONS,
];
/** The standard permissions: what a preset or a custom role's default mode can set. */
export const STANDARD_CATALOG: readonly string[] = CATALOG.filter((p) => !ROLE_PERMISSIONS.includes(p));
/** Permissions a custom role has only when its file states them: a default mode never grants them. */
const EXPLICIT_ONLY: readonly string[] = [...PROTECTED, ...ROLE_PERMISSIONS];

/** A custom role's resolved permissions (`R48`): read from git and applied only once approved. */
export interface CustomRoleDef { id: string; title: string; level: number; defaultMode: Mode; modes: Record<string, Mode> }

export interface Preset {
  id: string;
  number: number;
  /** Set on a preset a user created (`R56`); the four default presets have none. */
  custom?: true;
  title?: string;
  defaultMode: Mode;
  standardUser: { defaultMode?: Mode; modes: Record<string, Mode> };
  llm: { defaultMode?: Mode; modes: Record<string, Mode> };
  /** Applied custom roles, filled by `activePreset` (`R48`); a preset does not state them. */
  customRoles?: Record<string, CustomRoleDef>;
}

function llmModes(req: Mode, feat: Mode, arch: Mode, planEdit: Mode): Record<string, Mode> {
  const m: Record<string, Mode> = {};
  for (const [t, mode] of [["requirement", req], ["feature", feat], ["architecture", arch]] as const) {
    for (const a of ["create", "edit", "delete"]) m[`spec.${a}.${t}`] = mode;
  }
  return {
    ...m,
    "spec.approve": "request-user", "config.change": "request-user", "info.retrieve": "allow", "test.record": "allow",
    "meta.read": "allow", "meta.write": "deny", "plan.meta.read": "allow", "plan.meta.write": "deny",
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
  if (ROLE_PERMISSIONS.includes(permission) && (role === "standard-user" || role === "llm")) return role === "standard-user" && permission === "role.manage" ? "allow" : "deny";
  if (role !== "standard-user" && role !== "llm") {
    const c = preset.customRoles?.[role];
    if (!c) return "deny";
    return c.modes[permission] ?? (EXPLICIT_ONLY.includes(permission) ? "deny" : c.defaultMode);
  }
  const r = role === "llm" ? preset.llm : preset.standardUser;
  return r.modes[permission] ?? r.defaultMode ?? preset.defaultMode ?? "deny";
}

/** Management levels of the default roles (`R42.2`). The Administrator is above every level a role can be given. */
export const LEVELS: Record<string, number> = { "standard-user": 10, llm: 5, administrator: Number.POSITIVE_INFINITY };
/** Management level of a role (`R49`); an unknown role has none and is below all. */
export function levelOf(preset: Preset, role: RoleId): number {
  return LEVELS[role] ?? preset.customRoles?.[role]?.level ?? 0;
}

/** The four default presets and the custom ones at HEAD (or in the working tree, for a command that edits them). */
export function allPresets(root: string, source: "head" | "work" = "head"): Preset[] {
  return [...PRESETS, ...readCustomPresets(root, source, STANDARD_CATALOG, PRESETS.map((p) => p.id)).presets];
}

/** Findings for malformed custom preset files at HEAD. */
export function customPresetFindings(root: string): PresetFinding[] {
  return readCustomPresets(root, "head", STANDARD_CATALOG, PRESETS.map((p) => p.id)).findings;
}

/** The preset with this ID, default or custom; `undefined` when none. */
export function findPreset(root: string, id: unknown, source: "head" | "work" = "head"): Preset | undefined {
  return PRESETS.find((p) => p.id === id) ?? allPresets(root, source).find((p) => p.id === id);
}

/** The custom roles that apply at HEAD (approved ones, `R48`); none when the repository has none or cannot be read. */
export function appliedRoles(root: string): Record<string, CustomRoleDef> {
  try { return Object.fromEntries([...loadRoleSet(root, CATALOG, BUILTIN_ROLES).roles].map(([id, r]) => [id, r.def])); } catch { return {}; }
}

/** Findings for malformed custom role and rule files, and for changes still pending approval. */
export function customRoleFindings(root: string): RoleFinding[] {
  try { return loadRoleSet(root, CATALOG, BUILTIN_ROLES).findings; } catch { return []; }
}

/** The preset named by `permissions.preset`, with the custom roles that apply; an unknown or missing ID gives the default preset. */
export function activePreset(root: string): Preset {
  let preset = DEFAULT_PRESET;
  try {
    const text = readCommittedConfig(root);
    const doc = text === null ? null : parseYaml(text) as { permissions?: { preset?: unknown } } | null;
    preset = findPreset(root, doc?.permissions?.preset) ?? DEFAULT_PRESET;
  } catch { preset = DEFAULT_PRESET; }
  const customRoles = appliedRoles(root);
  return Object.keys(customRoles).length ? { ...preset, customRoles } : preset;
}

/** The name of the operating system user running this process; the source of the `os:` identity (`R44`). */
export function osUserName(): string {
  try { return os.userInfo().username; } catch { return process.env.USER ?? process.env.USERNAME ?? "unknown"; }
}

/**
 * The role CLI calls run as (`reference-cli` §7.1, `R44`). Without a mapping: `standard-user`, or `administrator` after
 * `role switch`. With a mapping: the user's mapped role (an unmapped user, or a role that does not apply, is the Standard
 * User); the Administrator only through a mapping that allows the switch, or a mapping to the Administrator itself.
 */
export function cliRole(root: string): RoleId {
  const stored = readStoreJson<{ role?: string; user?: string }>(root, "role.json");
  const user = osUserName();
  const switched = stored?.role === "administrator" && (!stored.user || stored.user === user);
  const mappings = readMappings(root);
  if (Object.keys(mappings).length === 0) return switched ? "administrator" : "standard-user";
  const entry = mappings[identityOf(user)];
  if (!entry) return "standard-user";
  if (switched && entry.admin_switch) return "administrator";
  if ((BUILTIN_ROLES as readonly string[]).includes(entry.role)) return entry.role;
  return appliedRoles(root)[entry.role] ? entry.role : "standard-user";
}

/**
 * Switch the role CLI calls run as (`roles-and-permissions` R44). Only a person can switch: an LLM actor is refused,
 * whatever its mode table says. Switching back to the Standard User needs no permission.
 */
export function switchRole(root: string, role: "standard-user" | "administrator", actor?: Actor): void {
  if (actor && actor.kind === "llm") throw new Error("Refused: an LLM cannot switch roles (`roles-and-permissions` R44).");
  if (role === "administrator" && !mayBecomeAdministrator(root)) throw new Error("Refused: a role mapping is configured and it does not let this operating system user switch to the Administrator (`roles-and-permissions` R44, R60).");
  writeStoreJson(root, "role.json", { role, user: osUserName() });
}

/** Without a mapping anyone may switch; with one, only a user whose mapping allows it (`R44`). */
export function mayBecomeAdministrator(root: string): boolean {
  const mappings = readMappings(root);
  return Object.keys(mappings).length === 0 || mappings[identityOf(osUserName())]?.admin_switch === true;
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

export const RANK: Record<Mode, number> = { allow: 2, "request-user": 1, deny: 0 };

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
