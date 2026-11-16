import * as fs from "node:fs";
import * as path from "node:path";
import { audit } from "../audit/log.js";
import { readWorkingConfig } from "../config-source.js";
import { loadSettings, parseConfig } from "../config.js";
import { CATALOG, PRESETS, STANDARD_CATALOG, allPresets, findPreset, guard, levelOf, mode, type Actor, type Mode, type Preset } from "./permissions.js";
import { commitLines } from "../uncommitted.js";
import { MODES, PRESET_ID, PRESET_ROLES, presetFile, readCustomPresets, serializePreset } from "./presets.js";

/**
 * `preset list|show|create|edit|delete` (`feature/roles-and-permissions` R56, R56.1; `architecture/reference-cli` §7.5).
 * Reading needs no permission. A write needs `config.change` as `allow` AND a management level above every other role the
 * preset applies to. It edits the working tree and is never committed; it applies once committed, like configuration.
 */

export interface PresetCtx { root: string; actor: Actor; preset: Preset; now?: Date }
export interface PresetResult { ok: boolean; lines: string[]; reasons: string[]; data?: unknown; written: boolean }

const fail = (reasons: string[]): PresetResult => ({ ok: false, lines: [], reasons, written: false });

export interface Edits { title?: string; defaultMode?: string; sets?: string[]; unsets?: string[]; from?: string }

function summary(p: Preset, active: boolean): string {
  const c = (r: { modes: Record<string, Mode> }) => Object.keys(r.modes).length;
  return `${p.id}${active ? " (active)" : ""}  ${p.custom ? "custom" : "default"}  default ${p.defaultMode}  standard-user: ${c(p.standardUser)} modes  llm: ${c(p.llm)} modes`;
}

export function presetList(root: string): PresetResult {
  const { config, findings } = loadSettings(root);
  const all = allPresets(root);
  return {
    ok: true, written: false, reasons: findings.filter((f) => f.key.startsWith(".specplane/roles/")).map((f) => `${f.severity}: ${f.message}`),
    lines: all.map((p) => summary(p, p.id === config.permissionsPreset)),
    data: all.map((p) => ({ id: p.id, kind: p.custom ? "custom" : "default", active: p.id === config.permissionsPreset, default_mode: p.defaultMode })),
  };
}

export function presetShow(root: string, id: string): PresetResult {
  const p = findPreset(root, id);
  if (!p) return fail([`preset \`${id}\` does not exist; \`specplane preset list\` shows the presets`]);
  const rows = CATALOG.map((perm) => ({ permission: perm, "standard-user": mode(p, "standard-user", perm), llm: mode(p, "llm", perm) }));
  const width = Math.max(...rows.map((r) => r.permission.length));
  return {
    ok: true, written: false, reasons: [],
    lines: [`${p.id} (${p.custom ? "custom" : "default"}); default mode for unlisted permissions: ${p.defaultMode}`, `${"permission".padEnd(width)}  ${"standard-user".padEnd(13)}  llm`, ...rows.map((r) => `${r.permission.padEnd(width)}  ${r["standard-user"].padEnd(13)}  ${r.llm}`)],
    data: { id: p.id, kind: p.custom ? "custom" : "default", default_mode: p.defaultMode, permissions: rows },
  };
}

/** The refusal for an actor that may not manage presets, else `null`. */
function mayManage(ctx: PresetCtx, describe: string): string | null {
  const g = guard(ctx.preset, ctx.actor, ["config.change", "role.manage"], describe);
  if (g.kind === "deny") return g.message;
  if (g.kind === "request") return `Refused: ${describe} needs \`config.change\`, which is request user for this role; preset changes cannot be sent as a request. Ask a role that has it.`;
  const own = levelOf(ctx.preset, ctx.actor.role);
  const above = PRESET_ROLES.filter((r) => r !== ctx.actor.role && levelOf(ctx.preset, r) >= own);
  if (above.length) return `Refused: ${describe} applies to ${above.join(", ")}, whose management level is not below the ${ctx.actor.role} level (${own}) (R56, R43).`;
  return null;
}

type RoleBody = { defaultMode?: Mode; modes: Record<string, Mode> };
const roleBody = (p: Preset, r: string): RoleBody => (r === "llm" ? p.llm : p.standardUser);
const clone = (b: RoleBody): RoleBody => ({ ...(b.defaultMode ? { defaultMode: b.defaultMode } : {}), modes: { ...b.modes } });

/** Apply `role:permission=mode`, `role:*=mode` and `role:permission` unsets to a copy; the problems found. */
function applyEdits(p: { standardUser: RoleBody; llm: RoleBody; defaultMode: Mode; title?: string }, e: Edits): string[] {
  const problems: string[] = [];
  if (e.title !== undefined) { if (e.title.trim() === "") problems.push("`--title` must not be empty"); else p.title = e.title; }
  if (e.defaultMode !== undefined) { if (MODES.includes(e.defaultMode as Mode)) p.defaultMode = e.defaultMode as Mode; else problems.push(`default mode ${JSON.stringify(e.defaultMode)} is not allow, request-user or deny`); }
  const target = (spec: string): { role: string; perm: string } | null => {
    const m = /^([a-z-]+):(.+)$/.exec(spec);
    if (!m || !(PRESET_ROLES as readonly string[]).includes(m[1])) { problems.push(`\`${spec}\`: expected <role>:<permission>, with the role standard-user or llm`); return null; }
    if (m[2] !== "*" && !STANDARD_CATALOG.includes(m[2])) { problems.push(`\`${spec}\`: permission \`${m[2]}\` does not exist`); return null; }
    return { role: m[1], perm: m[2] };
  };
  for (const s of e.sets ?? []) {
    const eq = s.lastIndexOf("=");
    const t = eq < 0 ? null : target(s.slice(0, eq));
    const m = eq < 0 ? "" : s.slice(eq + 1);
    if (eq < 0) { problems.push(`\`${s}\`: expected <role>:<permission>=<mode>`); continue; }
    if (!t) continue;
    if (!MODES.includes(m as Mode)) { problems.push(`\`${s}\`: mode must be allow, request-user or deny`); continue; }
    const body = roleBody(p as Preset, t.role);
    if (t.perm === "*") body.defaultMode = m as Mode; else body.modes[t.perm] = m as Mode;
  }
  for (const s of e.unsets ?? []) {
    const t = target(s);
    if (!t) continue;
    const body = roleBody(p as Preset, t.role);
    if (t.perm === "*") delete body.defaultMode; else delete body.modes[t.perm];
  }
  return problems;
}

function record(ctx: PresetCtx, command: string, args: string[], outcome: "done" | "refused" | "failed", old: unknown, next: unknown, reason?: string): void {
  audit(ctx.root, { command, args, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name, ...(ctx.actor.session ? { session: ctx.actor.session } : {}) }, permission: "config.change", outcome, ...(reason ? { reason } : {}), old: old ?? null, new: next ?? null }, ctx.now);
}

function write(root: string, id: string, text: string): void {
  const file = path.join(root, presetFile(id));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const WRITTEN = (id: string, verb = "create"): string[] => [`Written to ${presetFile(id)}, not committed. It applies from the next command after it is committed; until then it is ignored.`, ...commitLines([presetFile(id)], `preset: ${verb} ${id}`)];

export function presetCreate(ctx: PresetCtx, id: string, e: Edits): PresetResult {
  const args = [id];
  if (!PRESET_ID.test(id)) return fail([`\`${id}\` is not a preset name; use lower-case words joined by hyphens`]);
  const refused = mayManage(ctx, `creating preset \`${id}\``);
  if (refused) { record(ctx, "preset create", args, "refused", null, null, refused); return fail([refused]); }
  if (PRESETS.some((p) => p.id === id) || findPreset(ctx.root, id, "work")) return fail([`preset \`${id}\` already exists; \`specplane preset edit\` changes a custom preset`]);
  const base = e.from === undefined ? undefined : findPreset(ctx.root, e.from, "work");
  if (e.from !== undefined && !base) return fail([`preset \`${e.from}\` does not exist; \`specplane preset list\` shows the presets`]);
  if (!base && e.defaultMode === undefined) return fail(["a preset states the default mode of every permission it does not list (R56.1): pass `--default-mode allow|request-user|deny`, or copy a preset with `--from <preset>`"]);
  const draft = { standardUser: clone(base ? base.standardUser : { modes: {} }), llm: clone(base ? base.llm : { modes: {} }), defaultMode: (base?.defaultMode ?? "deny") as Mode, title: id as string };
  const problems = applyEdits(draft, e);
  if (problems.length) return fail(problems);
  const preset: Preset = { id, number: 0, custom: true, ...draft };
  write(ctx.root, id, serializePreset(preset));
  record(ctx, "preset create", args, "done", null, { default_mode: preset.defaultMode, from: e.from ?? null });
  return { ok: true, written: true, reasons: [], lines: [`Created preset \`${id}\` with default mode ${preset.defaultMode}.`, ...WRITTEN(id), `Activate it with \`specplane config set permissions.preset ${id}\`.`], data: { id, default_mode: preset.defaultMode, uncommitted: [presetFile(id)] } };
}

export function presetEdit(ctx: PresetCtx, id: string, e: Edits): PresetResult {
  const args = [id];
  if (PRESETS.some((p) => p.id === id)) return fail([`preset \`${id}\` is a default preset and cannot be edited; \`specplane preset create <id> --from ${id}\` makes an editable copy`]);
  const refused = mayManage(ctx, `editing preset \`${id}\``);
  if (refused) { record(ctx, "preset edit", args, "refused", null, null, refused); return fail([refused]); }
  const found = readCustomPresets(ctx.root, "work", STANDARD_CATALOG, PRESETS.map((p) => p.id)).presets.find((p) => p.id === id);
  if (!found) return fail([`preset \`${id}\` does not exist; \`specplane preset list\` shows the presets`]);
  const draft = { standardUser: clone(found.standardUser), llm: clone(found.llm), defaultMode: found.defaultMode, title: found.title };
  const problems = applyEdits(draft, e);
  if (problems.length) return fail(problems);
  const next: Preset = { id, number: 0, custom: true, ...draft };
  const before = serializePreset(found), after = serializePreset(next);
  if (before === after) return { ok: true, written: false, reasons: [], lines: [`Preset \`${id}\` is unchanged.`], data: { id, changed: false } };
  write(ctx.root, id, after);
  record(ctx, "preset edit", [id, ...(e.sets ?? []), ...(e.unsets ?? [])], "done", { default_mode: found.defaultMode }, { default_mode: next.defaultMode });
  return { ok: true, written: true, reasons: [], lines: [`Edited preset \`${id}\`.`, ...WRITTEN(id, "edit")], data: { id, changed: true, uncommitted: [presetFile(id)] } };
}

export function presetDelete(ctx: PresetCtx, id: string): PresetResult {
  if (PRESETS.some((p) => p.id === id)) return fail([`preset \`${id}\` is a default preset and cannot be deleted`]);
  const refused = mayManage(ctx, `deleting preset \`${id}\``);
  if (refused) { record(ctx, "preset delete", [id], "refused", null, null, refused); return fail([refused]); }
  const file = path.join(ctx.root, presetFile(id));
  if (!fs.existsSync(file)) return fail([`preset \`${id}\` does not exist in the working tree; \`specplane preset list\` shows the presets`]);
  const inUse = loadSettings(ctx.root).config.permissionsPreset === id || parseConfig(readWorkingConfig(ctx.root)).config.permissionsPreset === id;
  if (inUse) return fail([`preset \`${id}\` is the active preset (\`permissions.preset\`); change the setting first`]);
  fs.rmSync(file);
  record(ctx, "preset delete", [id], "done", { id }, null);
  return { ok: true, written: true, reasons: [], lines: [`Deleted preset \`${id}\`.`, `Removed ${presetFile(id)}, not committed. The deletion applies after it is committed.`], data: { id } };
}
