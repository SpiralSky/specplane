import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "../git/exec.js";
import { dumpYaml, parseYaml } from "../yaml.js";
import type { Mode, Preset } from "./permissions.js";

/**
 * Custom permission presets (`feature/roles-and-permissions` R56, R56.1; `architecture/file-formats` §7.4): one file per
 * preset under `.specplane/roles/presets/`, read from HEAD like configuration. This module takes the catalog as an
 * argument because `permissions.ts` imports it.
 */

export const PRESETS_DIR = ".specplane/roles/presets";
export const PRESET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MODES: readonly Mode[] = ["allow", "request-user", "deny"];
/** Roles a preset states modes for; the Administrator is never in a preset (`R42.1`). */
export const PRESET_ROLES = ["standard-user", "llm"] as const;

export interface PresetFinding { file: string; message: string }
export interface CustomPreset extends Preset { title: string; custom: true }

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readModes(v: unknown, where: string, catalog: readonly string[], problems: string[]): Record<string, Mode> {
  const out: Record<string, Mode> = {};
  if (v === undefined || v === null) return out;
  if (!isMap(v)) { problems.push(`${where}modes must be a mapping of permission to mode`); return out; }
  for (const [k, m] of Object.entries(v)) {
    if (!catalog.includes(k)) problems.push(`${where}permission \`${k}\` does not exist`);
    else if (typeof m !== "string" || !MODES.includes(m as Mode)) problems.push(`${where}mode of \`${k}\` must be allow, request-user or deny`);
    else out[k] = m as Mode;
  }
  return out;
}

/** Validate the text of one preset file against the id its file name gives. */
export function parsePreset(text: string, fileId: string, catalog: readonly string[], builtinIds: readonly string[]): { preset: CustomPreset | null; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) { return { preset: null, problems: [`not valid YAML: ${(e as Error).message.split("\n")[0]}`] }; }
  if (!isMap(raw)) return { preset: null, problems: ["must be a mapping"] };
  const id = raw.id;
  if (typeof id !== "string" || !PRESET_ID.test(id)) problems.push("`id` must be a kebab-case name");
  else if (id !== fileId) problems.push(`\`id\` ${id} does not match the file name ${fileId}`);
  else if (builtinIds.includes(id)) problems.push(`\`id\` ${id} is the id of a default preset`);
  if (raw.title !== undefined && (typeof raw.title !== "string" || raw.title.trim() === "")) problems.push("`title` must be text");
  const dm = raw.default_mode;
  if (typeof dm !== "string" || !MODES.includes(dm as Mode)) problems.push("`default_mode` is required and must be allow, request-user or deny (R56.1)");
  const roles = raw.roles === undefined || raw.roles === null ? {} : raw.roles;
  const modes: Record<string, { defaultMode?: Mode; modes: Record<string, Mode> }> = {};
  if (!isMap(roles)) problems.push("`roles` must be a mapping");
  else {
    for (const [r, body] of Object.entries(roles)) {
      if (!(PRESET_ROLES as readonly string[]).includes(r)) { problems.push(`role \`${r}\` is not a role a preset sets (standard-user, llm)`); continue; }
      if (!isMap(body)) { problems.push(`role \`${r}\` must be a mapping`); continue; }
      const rdm = body.default_mode;
      if (rdm !== undefined && (typeof rdm !== "string" || !MODES.includes(rdm as Mode))) problems.push(`role \`${r}\`: default_mode must be allow, request-user or deny`);
      modes[r] = { ...(typeof rdm === "string" && MODES.includes(rdm as Mode) ? { defaultMode: rdm as Mode } : {}), modes: readModes(body.modes, `role \`${r}\`: `, catalog, problems) };
    }
  }
  if (problems.length) return { preset: null, problems };
  return {
    problems,
    preset: {
      id: id as string, number: 0, custom: true, title: typeof raw.title === "string" ? raw.title : (id as string), defaultMode: dm as Mode,
      standardUser: modes["standard-user"] ?? { modes: {} }, llm: modes.llm ?? { modes: {} },
    },
  };
}

/** The file text of a preset: the shape of `file-formats` §7.2. */
export function serializePreset(p: Preset & { title?: string }): string {
  const role = (r: { defaultMode?: Mode; modes: Record<string, Mode> }) => ({ ...(r.defaultMode ? { default_mode: r.defaultMode } : {}), modes: Object.fromEntries(Object.entries(r.modes).sort(([a], [b]) => a.localeCompare(b))) });
  return dumpYaml({ id: p.id, title: p.title ?? p.id, default_mode: p.defaultMode, roles: { "standard-user": role(p.standardUser), llm: role(p.llm) } });
}

export const presetFile = (id: string): string => `${PRESETS_DIR}/${id}.yaml`;

/** Custom presets from HEAD (`head`, what applies) or the working tree (`work`, what a command is editing). */
export function readCustomPresets(root: string, source: "head" | "work", catalog: readonly string[], builtinIds: readonly string[]): { presets: CustomPreset[]; findings: PresetFinding[] } {
  const presets: CustomPreset[] = [], findings: PresetFinding[] = [];
  let files: Array<{ name: string; read: () => string }> = [];
  try {
    if (source === "head") {
      const out = run("git", ["ls-tree", "--name-only", "HEAD", `${PRESETS_DIR}/`], { cwd: root });
      files = out.split("\n").filter((f) => f.endsWith(".yaml")).map((f) => ({ name: path.posix.basename(f), read: () => run("git", ["show", `HEAD:${f}`], { cwd: root }) }));
    } else {
      const dir = path.join(root, PRESETS_DIR);
      if (fs.existsSync(dir)) files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => ({ name: f, read: () => fs.readFileSync(path.join(dir, f), "utf8") }));
    }
  } catch { return { presets, findings }; }
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${PRESETS_DIR}/${f.name}`;
    try {
      const r = parsePreset(f.read(), f.name.replace(/\.yaml$/, ""), catalog, builtinIds);
      if (r.preset) presets.push(r.preset);
      else for (const p of r.problems) findings.push({ file, message: `preset file ${file} is malformed: ${p}; ignored` });
    } catch (e) { findings.push({ file, message: `preset file ${file} cannot be read: ${(e as Error).message}; ignored` }); }
  }
  return { presets, findings };
}
