import * as fs from "node:fs";
import * as path from "node:path";
import { BUILTIN_ROLES, CATALOG, RANK, levelOf, mode, type Actor, type CustomRoleDef, type Mode, type Preset } from "./permissions.js";
import { aboveLlm } from "./llm-rules.js";
import { ROLE_ID, readRoleFiles, readRuleFiles, roleFile, ruleFile, serializeRole, serializeRule, type RuleDef } from "./roles.js";
import { above, applyRoleEdits, applyRuleEdits, needs, record, writeFile, type RoleCtx, type RoleResult } from "./role-ops.js";

/**
 * LLM role proposals (`feature/roles-and-permissions` R44.2; `architecture/reference-cli` §7.7 'Role proposals'). The LLM
 * sends a role and the rule that would assign it as a request; a person who may manage roles writes both by accepting it.
 * Nothing is created directly.
 */

export interface Proposal { role: CustomRoleDef; rule: RuleDef; marked: string[] }

const TOP_KEYS = ["role", "rule", "marked"];
const ROLE_KEYS = ["id", "title", "level", "default_mode", "modes"];
const RULE_KEYS = ["id", "title", "priority", "match"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The full role and rule a proposal carries, or the problems found. `marked` lists the grants (permissions, or `level`) the proposer names as above its own. */
export function parseProposal(params: unknown): { proposal: Proposal | null; problems: string[] } {
  const problems: string[] = [];
  const p = isObject(params) ? params : {};
  for (const k of Object.keys(p)) if (!TOP_KEYS.includes(k)) problems.push(`\`${k}\` is not a field of a role proposal; use \`role\`, \`rule\` and \`marked\``);
  const r = p.role, u = p.rule;
  if (!isObject(r)) problems.push("`role` must be an object with `id`, `title`, `level`, `default_mode` and `modes`");
  if (!isObject(u)) problems.push("`rule` must be an object with `id`, `title`, `priority` and `match`");
  if (!isObject(r) || !isObject(u)) return { proposal: null, problems };
  for (const k of Object.keys(r)) if (!ROLE_KEYS.includes(k)) problems.push(`\`role.${k}\` is not a field; use ${ROLE_KEYS.map((x) => `\`${x}\``).join(", ")}`);
  for (const k of Object.keys(u)) if (!RULE_KEYS.includes(k)) problems.push(`\`rule.${k}\` is not a field; the rule gives the proposed role, so it has no \`role\`; use ${RULE_KEYS.map((x) => `\`${x}\``).join(", ")}`);
  const id = typeof r.id === "string" ? r.id : "";
  if (!ROLE_ID.test(id)) problems.push(`\`${id}\` is not a role name; use lower-case words joined by hyphens`);
  else if ((BUILTIN_ROLES as readonly string[]).includes(id)) problems.push(`\`${id}\` is a default role; a custom role needs another name`);
  if (typeof r.default_mode !== "string") problems.push("`role.default_mode` is required and must be allow, request-user or deny");
  if (typeof r.level !== "number") problems.push("`role.level` is required: a whole number of management levels");
  if (r.title !== undefined && (typeof r.title !== "string" || r.title.trim() === "")) problems.push("`role.title` must be a non-empty string");
  const sets: string[] = [];
  if (r.modes !== undefined) {
    if (!isObject(r.modes)) problems.push("`role.modes` must map permissions to modes");
    else for (const [perm, m] of Object.entries(r.modes)) { if (typeof m === "string") sets.push(`${perm}=${m}`); else problems.push(`\`role.modes.${perm}\` must be a mode string`); }
  }
  const draft = { title: typeof r.title === "string" ? r.title : id, level: 0, defaultMode: "deny" as Mode, modes: {} as Record<string, Mode> };
  problems.push(...applyRoleEdits(draft, { ...(typeof r.level === "number" ? { level: r.level } : {}), ...(typeof r.default_mode === "string" ? { defaultMode: r.default_mode } : {}), sets }));
  const ruleId = typeof u.id === "string" ? u.id : "";
  if (!ROLE_ID.test(ruleId)) problems.push(`\`${ruleId}\` is not a rule name; use lower-case words joined by hyphens`);
  if (u.title !== undefined && (typeof u.title !== "string" || u.title.trim() === "")) problems.push("`rule.title` must be a non-empty string");
  if (u.priority !== undefined && typeof u.priority !== "number") problems.push("`rule.priority` must be a whole number");
  const matches: string[] = [];
  if (!isObject(u.match) || Object.keys(u.match).length === 0) problems.push("a rule matches at least one factor: `rule.match` maps factors to values");
  else for (const [k, v] of Object.entries(u.match)) { if (typeof v === "string" || typeof v === "boolean") matches.push(`${k}=${v}`); else problems.push(`\`rule.match.${k}\` must be a string or, for delegated, a boolean`); }
  const rd = { title: typeof u.title === "string" ? u.title : ruleId, role: id, priority: 0, match: {} as RuleDef["match"] };
  problems.push(...applyRuleEdits(rd, { ...(typeof u.priority === "number" ? { priority: u.priority } : {}), matches }));
  let marked: string[] = [];
  if (p.marked !== undefined) {
    if (Array.isArray(p.marked) && p.marked.every((m) => typeof m === "string")) marked = p.marked as string[];
    else problems.push("`marked` must be a list of the grants the user is asked to accept: permission names, or `level`");
  }
  for (const m of marked) if (m !== "level" && !CATALOG.includes(m)) problems.push(`\`marked\` names \`${m}\`, which is not a permission or \`level\``);
  if (problems.length) return { proposal: null, problems };
  return { proposal: { role: { id, title: draft.title, level: draft.level, defaultMode: draft.defaultMode, modes: draft.modes }, rule: { id: ruleId, ...rd }, marked }, problems: [] };
}

/** The grants of the proposed role above the proposer's own: permissions with a more permissive effective mode, and `level` when not below the proposer's. */
export function capGrants(preset: Preset, proposer: string, def: CustomRoleDef): Array<{ grant: string; proposed: string; own: string }> {
  const probe: Preset = { ...preset, customRoles: { ...preset.customRoles, [def.id]: def } };
  const out: Array<{ grant: string; proposed: string; own: string }> = CATALOG.filter((p) => RANK[mode(probe, def.id, p)] > RANK[mode(preset, proposer, p)])
    .map((grant) => ({ grant, proposed: mode(probe, def.id, grant), own: mode(preset, proposer, grant) }));
  const own = levelOf(preset, proposer);
  if (def.level >= own) out.push({ grant: "level", proposed: String(def.level), own: String(own) });
  return out;
}

/** Why a proposal can never succeed with these parameters, before anything is stored; empty when it can. */
export function proposalProblems(root: string, preset: Preset, proposer: string, params: unknown): string[] {
  const { proposal, problems } = parseProposal(params);
  if (!proposal) return problems;
  const out: string[] = [];
  const { role, rule, marked } = proposal;
  const roleTaken = readRoleFiles(root, "work", CATALOG, BUILTIN_ROLES).roles.some((r) => r.id === role.id) || readRoleFiles(root, "head", CATALOG, BUILTIN_ROLES).roles.some((r) => r.id === role.id) || fs.existsSync(path.join(root, roleFile(role.id)));
  if (roleTaken) out.push(`role \`${role.id}\` already exists; a proposal only creates a new role`);
  const ruleTaken = readRuleFiles(root, "work").rules.some((r) => r.id === rule.id) || readRuleFiles(root, "head").rules.some((r) => r.id === rule.id) || fs.existsSync(path.join(root, ruleFile(rule.id)));
  if (ruleTaken) out.push(`rule \`${rule.id}\` already exists; a proposal only creates a new rule`);
  for (const g of capGrants(preset, proposer, role)) {
    if (!marked.includes(g.grant)) out.push(g.grant === "level"
      ? `the proposed level ${g.proposed} is not below the ${proposer} level (${g.own}); name \`level\` in \`marked\` to ask the user to accept it (R44.2)`
      : `\`${g.grant}\` would be ${g.proposed}, more permissive than the ${proposer} role's own ${g.own}; name it in \`marked\` to ask the user to accept it (R44.2)`);
  }
  return out;
}

/** The preview the request shows: the role and the rule in the layout of `role show` and `role rule show`, then each grant above the proposer's own. */
export function proposalPreview(preset: Preset, proposer: string, p: Proposal): string[] {
  const { role, rule, marked } = p;
  const probe: Preset = { id: "x", number: 0, defaultMode: "deny", standardUser: { modes: {} }, llm: { modes: {} }, customRoles: { [role.id]: role } };
  const trust = aboveLlm(role.id, new Map([[role.id, { def: role }]]));
  const grants = capGrants(preset, proposer, role);
  return [
    `${role.id} (custom, proposed: not written until accepted, and it applies only after it is committed and approved); management level ${role.level}; default mode ${role.defaultMode}`,
    ...CATALOG.map((c) => `${c}  ${mode(probe, role.id, c)}`),
    `${rule.id}: gives ${rule.role}, priority ${rule.priority}, matches ${JSON.stringify(rule.match)}`,
    `needs local trust: ${trust}${trust ? " (accepting does not trust it)" : ""}`,
    grants.length ? `above the ${proposer} role's own (${preset.id}):` : `above the ${proposer} role's own (${preset.id}): none`,
    ...grants.map((g) => `  ${g.grant === "level" ? `level ${g.proposed} (${proposer} level ${g.own})` : `${g.grant}: ${g.proposed} (${proposer} has ${g.own})`} ${marked.includes(g.grant) ? "[marked by the proposer: accepting accepts it]" : "[NOT marked: refused]"}`),
  ];
}

/**
 * Accepting a proposal (`R44.2`): the accepting actor needs `role.manage` and `role.map` as allow and a management level above the
 * proposed role. The cap is checked again against the proposer. The role and rule files are written uncommitted; the rule is
 * not trusted, so a rule above the default LLM role still needs `role rule trust`.
 */
export function roleProposeAccept(ctx: RoleCtx, proposer: Actor["role"], params: unknown): RoleResult {
  const { proposal, problems } = parseProposal(params);
  const fail = (reasons: string[]): RoleResult => ({ ok: false, lines: [], reasons, written: false });
  if (!proposal) return fail(problems);
  const { role, rule } = proposal;
  const describe = `accepting the proposal of role \`${role.id}\``;
  const refused = needs(ctx, "role.manage", describe) ?? needs(ctx, "role.map", describe) ?? above(ctx, describe, [[role.id, role.level]]);
  if (refused) { record(ctx, "role propose", [role.id], "role.manage", "refused", null, null, refused); return fail([refused]); }
  const more = proposalProblems(ctx.root, ctx.preset, proposer, params);
  if (more.length) { record(ctx, "role propose", [role.id], "role.manage", "refused", null, null, more.join(" ")); return fail(more); }
  writeFile(ctx.root, roleFile(role.id), serializeRole(role));
  writeFile(ctx.root, ruleFile(rule.id), serializeRule(rule));
  record(ctx, "role propose", [role.id, rule.id], "role.manage", "done", null, { level: role.level, default_mode: role.defaultMode, rule: rule.id });
  const trust = aboveLlm(role.id, new Map([[role.id, { def: role }]]));
  return {
    ok: true, written: true, reasons: [],
    lines: [
      `Created role \`${role.id}\` at management level ${role.level} and rule \`${rule.id}\`.`,
      `Written to ${roleFile(role.id)} and ${ruleFile(rule.id)}, not committed. Once committed, approve them with \`specplane role approve ${role.id}\` and \`specplane role rule approve ${rule.id}\`${trust ? ", and trust the rule on this machine (`specplane role rule trust`): accepting did not trust it" : ""}.`,
    ],
    data: { id: role.id, rule: rule.id, uncommitted: [roleFile(role.id), ruleFile(rule.id)], commit: { scope: "roles", summary: `add role ${role.id} and rule ${rule.id}` } },
  };
}
