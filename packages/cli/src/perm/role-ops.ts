import * as fs from "node:fs";
import * as path from "node:path";
import { audit } from "../audit/log.js";
import { gitUserName } from "./permissions.js";
import { appendRecords, makeRecord, notesTip } from "../spec/notes.js";
import { committedSource, headCommit } from "../spec/source.js";
import { BUILTIN_ROLES, CATALOG, LEVELS, RANK, guard, levelOf, mode, type Actor, type CustomRoleDef, type Mode, type Preset } from "./permissions.js";
import { MODES } from "./presets.js";
import { ruleStatuses } from "./llm-rules.js";
import {
  DELETED_FINGERPRINT, FACTORS, MAX_LEVEL, MIN_LEVEL, ROLE_ID, identityOf, loadRoleSet, parseRole, parseRule, readMappings, readRoleFiles, readRuleFiles, roleFile,
  roleFingerprint, ruleFile, serializeRole, serializeRule, trustRule, writeMappings, type Factor, type RuleDef, type RuleFile,
} from "./roles.js";

/**
 * `role` commands (`feature/roles-and-permissions` R43, R44, R44.1, R48, R49, R60; `architecture/reference-cli` §7.7).
 * Role and rule files are written to the working tree and apply once committed and approved. Mappings are local.
 */

export interface RoleCtx { root: string; actor: Actor; preset: Preset; now?: Date }
export interface RoleResult { ok: boolean; lines: string[]; reasons: string[]; data?: unknown; written: boolean }
const fail = (reasons: string[]): RoleResult => ({ ok: false, lines: [], reasons, written: false });
const done = (lines: string[], data?: unknown, written = true): RoleResult => ({ ok: true, lines, reasons: [], data, written });

export interface RoleEdits { title?: string; level?: number; defaultMode?: string; sets?: string[]; unsets?: string[] }
export interface RuleEdits { title?: string; role?: string; priority?: number; matches?: string[]; unmatches?: string[] }

export function record(ctx: RoleCtx, command: string, args: string[], permission: string, outcome: "done" | "refused", old: unknown, next: unknown, reason?: string): void {
  audit(ctx.root, { command, args, actor: { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name, ...(ctx.actor.session ? { session: ctx.actor.session } : {}) }, permission, outcome, ...(reason ? { reason } : {}), old: old ?? null, new: next ?? null }, ctx.now);
}

/** The refusal when `ctx.actor` may not use `permission` (only `allow` counts: a request would let a lower role change what applies to a higher one). */
export function needs(ctx: RoleCtx, permission: "role.manage" | "role.map", describe: string): string | null {
  const g = guard(ctx.preset, ctx.actor, [permission], describe);
  if (g.kind === "deny") return g.message;
  if (g.kind === "request") return `Refused: ${describe} needs \`${permission}\`, which is request user for this role; it cannot be sent as a request. Ask a role that has it.`;
  return null;
}

/** Management levels (`R49`): the actor must be above each level, and cannot change its own role. */
export function above(ctx: RoleCtx, describe: string, levels: Array<[string, number]>): string | null {
  const own = levelOf(ctx.preset, ctx.actor.role);
  for (const [name, level] of levels) {
    if (own <= level || name === ctx.actor.role) return `Refused: ${describe} concerns ${name}, whose management level (${level}) is not below the ${ctx.actor.role} level (${own})${name === ctx.actor.role ? "; a role cannot change its own permissions (R43)" : ""} (R49).`;
  }
  return null;
}

/** The permissions in which the role is more permissive than the actor: a role cannot hand out what it does not hold. */
export function escalation(ctx: RoleCtx, def: CustomRoleDef): string[] {
  if (ctx.actor.role === "administrator") return [];
  const probe: Preset = { ...ctx.preset, customRoles: { ...ctx.preset.customRoles, [def.id]: def } };
  return CATALOG.filter((p) => RANK[mode(probe, def.id, p)] > RANK[mode(ctx.preset, ctx.actor.role, p)]);
}

/** Management level of a role that applies (a default role or an approved custom one), else `undefined`. */
function levelFor(ctx: RoleCtx, role: string): number | undefined {
  return (BUILTIN_ROLES as readonly string[]).includes(role) ? LEVELS[role] : loadRoleSet(ctx.root, CATALOG, BUILTIN_ROLES).roles.get(role)?.def.level;
}

const isCustomId = (id: string): boolean => ROLE_ID.test(id) && !(BUILTIN_ROLES as readonly string[]).includes(id);

// ---- roles -------------------------------------------------------------------------------------------------------------

export function roleList(root: string): RoleResult {
  const set = loadRoleSet(root, CATALOG, BUILTIN_ROLES);
  const files = readRoleFiles(root, "head", CATALOG, BUILTIN_ROLES).roles;
  const rows = [
    { id: "administrator", kind: "default", level: "above all", state: "approved" },
    { id: "standard-user", kind: "default", level: LEVELS["standard-user"], state: "approved" },
    { id: "llm", kind: "default", level: LEVELS.llm, state: "approved" },
    ...Array.from(new Set([...files.map((f) => f.id), ...set.roles.keys()])).sort().map((id) => { const a = set.roles.get(id); return { id, kind: "custom", level: (a?.def ?? files.find((f) => f.id === id)!).level, state: a?.state ?? "pending" }; }),
  ];
  return { ok: true, written: false, reasons: set.findings.map((f) => `${f.severity}: ${f.message}`), lines: rows.map((r) => `${r.id}  ${r.kind}  level ${r.level}  ${r.state}`), data: rows };
}

export function roleShow(root: string, id: string): RoleResult {
  if ((BUILTIN_ROLES as readonly string[]).includes(id)) return done([`${id} is a default role; its permissions come from the active preset (\`specplane permissions\`). Management level: ${id === "administrator" ? "above every assignable level" : LEVELS[id]}.`], { id, kind: "default" }, false);
  const set = loadRoleSet(root, CATALOG, BUILTIN_ROLES);
  const file = readRoleFiles(root, "head", CATALOG, BUILTIN_ROLES).roles.find((r) => r.id === id);
  if (!file && !set.roles.has(id)) return fail([`role \`${id}\` does not exist at HEAD; \`specplane role list\` shows the roles`]);
  const a = set.roles.get(id);
  const def = a?.def ?? file!;
  const probe: Preset = { id: "x", number: 0, defaultMode: "deny", standardUser: { modes: {} }, llm: { modes: {} }, customRoles: { [id]: def } };
  return done([
    `${id} (custom, ${a ? a.state : "pending: no effective approval, does not apply"}); management level ${def.level}; default mode ${def.defaultMode}`,
    ...CATALOG.map((p) => `${p}  ${mode(probe, id, p)}`),
  ], { id, level: def.level, state: a?.state ?? "pending", default_mode: def.defaultMode, modes: def.modes }, false);
}

export function applyRoleEdits(d: { title: string; level: number; defaultMode: Mode; modes: Record<string, Mode> }, e: RoleEdits): string[] {
  const problems: string[] = [];
  if (e.title !== undefined) { if (e.title.trim() === "") problems.push("`--title` must not be empty"); else d.title = e.title; }
  if (e.level !== undefined) { if (Number.isInteger(e.level) && e.level >= MIN_LEVEL && e.level <= MAX_LEVEL) d.level = e.level; else problems.push(`\`--level\` must be a whole number from ${MIN_LEVEL} to ${MAX_LEVEL}`); }
  if (e.defaultMode !== undefined) { if (MODES.includes(e.defaultMode as Mode)) d.defaultMode = e.defaultMode as Mode; else problems.push(`default mode ${JSON.stringify(e.defaultMode)} is not allow, request-user or deny`); }
  for (const s of e.sets ?? []) {
    const eq = s.lastIndexOf("=");
    const perm = eq < 0 ? "" : s.slice(0, eq), m = eq < 0 ? "" : s.slice(eq + 1);
    if (eq < 0) problems.push(`\`${s}\`: expected <permission>=<mode>`);
    else if (!CATALOG.includes(perm)) problems.push(`\`${s}\`: permission \`${perm}\` does not exist`);
    else if (!MODES.includes(m as Mode)) problems.push(`\`${s}\`: mode must be allow, request-user or deny`);
    else d.modes[perm] = m as Mode;
  }
  for (const p of e.unsets ?? []) { if (!CATALOG.includes(p)) problems.push(`\`${p}\`: permission does not exist`); else delete d.modes[p]; }
  return problems;
}

export function writeFile(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const NOT_COMMITTED = (rel: string): string => `Written to ${rel}, not committed. Once it is committed, ${"a role with enough management permission and level must approve it before it applies"}.`;

export function roleCreate(ctx: RoleCtx, id: string, e: RoleEdits): RoleResult {
  if (!ROLE_ID.test(id)) return fail([`\`${id}\` is not a role name; use lower-case words joined by hyphens`]);
  if (!isCustomId(id)) return fail([`\`${id}\` is a default role; a custom role needs another name`]);
  const refused = needs(ctx, "role.manage", `creating role \`${id}\``);
  if (refused) { record(ctx, "role create", [id], "role.manage", "refused", null, null, refused); return fail([refused]); }
  if (readRoleFiles(ctx.root, "work", CATALOG, BUILTIN_ROLES).roles.some((r) => r.id === id) || fs.existsSync(path.join(ctx.root, roleFile(id)))) return fail([`role \`${id}\` already exists; \`specplane role edit\` changes it`]);
  if (e.level === undefined) return fail([`a role has a management level (R49): pass \`--level ${MIN_LEVEL}-${MAX_LEVEL}\``]);
  if (e.defaultMode === undefined) return fail(["a role states the default mode of every permission it does not list: pass `--default-mode allow|request-user|deny`"]);
  const draft = { title: id, level: 0, defaultMode: "deny" as Mode, modes: {} as Record<string, Mode> };
  const problems = applyRoleEdits(draft, e);
  if (problems.length) return fail(problems);
  const def: CustomRoleDef = { id, ...draft };
  const bad = above(ctx, `creating role \`${id}\``, [[id, def.level]]) ?? ((x) => x.length ? `Refused: role \`${id}\` would hold more than the ${ctx.actor.role} role does for ${x.join(", ")}; a role cannot hand out what it lacks (R43).` : null)(escalation(ctx, def));
  if (bad) { record(ctx, "role create", [id], "role.manage", "refused", null, null, bad); return fail([bad]); }
  writeFile(ctx.root, roleFile(id), serializeRole(def));
  record(ctx, "role create", [id], "role.manage", "done", null, { level: def.level, default_mode: def.defaultMode });
  return done([`Created role \`${id}\` at management level ${def.level}.`, NOT_COMMITTED(roleFile(id)), `Approve it with \`specplane role approve ${id}\` after committing.`], { id, level: def.level });
}

export function roleEdit(ctx: RoleCtx, id: string, e: RoleEdits): RoleResult {
  if ((BUILTIN_ROLES as readonly string[]).includes(id)) return fail([`\`${id}\` is a default role: its permissions come from the active preset (\`specplane preset edit\`)`]);
  const refused = needs(ctx, "role.manage", `editing role \`${id}\``);
  if (refused) { record(ctx, "role edit", [id], "role.manage", "refused", null, null, refused); return fail([refused]); }
  const found = readRoleFiles(ctx.root, "work", CATALOG, BUILTIN_ROLES).roles.find((r) => r.id === id);
  if (!found) return fail([`role \`${id}\` does not exist in the working tree; \`specplane role list\` shows the roles`]);
  const draft = { title: found.title, level: found.level, defaultMode: found.defaultMode, modes: { ...found.modes } };
  const problems = applyRoleEdits(draft, e);
  if (problems.length) return fail(problems);
  const def: CustomRoleDef = { id, ...draft };
  const applied = loadRoleSet(ctx.root, CATALOG, BUILTIN_ROLES).roles.get(id)?.def.level ?? 0;
  const bad = above(ctx, `editing role \`${id}\``, [[id, Math.max(found.level, def.level, applied)]]) ?? ((x) => x.length ? `Refused: role \`${id}\` would hold more than the ${ctx.actor.role} role does for ${x.join(", ")}; a role cannot hand out what it lacks (R43).` : null)(escalation(ctx, def));
  if (bad) { record(ctx, "role edit", [id], "role.manage", "refused", null, null, bad); return fail([bad]); }
  const before = serializeRole(found), after = serializeRole(def);
  if (before === after) return done([`Role \`${id}\` is unchanged.`], { id, changed: false }, false);
  writeFile(ctx.root, roleFile(id), after);
  record(ctx, "role edit", [id, ...(e.sets ?? []), ...(e.unsets ?? [])], "role.manage", "done", { level: found.level, default_mode: found.defaultMode }, { level: def.level, default_mode: def.defaultMode });
  return done([`Edited role \`${id}\`.`, NOT_COMMITTED(roleFile(id)), "Until it is approved again, the last approved version still applies."], { id, changed: true });
}

export function roleDelete(ctx: RoleCtx, id: string): RoleResult {
  if ((BUILTIN_ROLES as readonly string[]).includes(id)) return fail([`\`${id}\` is a default role and cannot be deleted`]);
  const refused = needs(ctx, "role.manage", `deleting role \`${id}\``);
  if (refused) { record(ctx, "role delete", [id], "role.manage", "refused", null, null, refused); return fail([refused]); }
  const found = readRoleFiles(ctx.root, "work", CATALOG, BUILTIN_ROLES).roles.find((r) => r.id === id);
  if (!found) return fail([`role \`${id}\` does not exist in the working tree; \`specplane role list\` shows the roles`]);
  const applied = loadRoleSet(ctx.root, CATALOG, BUILTIN_ROLES).roles.get(id)?.def.level ?? 0;
  const bad = above(ctx, `deleting role \`${id}\``, [[id, Math.max(found.level, applied)]]);
  if (bad) { record(ctx, "role delete", [id], "role.manage", "refused", null, null, bad); return fail([bad]); }
  const users = Object.entries(readMappings(ctx.root)).filter(([, m]) => m.role === id).map(([k]) => k);
  fs.rmSync(path.join(ctx.root, roleFile(id)));
  record(ctx, "role delete", [id], "role.manage", "done", { id }, null);
  return done([`Deleted role \`${id}\`.`, `Removed ${roleFile(id)}, not committed. The deletion stays pending after commit until approved; the last approved version still applies.`, ...(users.length ? [`Mapped here to this role: ${users.join(", ")}; they become the Standard User after the deletion is approved.`] : [])], { id });
}

/** Approve committed absence, retaining the same permission and level gates as an edit. */
function approveDeletion(ctx: RoleCtx, kind: "role" | "role-rule", id: string, levels: Array<[string, number]>): RoleResult {
  const file = kind === "role" ? roleFile(id) : ruleFile(id);
  const command = kind === "role" ? "role approve" : "role rule approve";
  if (fs.existsSync(path.join(ctx.root, file))) return fail([`\`${id}\` has uncommitted changes: commit ${file} first; approval applies to committed content`]);
  const bad = above(ctx, `approving deletion of \`${id}\``, levels);
  if (bad) { record(ctx, command, [id], "role.manage", "refused", null, null, bad); return fail([bad]); }
  const name = gitUserName(ctx.root);
  if (!name) return fail(["Cannot tell who is approving: set git `user.name`. The approver is never invented."]);
  appendRecords(ctx.root, headCommit(ctx.root)!, [makeRecord("approval", `${kind}/${id}`, DELETED_FINGERPRINT, { by: { human: name, role: ctx.actor.role }, date: (ctx.now ?? new Date()).toISOString().slice(0, 10), cited: {}, deleted: true }, ctx.now ?? new Date())]);
  record(ctx, command, [id], "role.manage", "done", null, { deleted: true });
  return done([`Approved deletion of \`${id}\` as ${name}. It no longer applies.`], { id, deleted: true });
}

/** Approve the committed file of a role (`R48`): `role.manage` allow, a level above the role's, and nothing the approver lacks. */
export function roleApprove(ctx: RoleCtx, id: string): RoleResult {
  const refused = needs(ctx, "role.manage", `approving role \`${id}\``);
  if (refused) { record(ctx, "role approve", [id], "role.manage", "refused", null, null, refused); return fail([refused]); }
  const file = readRoleFiles(ctx.root, "head", CATALOG, BUILTIN_ROLES).roles.find((r) => r.id === id);
  const applied = loadRoleSet(ctx.root, CATALOG, BUILTIN_ROLES).roles.get(id);
  if (!file && applied?.state === "pending-deletion") return approveDeletion(ctx, "role", id, [[id, applied.def.level]]);
  if (!file) return fail([`role \`${id}\` is not committed (or is malformed): commit ${roleFile(id)} first; approval applies to committed content`]);
  const abs = path.join(ctx.root, roleFile(id));
  if (!fs.existsSync(abs) || fs.readFileSync(abs, "utf8") !== committedSource(ctx.root, "HEAD").read(roleFile(id))) return fail([`\`${id}\` has uncommitted changes: commit ${roleFile(id)} first; approval applies to committed content`]);
  const set = loadRoleSet(ctx.root, CATALOG, BUILTIN_ROLES);
  if (set.roles.get(id)?.state === "approved") return done([`Role \`${id}\` is already approved. Nothing changed.`], { id }, false);
  const bad = above(ctx, `approving role \`${id}\``, [[id, Math.max(file.level, set.roles.get(id)?.def.level ?? 0)]]) ?? ((x) => x.length ? `Refused: approving \`${id}\` would give it more than the ${ctx.actor.role} role holds for ${x.join(", ")} (R43).` : null)(escalation(ctx, file));
  if (bad) { record(ctx, "role approve", [id], "role.manage", "refused", null, null, bad); return fail([bad]); }
  const name = gitUserName(ctx.root);
  if (!name) return fail(["Cannot tell who is approving: set git `user.name`. The approver is never invented."]);
  const fp = roleFingerprint(file.text)!;
  appendRecords(ctx.root, headCommit(ctx.root)!, [makeRecord("approval", `role/${id}`, fp, { by: { human: name, role: ctx.actor.role }, date: (ctx.now ?? new Date()).toISOString().slice(0, 10), cited: {}, content: file.text }, ctx.now ?? new Date())]);
  record(ctx, "role approve", [id], "role.manage", "done", null, { fingerprint: fp });
  const tip = notesTip(ctx.root);
  return done([`Approved role \`${id}\` as ${name}${tip ? ` (notes commit ${tip.slice(0, 7)})` : ""}. It applies from the next command.`], { id });
}

// ---- LLM role rules ----------------------------------------------------------------------------------------------------

export function ruleList(root: string): RoleResult {
  const rows = ruleStatuses(root).map((s) => ({ id: s.rule.id, role: s.rule.role, priority: s.rule.priority, state: s.state, approved: s.approved, role_applies: s.roleApplies, needs_trust: s.needsTrust, trusted: s.trusted, applies: s.approved && s.roleApplies && (!s.needsTrust || s.trusted) }));
  return { ok: true, written: false, reasons: [], lines: rows.map((r) => `${r.id}  gives ${r.role}  priority ${r.priority}  ${r.state}  ${r.applies ? "applies" : `not applied: ${!r.approved ? "not approved" : !r.role_applies ? "role does not apply" : "not trusted on this machine"}`}`), data: rows };
}

export function ruleShow(root: string, id: string): RoleResult {
  const s = ruleStatuses(root).find((x) => x.rule.id === id);
  if (!s) return fail([`rule \`${id}\` does not exist at HEAD; \`specplane role rule list\` shows the rules`]);
  return done([`${id}: gives ${s.rule.role}, priority ${s.rule.priority}, matches ${JSON.stringify(s.rule.match)}`, `state: ${s.state}; approved definition: ${s.approved}; role applies: ${s.roleApplies}; needs local trust: ${s.needsTrust}; trusted: ${s.trusted}`], s, false);
}

export function applyRuleEdits(d: { title: string; role: string; priority: number; match: RuleDef["match"] }, e: RuleEdits): string[] {
  const problems: string[] = [];
  if (e.title !== undefined) { if (e.title.trim() === "") problems.push("`--title` must not be empty"); else d.title = e.title; }
  if (e.role !== undefined) d.role = e.role;
  if (e.priority !== undefined) { if (Number.isInteger(e.priority)) d.priority = e.priority; else problems.push("`--priority` must be a whole number"); }
  for (const m of e.matches ?? []) {
    const eq = m.indexOf("=");
    const k = eq < 0 ? "" : m.slice(0, eq), v = eq < 0 ? "" : m.slice(eq + 1);
    if (!(FACTORS as readonly string[]).includes(k)) problems.push(`\`${m}\`: expected <factor>=<value> with the factor ${FACTORS.join(", ")}`);
    else if (k === "delegated") { if (v === "true" || v === "false") d.match.delegated = v === "true"; else problems.push(`\`${m}\`: delegated is true or false`); }
    else if (v.trim() === "") problems.push(`\`${m}\`: the value must not be empty`);
    else d.match[k as Factor] = v;
  }
  for (const k of e.unmatches ?? []) { if ((FACTORS as readonly string[]).includes(k)) delete d.match[k as Factor]; else problems.push(`\`${k}\` is not a factor`); }
  return problems;
}

/** The role a rule gives must apply (a default role, or an approved custom one) and be below the actor's level (`R60`). */
function ruleTarget(ctx: RoleCtx, role: string, describe: string): { level: number } | string {
  if (role === "administrator") return "Refused: a rule cannot give the Administrator role to an LLM (R60).";
  const level = levelFor(ctx, role);
  if (level === undefined) return `role \`${role}\` does not apply: it does not exist or its file is not committed and approved (\`specplane role list\`)`;
  return above(ctx, describe, [[role, level]]) ?? { level };
}

export function ruleCreate(ctx: RoleCtx, id: string, e: RuleEdits): RoleResult {
  if (!ROLE_ID.test(id)) return fail([`\`${id}\` is not a rule name; use lower-case words joined by hyphens`]);
  const refused = needs(ctx, "role.map", `creating LLM role rule \`${id}\``);
  if (refused) { record(ctx, "role rule create", [id], "role.map", "refused", null, null, refused); return fail([refused]); }
  if (readRuleFiles(ctx.root, "work").rules.some((r) => r.id === id) || fs.existsSync(path.join(ctx.root, ruleFile(id)))) return fail([`rule \`${id}\` already exists; \`specplane role rule edit\` changes it`]);
  if (!e.role) return fail(["a rule gives a role: pass `--role <role>`"]);
  const draft = { title: id, role: e.role, priority: 0, match: {} as RuleDef["match"] };
  const problems = applyRuleEdits(draft, e);
  if (Object.keys(draft.match).length === 0) problems.push("a rule matches at least one factor: pass `--match <factor>=<value>`");
  if (problems.length) return fail(problems);
  const target = ruleTarget(ctx, draft.role, `giving LLMs the \`${draft.role}\` role`);
  if (typeof target === "string") { record(ctx, "role rule create", [id], "role.map", "refused", null, null, target); return fail([target]); }
  writeFile(ctx.root, ruleFile(id), serializeRule({ id, ...draft }));
  record(ctx, "role rule create", [id], "role.map", "done", null, { role: draft.role, match: draft.match });
  return done([`Created rule \`${id}\`: LLMs matching ${JSON.stringify(draft.match)} get the \`${draft.role}\` role.`, `Written to ${ruleFile(id)}, not committed. Once committed, a role with enough management permission and level must approve it (\`specplane role rule approve ${id}\`)${target.level > LEVELS.llm ? ", and you must trust it on this machine (`specplane role rule trust`)" : ""}.`], { id });
}

/** A pending edit cannot hide the level of the rule still in force. */
function appliedRuleLevels(ctx: RoleCtx, id: string): Array<[string, number]> {
  const s = ruleStatuses(ctx.root).find((s) => s.rule.id === id && s.approved);
  const level = s ? levelFor(ctx, s.rule.role) : undefined;
  return s && level !== undefined ? [[s.rule.role, level]] : [];
}

export function ruleEdit(ctx: RoleCtx, id: string, e: RuleEdits): RoleResult {
  const refused = needs(ctx, "role.map", `editing LLM role rule \`${id}\``);
  if (refused) { record(ctx, "role rule edit", [id], "role.map", "refused", null, null, refused); return fail([refused]); }
  const found = readRuleFiles(ctx.root, "work").rules.find((r) => r.id === id);
  if (!found) return fail([`rule \`${id}\` does not exist in the working tree; \`specplane role rule list\` shows the rules`]);
  const draft = { title: found.title, role: found.role, priority: found.priority, match: { ...found.match } };
  const problems = applyRuleEdits(draft, e);
  if (Object.keys(draft.match).length === 0) problems.push("a rule matches at least one factor");
  if (problems.length) return fail(problems);
  const oldLevel = levelFor(ctx, found.role);
  const target = ruleTarget(ctx, draft.role, `giving LLMs the \`${draft.role}\` role`);
  const bad = above(ctx, `changing the rule \`${id}\` that gives the \`${found.role}\` role`, [...(oldLevel === undefined ? [] : [[found.role, oldLevel] as [string, number]]), ...appliedRuleLevels(ctx, id)]);
  const refusal = bad ?? (typeof target === "string" ? target : null);
  if (refusal) { record(ctx, "role rule edit", [id], "role.map", "refused", null, null, refusal); return fail([refusal]); }
  const next = serializeRule({ id, ...draft });
  if (next === serializeRule(found)) return done([`Rule \`${id}\` is unchanged.`], { id, changed: false }, false);
  writeFile(ctx.root, ruleFile(id), next);
  record(ctx, "role rule edit", [id], "role.map", "done", { role: found.role }, { role: draft.role });
  return done([`Edited rule \`${id}\`.`, `Written to ${ruleFile(id)}, not committed. A changed rule is approved again before it applies.`], { id, changed: true });
}

export function ruleDelete(ctx: RoleCtx, id: string): RoleResult {
  const refused = needs(ctx, "role.map", `deleting LLM role rule \`${id}\``);
  if (refused) { record(ctx, "role rule delete", [id], "role.map", "refused", null, null, refused); return fail([refused]); }
  const found = readRuleFiles(ctx.root, "work").rules.find((r) => r.id === id);
  if (!found) return fail([`rule \`${id}\` does not exist in the working tree; \`specplane role rule list\` shows the rules`]);
  const level = levelFor(ctx, found.role);
  const bad = above(ctx, `deleting the rule \`${id}\``, [...(level === undefined ? [] : [[found.role, level] as [string, number]]), ...appliedRuleLevels(ctx, id)]);
  if (bad) { record(ctx, "role rule delete", [id], "role.map", "refused", null, null, bad); return fail([bad]); }
  fs.rmSync(path.join(ctx.root, ruleFile(id)));
  record(ctx, "role rule delete", [id], "role.map", "done", { role: found.role }, null);
  return done([`Deleted rule \`${id}\`.`, `Removed ${ruleFile(id)}, not committed. The deletion stays pending after commit until approved; the last approved version still applies.`], { id });
}

/** Approve a rule file at HEAD: `role.manage` allow and a level above the role the rule gives (`R48`). */
export function ruleApprove(ctx: RoleCtx, id: string): RoleResult {
  const refused = needs(ctx, "role.manage", `approving LLM role rule \`${id}\``);
  if (refused) { record(ctx, "role rule approve", [id], "role.manage", "refused", null, null, refused); return fail([refused]); }
  const file = readRuleFiles(ctx.root, "head").rules.find((r) => r.id === id);
  const status = ruleStatuses(ctx.root).find((s) => s.rule.id === id);
  if (!file && status?.state === "pending-deletion") return approveDeletion(ctx, "role-rule", id, appliedRuleLevels(ctx, id));
  if (!file) return fail([`rule \`${id}\` is not committed (or is malformed): commit ${ruleFile(id)} first; approval applies to committed content`]);
  const abs = path.join(ctx.root, ruleFile(id));
  if (!fs.existsSync(abs) || fs.readFileSync(abs, "utf8") !== committedSource(ctx.root, "HEAD").read(ruleFile(id))) return fail([`\`${id}\` has uncommitted changes: commit ${ruleFile(id)} first; approval applies to committed content`]);
  if (status?.state === "approved") return done([`Rule \`${id}\` is already approved. Nothing changed.`], { id }, false);
  const bad = above(ctx, `approving the rule \`${id}\``, appliedRuleLevels(ctx, id));
  if (bad) { record(ctx, "role rule approve", [id], "role.manage", "refused", null, null, bad); return fail([bad]); }
  const target = ruleTarget(ctx, file.role, `approving the rule \`${id}\``);
  if (typeof target === "string") { record(ctx, "role rule approve", [id], "role.manage", "refused", null, null, target); return fail([target]); }
  const name = gitUserName(ctx.root);
  if (!name) return fail(["Cannot tell who is approving: set git `user.name`. The approver is never invented."]);
  const fp = roleFingerprint(file.text)!;
  appendRecords(ctx.root, headCommit(ctx.root)!, [makeRecord("approval", `role-rule/${id}`, fp, { by: { human: name, role: ctx.actor.role }, date: (ctx.now ?? new Date()).toISOString().slice(0, 10), cited: {}, content: file.text }, ctx.now ?? new Date())]);
  record(ctx, "role rule approve", [id], "role.manage", "done", null, { fingerprint: fp });
  return done([`Approved rule \`${id}\` as ${name}.${target.level > LEVELS.llm ? ` It gives a role above the default LLM role, so it applies only after \`specplane role rule trust ${id}\` on each machine.` : ""}`], { id });
}

/** Trust a rule locally (`R48`). Only a person can; it is recorded on this machine only and covers the rule and its role's level. */
export function ruleTrust(ctx: RoleCtx, id: string): RoleResult {
  if (ctx.actor.kind === "llm") return fail(["Refused: an LLM cannot trust a rule (R48)."]);
  const s = ruleStatuses(ctx.root).find((x) => x.rule.id === id);
  if (!s) return fail([`rule \`${id}\` does not exist at HEAD`]);
  if (!s.approved) return fail([`rule \`${id}\` is not approved: it must be approved before it can be trusted`]);
  if (!s.roleApplies) return fail([`the role \`${s.rule.role}\` does not apply, so there is nothing to trust yet`]);
  const level = levelFor(ctx, s.rule.role)!;
  trustRule(ctx.root, s.rule as RuleFile, level);
  record(ctx, "role rule trust", [id], "", "done", null, { role: s.rule.role, level });
  return done([`Trusted rule \`${id}\` on this machine (role \`${s.rule.role}\`, level ${level}). The trust ends if the rule or the role's level changes.`], { id }, false);
}

// ---- Local mappings ----------------------------------------------------------------------------------------------------

export function mapList(root: string, me: string): RoleResult {
  const m = readMappings(root);
  const rows = Object.entries(m).map(([identity, v]) => ({ identity, role: v.role, admin_switch: v.admin_switch === true }));
  return { ok: true, written: false, reasons: [], data: { me: identityOf(me), mappings: rows }, lines: rows.length ? rows.map((r) => `${r.identity}  ${r.role}${r.admin_switch ? "  may switch to the Administrator" : ""}`) : ["No mapping is configured: every user is the Standard User and anyone may switch to the Administrator."] };
}

function mapTarget(ctx: RoleCtx, role: string, describe: string): number | string {
  const level = levelFor(ctx, role);
  if (level === undefined) return `role \`${role}\` does not apply: it does not exist or its file is not committed and approved (\`specplane role list\`)`;
  // The Administrator is exempt from the level limit for operating system users (R60); everyone else is bound by it.
  if (ctx.actor.role === "administrator") return level;
  if (role === "administrator") return `Refused: ${describe} would give the Administrator role; only the Administrator may (R60).`;
  return above(ctx, describe, [[role, level]]) ?? level;
}

/** `role map <os-user> <role>`: needs `role.map` allow, and a role below the actor's level unless the actor is the Administrator (`R60`). */
export function mapUser(ctx: RoleCtx, osUser: string, role: string, adminSwitch = false): RoleResult {
  const refused = needs(ctx, "role.map", `mapping \`${osUser}\` to \`${role}\``);
  if (refused) { record(ctx, "role map", [osUser, role], "role.map", "refused", null, null, refused); return fail([refused]); }
  if (!osUser.trim()) return fail(["name an operating system user"]);
  if (adminSwitch && ctx.actor.role !== "administrator") { const r = "Refused: allowing a user to switch to the Administrator is for the Administrator only (R44, R60)."; record(ctx, "role map", [osUser, role], "role.map", "refused", null, null, r); return fail([r]); }
  const target = mapTarget(ctx, role, `mapping \`${osUser}\` to \`${role}\``);
  if (typeof target === "string") { record(ctx, "role map", [osUser, role], "role.map", "refused", null, null, target); return fail([target]); }
  const all = readMappings(ctx.root), key = identityOf(osUser), old = all[key];
  if (old) {
    const ol = levelFor(ctx, old.role) ?? 0;
    const bad = ctx.actor.role === "administrator" ? null : above(ctx, `changing the mapping of \`${osUser}\``, [[old.role, ol]]) ?? (old.admin_switch ? "Refused: this user may switch to the Administrator; only the Administrator changes that mapping (R60)." : null);
    if (bad) { record(ctx, "role map", [osUser, role], "role.map", "refused", null, null, bad); return fail([bad]); }
  }
  writeMappings(ctx.root, { ...all, [key]: { role, ...(adminSwitch ? { admin_switch: true } : {}) } });
  record(ctx, "role map", [osUser, role], "role.map", "done", old ?? null, { role });
  return done([`Mapped ${key} to \`${role}\`${adminSwitch ? ", allowed to switch to the Administrator" : ""}, on this machine only.`, ...(Object.keys(all).length === 0 ? ["A mapping is now configured: a user with no entry is the Standard User, and only a mapping that allows it lets a user switch to the Administrator."] : [])], { identity: key, role }, false);
}

export function unmapUser(ctx: RoleCtx, osUser: string): RoleResult {
  const refused = needs(ctx, "role.map", `removing the mapping of \`${osUser}\``);
  if (refused) { record(ctx, "role unmap", [osUser], "role.map", "refused", null, null, refused); return fail([refused]); }
  const all = readMappings(ctx.root), key = identityOf(osUser), old = all[key];
  if (!old) return fail([`${key} has no mapping here`]);
  if (ctx.actor.role !== "administrator") {
    const ol = levelFor(ctx, old.role) ?? 0;
    const bad = above(ctx, `removing the mapping of \`${osUser}\``, [[old.role, ol]]) ?? (old.admin_switch ? "Refused: this user may switch to the Administrator; only the Administrator changes that mapping (R60)." : null);
    if (bad) { record(ctx, "role unmap", [osUser], "role.map", "refused", null, null, bad); return fail([bad]); }
  }
  delete all[key];
  writeMappings(ctx.root, all);
  record(ctx, "role unmap", [osUser], "role.map", "done", old, null);
  return done([`Removed the mapping of ${key}.`, ...(Object.keys(all).length === 0 ? ["No mapping is left: every user is the Standard User again and anyone may switch to the Administrator."] : [])], { identity: key }, false);
}

