import * as fs from "node:fs";
import * as path from "node:path";
import { audit } from "../audit/log.js";
import { readWorkingConfig } from "../config-source.js";
import { loadSettings, parseConfig } from "../config.js";
import { CATALOG, PRESETS, RANK, STANDARD_CATALOG, allPresets, findPreset, guard, levelOf, mode, type Actor, type Mode, type Preset } from "./permissions.js";
import { commitLines } from "../uncommitted.js";
import { MODES, PRESET_ID, PRESET_ROLES, presetFile, readCustomPresets, serializePreset } from "./presets.js";

/**
 * `preset list|show|create|edit|delete` (`feature/roles-and-permissions` R56, R56.1; `architecture/reference-cli` §7.5).
 * Reading needs no permission. A write needs `config.change` as `allow` AND a management level above every other role the
 * preset applies to. It edits the working tree and is never committed; it applies once committed, like configuration.
 */

export interface PresetCtx { root: string; actor: Actor; preset: Preset; now?: Date }
export interface PresetResult { ok: boolean; lines: string[]; reasons: string[]; data?: unknown; written: boolean; permission?: string }

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

/** The one text layout of a preset, shared by `preset show` and the preview (`R56.2`): effective modes per role. */
function layout(p: Preset): { lines: string[]; rows: { permission: string; "standard-user": Mode; llm: Mode }[] } {
  const rows = CATALOG.map((perm) => ({ permission: perm, "standard-user": mode(p, "standard-user", perm), llm: mode(p, "llm", perm) }));
  const width = Math.max(...rows.map((r) => r.permission.length));
  return {
    rows,
    lines: [`${p.id} (${p.custom ? "custom" : "default"}); default mode for unlisted permissions: ${p.defaultMode}`, `${"permission".padEnd(width)}  ${"standard-user".padEnd(13)}  llm`, ...rows.map((r) => `${r.permission.padEnd(width)}  ${r["standard-user"].padEnd(13)}  ${r.llm}`)],
  };
}

export function presetShow(root: string, id: string): PresetResult {
  const p = findPreset(root, id);
  if (!p) return fail([`preset \`${id}\` does not exist; \`specplane preset list\` shows the presets`]);
  const { lines, rows } = layout(p);
  return { ok: true, written: false, reasons: [], lines, data: { id: p.id, kind: p.custom ? "custom" : "default", default_mode: p.defaultMode, permissions: rows } };
}

/**
 * What a preset would grant, before it is written or activated (`R56.2`): the `preset show` layout, the roles it applies to,
 * its default mode, and the effective modes (stated modes and defaults) more permissive than `active` gives that role now.
 */
export function presetPreview(draft: Preset, active: Preset): PresetResult {
  const { lines, rows } = layout(draft);
  const more: { role: string; permission: string; mode: Mode; active: Mode }[] = [];
  for (const r of rows) for (const role of PRESET_ROLES) {
    const now = mode(active, role, r.permission);
    if (RANK[r[role]] > RANK[now]) more.push({ role, permission: r.permission, mode: r[role], active: now });
  }
  const out = [...lines, `applies to: ${PRESET_ROLES.join(", ")}`, more.length ? `more permissive than ${active.id}:` : `more permissive than ${active.id}: none`, ...more.map((m) => `  ${m.role} ${m.permission}: ${m.mode} (now ${m.active})`)];
  return { ok: true, written: false, reasons: [], lines: out, data: { id: draft.id, default_mode: draft.defaultMode, roles: PRESET_ROLES, permissions: rows, more_permissive: more } };
}

/**
 * The refusal for an actor that may not manage presets, else `null`. People need `config.change` and `role.manage` and a
 * level above every other role the preset applies to. The LLM role may only create, under `preset.create` (`R56.2`).
 */
function mayManage(ctx: PresetCtx, describe: string, action: "create" | "edit" | "delete" = "edit"): string | null {
  if (ctx.actor.role === "llm") {
    if (action !== "create") return `Refused: ${describe} is for people; the llm role has no permission to ${action} presets (R56.2).`;
    const g = guard(ctx.preset, ctx.actor, ["preset.create"], describe);
    if (g.kind === "deny") return g.message;
    if (g.kind === "request") return `Refused: ${describe} needs \`preset.create\`, which is request user for this role; creation through a request is not available in the CLI. Set it to allow, or ask a person.`;
    return null;
  }
  const g = guard(ctx.preset, ctx.actor, ["config.change", "role.manage"], describe);
  if (g.kind === "deny") return g.message;
  if (g.kind === "request") return `Refused: ${describe} needs \`config.change\`, which is request user for this role; preset changes cannot be sent as a request. Ask a role that has it.`;
  const own = levelOf(ctx.preset, ctx.actor.role);
  const above = PRESET_ROLES.filter((r) => r !== ctx.actor.role && levelOf(ctx.preset, r) >= own);
  if (above.length) return `Refused: ${describe} applies to ${above.join(", ")}, whose management level is not below the ${ctx.actor.role} level (${own}) (R56, R43).`;
  return null;
}

/** What an LLM-created preset may not state: Standard User modes, or an effective mode above the LLM role's own (`R56.2`, `R49`). */
function llmCreateProblems(ctx: PresetCtx, draft: Preset, e: Edits): string[] {
  const out: string[] = [];
  const su = [...(e.sets ?? []).map((s) => s.slice(0, Math.max(s.lastIndexOf("="), 0) || s.length)), ...(e.unsets ?? [])].filter((s) => s.startsWith("standard-user:"));
  if (su.length) out.push(`Refused: the llm role may state modes only for the llm role; ${su.map((s) => `\`${s}\``).join(", ")} sets one for the Standard User (R56.2, R56).`);
  const ownDefault = ctx.preset.llm.defaultMode ?? ctx.preset.defaultMode ?? "deny";
  if (RANK[draft.defaultMode] > RANK[ownDefault]) out.push(`Refused: default mode ${draft.defaultMode} is more permissive than the llm role's own default (${ownDefault}) in the active preset (R56.2, R49).`);
  if (!su.length) {
    const suDefault = draft.standardUser.defaultMode ?? draft.defaultMode;
    const suAbove = STANDARD_CATALOG.filter((perm) => RANK[mode(draft, "standard-user", perm)] > RANK[mode(ctx.preset, "llm", perm)]);
    if (RANK[suDefault] > RANK[ownDefault]) out.push(`Refused: the preset gives the Standard User default mode ${suDefault}, more than the llm role's own default (${ownDefault}) in the active preset (R56.2, R49).`);
    if (suAbove.length) out.push(`Refused: the preset gives the Standard User more than the llm role has in the active preset (${ctx.preset.id}) for ${suAbove.join(", ")} (R56.2, R49).`);
  }
  const above = CATALOG.filter((perm) => RANK[mode(draft, "llm", perm)] > RANK[mode(ctx.preset, "llm", perm)]);
  if (above.length) out.push(`Refused: the preset gives the llm role more than it has in the active preset (${ctx.preset.id}) for ${above.join(", ")} (R56.2, R49).`);
  return out;
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

function record(ctx: PresetCtx, command: string, args: string[], outcome: "done" | "refused" | "failed", old: unknown, next: unknown, reason?: string, permission = "config.change"): void {
  audit(ctx.root, { command, args, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name, ...(ctx.actor.session ? { session: ctx.actor.session } : {}) }, permission, outcome, ...(reason ? { reason } : {}), old: old ?? null, new: next ?? null }, ctx.now);
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
  const permission = ctx.actor.role === "llm" ? "preset.create" : "config.change";
  const refused = mayManage(ctx, `creating preset \`${id}\``, "create");
  if (refused) { record(ctx, "preset create", args, "refused", null, null, refused, permission); return { ...fail([refused]), permission }; }
  if (PRESETS.some((p) => p.id === id) || findPreset(ctx.root, id, "work")) return fail([`preset \`${id}\` already exists; \`specplane preset edit\` changes a custom preset`]);
  const base = e.from === undefined ? undefined : findPreset(ctx.root, e.from, "work");
  if (e.from !== undefined && !base) return fail([`preset \`${e.from}\` does not exist; \`specplane preset list\` shows the presets`]);
  if (!base && e.defaultMode === undefined) return fail(["a preset states the default mode of every permission it does not list (R56.1): pass `--default-mode allow|request-user|deny`, or copy a preset with `--from <preset>`"]);
  const draft = { standardUser: clone(base ? base.standardUser : { modes: {} }), llm: clone(base ? base.llm : { modes: {} }), defaultMode: (base?.defaultMode ?? "deny") as Mode, title: id as string };
  const problems = applyEdits(draft, e);
  if (problems.length) return fail(problems);
  const preset: Preset = { id, number: 0, custom: true, ...draft };
  if (ctx.actor.role === "llm") {
    const more = llmCreateProblems(ctx, preset, e);
    if (more.length) { record(ctx, "preset create", args, "refused", null, null, more.join(" "), permission); return { ...fail(more), permission }; }
  }
  write(ctx.root, id, serializePreset(preset));
  record(ctx, "preset create", args, "done", null, { default_mode: preset.defaultMode, from: e.from ?? null }, undefined, permission);
  return { permission, ok: true, written: true, reasons: [], lines: [`Created preset \`${id}\` with default mode ${preset.defaultMode}.`, ...WRITTEN(id), `Activate it with \`specplane config set permissions.preset ${id}\`.`], data: { id, default_mode: preset.defaultMode, uncommitted: [presetFile(id)], commit: { scope: "preset", summary: `create ${id}` } } };
}

const PARAM_KEYS = ["id", "title", "default_mode", "llm", "standard_user"];
const ROLE_PARAMS: [string, string][] = [["standard_user", "standard-user"], ["llm", "llm"]];

/**
 * The full preset a `preset create` request or harness action carries (`R56.2`): `id`, `title`, `default_mode`, and per role
 * (`llm`, `standard_user`) an optional `default_mode` and a `modes` map. The `Edits` that make it, or the problems found.
 */
export function presetParamsEdits(params: unknown): { id: string; edits: Edits; problems: string[] } {
  const problems: string[] = [];
  const p = (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!PARAM_KEYS.includes(k)) problems.push(`\`${k}\` is not a field of a preset create; a request only creates a preset, never edits, deletes or activates one`);
  const id = typeof p.id === "string" ? p.id : "";
  if (!PRESET_ID.test(id)) problems.push(`\`${id}\` is not a preset name; use lower-case words joined by hyphens`);
  if (p.title !== undefined && (typeof p.title !== "string" || p.title.trim() === "")) problems.push("`title` must be a non-empty string");
  if (typeof p.default_mode !== "string" || !MODES.includes(p.default_mode as Mode)) problems.push("`default_mode` is required and must be allow, request-user or deny");
  const sets: string[] = [];
  for (const [key, role] of ROLE_PARAMS) {
    const body = p[key];
    if (body === undefined) continue;
    if (!body || typeof body !== "object" || Array.isArray(body)) { problems.push(`\`${key}\` must be an object with \`default_mode\` and \`modes\``); continue; }
    const b = body as Record<string, unknown>;
    for (const k of Object.keys(b)) if (k !== "default_mode" && k !== "modes") problems.push(`\`${key}.${k}\` is not a field; use \`default_mode\` and \`modes\``);
    if (b.default_mode !== undefined) { if (typeof b.default_mode === "string") sets.push(`${role}:*=${b.default_mode}`); else problems.push(`\`${key}.default_mode\` must be a string`); }
    if (b.modes !== undefined) {
      if (!b.modes || typeof b.modes !== "object" || Array.isArray(b.modes)) problems.push(`\`${key}.modes\` must map permissions to modes`);
      else for (const [perm, m] of Object.entries(b.modes)) { if (typeof m === "string") sets.push(`${role}:${perm}=${m}`); else problems.push(`\`${key}.modes.${perm}\` must be a mode string`); }
    }
  }
  return { id, edits: { ...(typeof p.title === "string" ? { title: p.title } : {}), ...(typeof p.default_mode === "string" ? { defaultMode: p.default_mode } : {}), sets }, problems };
}

/** Why a preset create with these parameters can never succeed, before anything is stored (`R56.2`); the preset it would make otherwise. */
export function presetDraft(root: string, params: unknown): { preset: Preset | null; problems: string[] } {
  const { id, edits, problems } = presetParamsEdits(params);
  if (problems.length) return { preset: null, problems };
  if (PRESETS.some((p) => p.id === id) || findPreset(root, id, "work")) return { preset: null, problems: [`preset \`${id}\` already exists; a request only creates a new preset`] };
  const draft = { standardUser: clone({ modes: {} }), llm: clone({ modes: {} }), defaultMode: "deny" as Mode, title: id as string };
  const more = applyEdits(draft, edits);
  return more.length ? { preset: null, problems: more } : { preset: { id, number: 0, custom: true, ...draft }, problems: [] };
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
  return { ok: true, written: true, reasons: [], lines: [`Edited preset \`${id}\`.`, ...WRITTEN(id, "edit")], data: { id, changed: true, uncommitted: [presetFile(id)], commit: { scope: "preset", summary: `edit ${id}` } } };
}

export function presetDelete(ctx: PresetCtx, id: string): PresetResult {
  if (PRESETS.some((p) => p.id === id)) return fail([`preset \`${id}\` is a default preset and cannot be deleted`]);
  const refused = mayManage(ctx, `deleting preset \`${id}\``, "delete");
  if (refused) { record(ctx, "preset delete", [id], "refused", null, null, refused); return fail([refused]); }
  const file = path.join(ctx.root, presetFile(id));
  if (!fs.existsSync(file)) return fail([`preset \`${id}\` does not exist in the working tree; \`specplane preset list\` shows the presets`]);
  const inUse = loadSettings(ctx.root).config.permissionsPreset === id || parseConfig(readWorkingConfig(ctx.root)).config.permissionsPreset === id;
  if (inUse) return fail([`preset \`${id}\` is the active preset (\`permissions.preset\`); change the setting first`]);
  fs.rmSync(file);
  record(ctx, "preset delete", [id], "done", { id }, null);
  return { ok: true, written: true, reasons: [], lines: [`Deleted preset \`${id}\`.`, `Removed ${presetFile(id)}, not committed. The deletion applies after it is committed.`, ...commitLines([presetFile(id)], `preset: delete ${id}`)], data: { id, uncommitted: [presetFile(id)], commit: { scope: "preset", summary: `delete ${id}` } } };
}
