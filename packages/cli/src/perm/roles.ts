import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { run } from "../git/exec.js";
import { dumpYaml, parseYaml } from "../yaml.js";
import { readStoreJson, writeStoreJson } from "../repo/store.js";
import { NotesView, byAtRid, type Subject } from "../spec/notes.js";
import { committedSource } from "../spec/source.js";
import { MODES } from "./presets.js";
import type { CustomRoleDef, Mode } from "./permissions.js";

/**
 * Custom roles, LLM role rules and the local mappings (`feature/roles-and-permissions` R43, R44, R44.1, R48, R49, R60;
 * `architecture/file-formats` §7.5). Roles and rules are one file each in git, read from HEAD like configuration; a change
 * applies only once approved (a notes record on the file's `role-v1` content). OS user mappings and rule trust are local.
 * This module takes the catalog and the default role IDs as arguments because `permissions.ts` imports it.
 */

export const ROLES_DIR = ".specplane/roles/roles";
export const RULES_DIR = ".specplane/roles/rules";
export const ROLE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Levels a custom role can be given; the Administrator is above all of them (`R42.2`). */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 99;
/** Factors an LLM role rule can match on (`R44.1`). */
export const FACTORS = ["subagent", "agent_type", "provider", "model", "delegated"] as const;
export type Factor = (typeof FACTORS)[number];

export interface RoleFinding { file: string; severity: "error" | "warning"; message: string }
export interface RoleFile extends CustomRoleDef { text: string }
export interface RuleDef { id: string; title: string; role: string; priority: number; match: Partial<Record<Factor, string | boolean>> }
export interface RuleFile extends RuleDef { text: string }

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const roleFile = (id: string): string => `${ROLES_DIR}/${id}.yaml`;
export const ruleFile = (id: string): string => `${RULES_DIR}/${id}.yaml`;

/** Fingerprint of a role or rule file: its parsed content with sorted keys, so spacing and comments do not matter. */
export function roleFingerprint(text: string): string | null {
  let raw: unknown;
  try { raw = parseYaml(text); } catch { return null; }
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : isMap(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  return `role-v1:sha256:${createHash("sha256").update(JSON.stringify(canon(raw))).digest("hex")}`;
}

export function parseRole(text: string, fileId: string, catalog: readonly string[], reservedIds: readonly string[]): { role: RoleFile | null; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) { return { role: null, problems: [`not valid YAML: ${(e as Error).message.split("\n")[0]}`] }; }
  if (!isMap(raw)) return { role: null, problems: ["must be a mapping"] };
  const id = raw.id;
  if (typeof id !== "string" || !ROLE_ID.test(id)) problems.push("`id` must be a kebab-case name");
  else if (id !== fileId) problems.push(`\`id\` ${id} does not match the file name ${fileId}`);
  else if (reservedIds.includes(id)) problems.push(`\`id\` ${id} is the id of a default role`);
  if (raw.title !== undefined && (typeof raw.title !== "string" || raw.title.trim() === "")) problems.push("`title` must be text");
  const level = raw.management_level;
  if (typeof level !== "number" || !Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) problems.push(`\`management_level\` is required and must be a whole number from ${MIN_LEVEL} to ${MAX_LEVEL} (R49)`);
  const dm = raw.default_mode;
  if (typeof dm !== "string" || !MODES.includes(dm as Mode)) problems.push("`default_mode` is required and must be allow, request-user or deny");
  const modes: Record<string, Mode> = {};
  if (raw.modes !== undefined && raw.modes !== null) {
    if (!isMap(raw.modes)) problems.push("`modes` must be a mapping of permission to mode");
    else for (const [k, m] of Object.entries(raw.modes)) {
      if (!catalog.includes(k)) problems.push(`permission \`${k}\` does not exist`);
      else if (typeof m !== "string" || !MODES.includes(m as Mode)) problems.push(`mode of \`${k}\` must be allow, request-user or deny`);
      else modes[k] = m as Mode;
    }
  }
  if (problems.length) return { role: null, problems };
  return { problems, role: { id: id as string, title: typeof raw.title === "string" ? raw.title : (id as string), level: level as number, defaultMode: dm as Mode, modes, text } };
}

export function serializeRole(r: CustomRoleDef): string {
  return dumpYaml({ id: r.id, title: r.title, management_level: r.level, default_mode: r.defaultMode, modes: Object.fromEntries(Object.entries(r.modes).sort(([a], [b]) => a.localeCompare(b))) });
}

export function parseRule(text: string, fileId: string): { rule: RuleFile | null; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) { return { rule: null, problems: [`not valid YAML: ${(e as Error).message.split("\n")[0]}`] }; }
  if (!isMap(raw)) return { rule: null, problems: ["must be a mapping"] };
  const id = raw.id;
  if (typeof id !== "string" || !ROLE_ID.test(id)) problems.push("`id` must be a kebab-case name");
  else if (id !== fileId) problems.push(`\`id\` ${id} does not match the file name ${fileId}`);
  if (typeof raw.role !== "string" || !ROLE_ID.test(raw.role)) problems.push("`role` is required and names the role the rule gives");
  else if (raw.role === "administrator") problems.push("a rule cannot give the Administrator role to an LLM (R60)");
  if (raw.title !== undefined && (typeof raw.title !== "string" || raw.title.trim() === "")) problems.push("`title` must be text");
  const priority = raw.priority === undefined ? 0 : raw.priority;
  if (typeof priority !== "number" || !Number.isInteger(priority)) problems.push("`priority` must be a whole number");
  const match: RuleDef["match"] = {};
  if (!isMap(raw.match) || Object.keys(raw.match).length === 0) problems.push("`match` is required and states at least one factor (subagent, agent_type, provider, model, delegated)");
  else for (const [k, v] of Object.entries(raw.match)) {
    if (!(FACTORS as readonly string[]).includes(k)) problems.push(`factor \`${k}\` is not one of ${FACTORS.join(", ")}`);
    else if (k === "delegated") { if (typeof v !== "boolean") problems.push("factor `delegated` must be true or false"); else match.delegated = v; }
    else if (typeof v !== "string" || v.trim() === "") problems.push(`factor \`${k}\` must be text`);
    else match[k as Factor] = v;
  }
  if (problems.length) return { rule: null, problems };
  return { problems, rule: { id: id as string, title: typeof raw.title === "string" ? raw.title : (id as string), role: raw.role as string, priority: priority as number, match, text } };
}

export function serializeRule(r: RuleDef): string {
  return dumpYaml({ id: r.id, title: r.title, role: r.role, priority: r.priority, match: r.match });
}

/** Files of a folder at HEAD or in the working tree. */
function listFiles(root: string, dir: string, source: "head" | "work"): Array<{ name: string; read: () => string }> {
  try {
    if (source === "head") {
      const out = run("git", ["ls-tree", "--name-only", "HEAD", `${dir}/`], { cwd: root });
      return out.split("\n").filter((f) => f.endsWith(".yaml")).map((f) => ({ name: path.posix.basename(f), read: () => run("git", ["show", `HEAD:${f}`], { cwd: root }) }));
    }
    const abs = path.join(root, dir);
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith(".yaml")).map((f) => ({ name: f, read: () => fs.readFileSync(path.join(abs, f), "utf8") })) : [];
  } catch { return []; }
}

export function readRoleFiles(root: string, source: "head" | "work", catalog: readonly string[], reserved: readonly string[]): { roles: RoleFile[]; findings: RoleFinding[] } {
  const roles: RoleFile[] = [], findings: RoleFinding[] = [];
  for (const f of listFiles(root, ROLES_DIR, source).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${ROLES_DIR}/${f.name}`;
    try {
      const r = parseRole(f.read(), f.name.replace(/\.yaml$/, ""), catalog, reserved);
      if (r.role) roles.push(r.role);
      else for (const p of r.problems) findings.push({ file, severity: "error", message: `role file ${file} is malformed: ${p}; ignored` });
    } catch (e) { findings.push({ file, severity: "error", message: `role file ${file} cannot be read: ${(e as Error).message}; ignored` }); }
  }
  return { roles, findings };
}

export function readRuleFiles(root: string, source: "head" | "work"): { rules: RuleFile[]; findings: RoleFinding[] } {
  const rules: RuleFile[] = [], findings: RoleFinding[] = [];
  for (const f of listFiles(root, RULES_DIR, source).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${RULES_DIR}/${f.name}`;
    try {
      const r = parseRule(f.read(), f.name.replace(/\.yaml$/, ""));
      if (r.rule) rules.push(r.rule);
      else for (const p of r.problems) findings.push({ file, severity: "error", message: `LLM role rule file ${file} is malformed: ${p}; ignored` });
    } catch (e) { findings.push({ file, severity: "error", message: `LLM role rule file ${file} cannot be read: ${(e as Error).message}; ignored` }); }
  }
  return { rules, findings };
}

function subject(root: string, kind: "role" | "role-rule", id: string, file: string, text: string): Subject {
  return {
    id: `${kind}/${id}`, paths: [file], fingerprint: roleFingerprint(text),
    fingerprintAt(rev) { const t = committedSource(root, rev).read(file); return t === null ? null : roleFingerprint(t); },
  };
}

/** A deletion uses a distinct role-v1 fingerprint of canonical JSON null. */
export const DELETED_FINGERPRINT = roleFingerprint("null")!;
export type ApprovalState = "approved" | "pending-change" | "pending-deletion" | "pending";
export interface AppliedRole { def: CustomRoleDef; state: ApprovalState }
export interface AppliedRule { rule: RuleFile; state: ApprovalState }
export interface RoleSet { roles: Map<string, AppliedRole>; rules: AppliedRule[]; findings: RoleFinding[]; notes: NotesView }

/** Include approved subjects whose files have disappeared, and recover legacy approvals from their commit. */
function definitions<T extends { id: string; text: string }>(
  root: string, notes: NotesView, kind: "role" | "role-rule", files: T[],
  fileFor: (id: string) => string, parse: (text: string, id: string) => T | null, findings: RoleFinding[],
): Array<{ def: T; state: ApprovalState }> {
  const current = new Map(files.map((f) => [f.id, f]));
  const ids = new Set([...current.keys(), ...[...notes.notes.bySpec.keys()].filter((s) => s.startsWith(`${kind}/`)).map((s) => s.slice(kind.length + 1))]);
  const result: Array<{ def: T; state: ApprovalState }> = [];
  const head = committedSource(root, "HEAD");
  const reachable = (commit: string): boolean => {
    try { run("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root }); return true; } catch { return false; }
  };
  for (const id of [...ids].sort()) {
    if (!ROLE_ID.test(id)) continue;
    const file = fileFor(id), next = current.get(id);
    const missing = head.read(file) === null;
    // Notes are shared across branches. Absence is a deletion only where the file has history.
    if (missing && !run("git", ["log", "-1", "--format=%H", "HEAD", "--", file], { cwd: root }).trim()) continue;
    const latest = notes.records(`${kind}/${id}`).filter((s) => s.rec.kind === "approval" && (s.rec.deleted !== true || reachable(s.commit))).sort(byAtRid).at(-1);
    let old: T | null = null;
    if (latest && latest.rec.deleted !== true) {
      const text = typeof latest.rec.content === "string" ? latest.rec.content : committedSource(root, latest.commit).read(file);
      if (text !== null && roleFingerprint(text) === latest.rec.fingerprint) old = parse(text, id);
    }
    const approved = next && latest && latest.rec.deleted !== true && notes.lookup(subject(root, kind, id, file, next.text)).applicable.some((s) => s.rec.rid === latest.rec.rid);
    if (approved) { result.push({ def: next, state: "approved" }); continue; }
    if (!next && !old) continue;
    const state: ApprovalState = old ? (missing ? "pending-deletion" : "pending-change") : "pending";
    result.push({ def: old ?? next!, state });
    const label = kind === "role" ? "role" : "LLM role rule";
    const command = kind === "role" ? "role" : "role rule";
    findings.push({ file, severity: "warning", message: old
      ? `a ${missing ? "deletion of" : "change to"} ${label} \`${id}\` is pending approval; the last approved version still applies (\`specplane ${command} approve ${id}\`)`
      : `${label} \`${id}\` is pending approval and does not apply yet (\`specplane ${command} approve ${id}\`)` });
  }
  return result;
}

/** Last approved role and rule definitions remain in force until an edit or deletion is approved (R48). */
export function loadRoleSet(root: string, catalog: readonly string[], reserved: readonly string[]): RoleSet {
  const files = readRoleFiles(root, "head", catalog, reserved);
  const rules = readRuleFiles(root, "head");
  const notes = new NotesView(root);
  const findings: RoleFinding[] = [...files.findings, ...rules.findings];
  const roles = new Map<string, AppliedRole>();
  for (const r of definitions(root, notes, "role", files.roles, roleFile, (text, id) => parseRole(text, id, catalog, reserved).role, findings)) {
    if (r.state !== "pending") roles.set(r.def.id, r);
  }
  const resolvedRules = definitions(root, notes, "role-rule", rules.rules, ruleFile, (text, id) => parseRule(text, id).rule, findings);
  return { roles, rules: resolvedRules.map(({ def, state }) => ({ rule: def, state })), findings, notes };
}

/** Trust is recorded locally per rule and covers the rule's content and the level of the role it gives (`R48`). */
export function trustFingerprint(rule: RuleFile, level: number): string { return `${roleFingerprint(rule.text)}@${level}`; }
export function isTrusted(root: string, rule: RuleFile, level: number): boolean {
  return readStoreJson<Record<string, string>>(root, "trusted-rules.json")?.[rule.id] === trustFingerprint(rule, level);
}
export function trustRule(root: string, rule: RuleFile, level: number): void {
  writeStoreJson(root, "trusted-rules.json", { ...(readStoreJson<Record<string, string>>(root, "trusted-rules.json") ?? {}), [rule.id]: trustFingerprint(rule, level) });
}

export { subject as roleSubject };

// ---- Local mappings of identities to roles (`R44`, `R48`) -------------------------------------------------------------

/** One identity. Only the `os` source exists; the key form `<source>:<name>` keeps room for others, such as a git server. */
export interface Mapping { role: string; admin_switch?: boolean }
export type Mappings = Record<string, Mapping>;
const MAP_FILE = "os-users.json";
export const readMappings = (root: string): Mappings => {
  const m = readStoreJson<Mappings>(root, MAP_FILE);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
};
export const writeMappings = (root: string, m: Mappings): void => writeStoreJson(root, MAP_FILE, m);
export const identityOf = (osUser: string): string => `os:${osUser}`;
