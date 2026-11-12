import { loadSettings } from "../config.js";
import { PERMISSION_DOCS, permissionDoc, type PermDoc } from "./catalog.js";
import { CATALOG, allPresets, findPreset, mode, type Mode, type RoleId } from "./permissions.js";
import { inspectSteering } from "../harness/steering.js";

/** Permission documentation (`feature/configuration` R54, `architecture/reference-cli` §7.4). Reading needs no permission. */

const ROLES: RoleId[] = ["standard-user", "llm", "administrator"];

export interface PermissionRow { id: string; modes: Record<RoleId, Mode>; reader: Mode }

export interface PermissionsListing { preset: string; reader: RoleId; rows: PermissionRow[]; lines: string[] }

export function listPermissions(root: string, reader: RoleId): PermissionsListing {
  const { config } = loadSettings(root);
  const preset = findPreset(root, config.permissionsPreset) ?? allPresets(root)[0];
  const rows = CATALOG.map((id) => ({
    id,
    modes: Object.fromEntries(ROLES.map((r) => [r, mode(preset, r, id)])) as Record<RoleId, Mode>,
    reader: mode(preset, reader, id),
  }));
  const width = Math.max(...rows.map((r) => r.id.length));
  const lines = [
    `Active preset: ${preset.id}. You are: ${reader}.`,
    `${"permission".padEnd(width)}  ${"standard-user".padEnd(13)}  ${"llm".padEnd(12)}  you`,
    ...rows.map((r) => `${r.id.padEnd(width)}  ${r.modes["standard-user"].padEnd(13)}  ${r.modes.llm.padEnd(12)}  ${r.reader}`),
  ];
  return { preset: preset.id, reader, rows, lines };
}

export interface PermissionDetail {
  doc: PermDoc;
  presets: Array<{ preset: string; modes: Record<RoleId, Mode> }>;
  reader: RoleId;
  readerMode: Mode;
  activePreset: string;
  customSteering: Array<{ scope: string; text: string }>;
  lines: string[];
}

export function describePermission(root: string, id: string, reader: RoleId): PermissionDetail | null {
  const doc = permissionDoc(id);
  if (!doc || !CATALOG.includes(id)) return null;
  const { config } = loadSettings(root);
  const active = findPreset(root, config.permissionsPreset) ?? allPresets(root)[0];
  const presets = allPresets(root).map((p) => ({ preset: p.id, modes: Object.fromEntries(ROLES.map((r) => [r, mode(p, r, id)])) as Record<RoleId, Mode> }));
  const custom = ((config.values["steering.custom"] as Array<{ permission?: string; scope?: string; text: string }>) ?? [])
    .filter((c) => c.permission === id).map((c) => ({ scope: c.scope ?? "all", text: c.text }));
  const readerMode = mode(active, reader, id);
  const lines = [
    `${doc.id}`,
    `Allows: ${doc.allows}`,
    `Does not allow: ${doc.doesNotAllow}`,
    `Used by: ${doc.commands.join(", ")}`,
    `Mode per preset (standard-user / llm):`,
    ...presets.map((p) => `  ${p.preset}${p.preset === active.id ? " (active)" : ""}: ${p.modes["standard-user"]} / ${p.modes.llm}`),
    `You are ${reader}: ${readerMode} under the active preset.`,
    `Steering for the LLM role:`,
    inspectSteering(root, id).text,
  ];
  return { doc, presets, reader, readerMode, activePreset: active.id, customSteering: custom, lines };
}

export { PERMISSION_DOCS };
