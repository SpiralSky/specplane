import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { audit } from "./audit/log.js";
import { CONFIG_PATH, checkValue, describeDefault, formatValue, listSettings, loadSettings, lookup, parseConfig, type Config, type Kind } from "./config.js";
import { editConfig } from "./config-edit.js";
import { guard, type Actor, type Preset } from "./perm/permissions.js";
import { holdRequest, sentMessage } from "./requests/hold.js";

/**
 * `config get|set|unset|list` (`feature/configuration` R25, R25.1; `architecture/reference-cli` §3.2).
 * Reading needs no permission; every write goes through the guard with `config.change` and is audited with old and new.
 */

export interface ConfigCtx { root: string; actor: Actor; preset: Preset; now?: Date; request?: string }

export interface ConfigResult {
  ok: boolean;
  lines: string[];
  reasons: string[];
  data?: unknown;
  /** True when the file was written (never committed: configuration is a working-tree edit). */
  written: boolean;
  /** Id of the request sent instead of changing the setting (`request user`). */
  request?: string;
}

const fail = (reasons: string[]): ConfigResult => ({ ok: false, lines: [], reasons, written: false });

function describeLine(c: Config, key: string): string {
  const hit = lookup(key)!;
  const value = c.values[key] ?? (hit.entry ? undefined : hit.def.def);
  const set = hit.entry ? value !== undefined : c.set.has(key);
  const def = hit.entry ? (hit.kind.t === "bool" && hit.def.key === "bypass_guards" ? "on" : "none") : describeDefault(hit.def);
  return `${key} = ${formatValue(value ?? (hit.entry ? (hit.def.key === "bypass_guards" ? true : null) : null))} (${set ? "set" : "default"}; default ${def})${hit.def.later ? " [later release: no effect yet]" : ""}`;
}

export function configList(root: string): ConfigResult {
  const { config, findings } = loadSettings(root);
  const rows = listSettings(config);
  return {
    ok: true,
    lines: rows.map((r) => describeLine(config, r.key)),
    reasons: findings.map((f) => `${f.severity}: ${f.message}`),
    data: rows.map((r) => ({ key: r.key, value: r.value, source: r.source, default: r.def, laterRelease: r.later })),
    written: false,
  };
}

export function configGet(root: string, key: string | undefined): ConfigResult {
  if (key === undefined) return configList(root);
  const hit = lookup(key);
  if (!hit) return fail([`unknown setting \`${key}\`; \`specplane config list\` shows every setting`]);
  const { config } = loadSettings(root);
  const set = config.set.has(key);
  return { ok: true, lines: [describeLine(config, key), hit.def.doc], reasons: [], data: { key, value: config.values[key] ?? null, source: set ? "set" : "default", default: hit.def.def, laterRelease: !!hit.def.later }, written: false };
}

/** Parse the text of a `config set` argument into a candidate value for `kind`. */
function parseArg(kind: Kind, arg: string): unknown {
  switch (kind.t) {
    case "posint": return /^\d+$/.test(arg.trim()) ? Number(arg.trim()) : arg;
    case "days": return /^\d+$/.test(arg.trim()) ? Number(arg.trim()) : arg.trim();
    case "text": case "path": case "filename": case "enum": case "preset": return arg;
    case "bool": return arg.trim();
    default:
      try { return yaml.load(arg, { schema: yaml.JSON_SCHEMA }); } catch { return arg; }
  }
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function change(ctx: ConfigCtx, key: string, value: unknown | undefined, command: string, args: string[]): ConfigResult {
  const hit = lookup(key);
  if (!hit) return fail([`unknown setting \`${key}\`; \`specplane config list\` shows every setting`]);
  const entry = { command, args, request: ctx.request, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name } };
  const before = loadSettings(ctx.root).config;
  const old = before.values[key] ?? null;
  let candidate: unknown;
  if (value !== undefined) {
    const c = checkValue(hit.kind, value);
    if (!c.ok) return fail([`setting \`${key}\` cannot be set: ${c.problem}`]);
    candidate = c.value;
    if (hit.kind.t === "bool" && typeof value === "string") candidate = value in { on: 1, off: 1 } ? value : candidate;
  }
  const g = guard(ctx.preset, ctx.actor, ["config.change"], `changing \`${key}\``);
  if (g.kind === "request") {
    const rec = holdRequest({ root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission, command, params: { key, old, new: candidate ?? null, op: command === "config set" ? "set" : "unset", arg: args[1] ?? null }, reason: `Changing setting \`${key}\` from ${formatValue(old)} to ${value === undefined ? "its default" : formatValue(candidate)}.`, now: ctx.now });
    return { ok: true, lines: [sentMessage(rec)], reasons: [], written: false, request: rec.id };
  }
  if (g.kind !== "allow") {
    audit(ctx.root, { ...entry, permission: g.permission, outcome: "refused", reason: g.message, old, new: candidate ?? null }, ctx.now);
    return fail([g.message]);
  }
  const file = path.join(ctx.root, CONFIG_PATH);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const next = editConfig(text, key, candidate);
  const check = parseConfig(next);
  const bad = check.findings.find((f) => f.key === key || f.key.startsWith(`${key}.`));
  if (bad && value !== undefined) {
    audit(ctx.root, { ...entry, permission: "config.change", outcome: "failed", reason: bad.message, old, new: candidate ?? null }, ctx.now);
    return fail([bad.message]);
  }
  if (next !== text) writeAtomic(file, next);
  const after = check.config.values[key] ?? null;
  audit(ctx.root, { ...entry, permission: "config.change", outcome: "done", old, new: after }, ctx.now);
  const lines = [value === undefined ? `Removed \`${key}\`; the default (${formatValue(hit.def.def)}) applies.` : `Set \`${key}\` to ${formatValue(candidate)} (was ${formatValue(old)}).`, `Written to ${CONFIG_PATH}, not committed. It applies from the next command.`];
  if (hit.def.later) lines.push("This setting belongs to a later release and has no effect yet.");
  if (key === "permissions.preset") lines.push("The active preset changed; steering is regenerated when steering is available.");
  return { ok: true, lines, reasons: [], data: { key, old, new: after }, written: true };
}

export function configSet(ctx: ConfigCtx, key: string, arg: string): ConfigResult {
  const hit = lookup(key);
  if (!hit) return fail([`unknown setting \`${key}\`; \`specplane config list\` shows every setting`]);
  return change(ctx, key, parseArg(hit.kind, arg), "config set", [key, arg]);
}

export function configUnset(ctx: ConfigCtx, key: string): ConfigResult {
  return change(ctx, key, undefined, "config unset", [key]);
}

