import { CATALOG, BUILTIN_ROLES, LEVELS, ROLE_PERMISSIONS, type CustomRoleDef, type RoleId } from "./permissions.js";
import { isTrusted, loadRoleSet, ruleApproved, FACTORS, type Factor, type RuleDef, type RuleFile } from "./roles.js";

/**
 * Custom LLM role rules (`feature/roles-and-permissions` R44.1, R48): which role an LLM has, from what the harness knows
 * about it. A rule applies only when its file is approved at HEAD and, if it gives a role above the default LLM role,
 * trusted on this machine. No matching rule leaves the default LLM role.
 */

export type LlmFactors = Partial<Record<Factor, string | boolean>>;

const matches = (want: string | boolean, have: string | boolean | undefined): boolean => {
  if (typeof want === "boolean") return have === want;
  if (typeof have !== "string") return false;
  return want.endsWith("*") ? have.startsWith(want.slice(0, -1)) : have === want;
};

/** True when every factor the rule states matches. */
export function ruleMatches(rule: RuleDef, f: LlmFactors): boolean {
  return (Object.entries(rule.match) as [Factor, string | boolean][]).every(([k, v]) => FACTORS.includes(k) && matches(v, f[k]));
}

/** Level of the role a rule gives, or `undefined` when no such role applies. */
export function ruleRoleLevel(role: string, applied: Map<string, { def: CustomRoleDef }>): number | undefined {
  return LEVELS[role] ?? applied.get(role)?.def.level;
}

/** A role above the default LLM role: a higher management level, or a management or system permission (`R48`). */
export function aboveLlm(role: string, applied: Map<string, { def: CustomRoleDef }>): boolean {
  const def = applied.get(role)?.def;
  if (def && ROLE_PERMISSIONS.some((p) => def.modes[p] && def.modes[p] !== "deny")) return true;
  return (ruleRoleLevel(role, applied) ?? 0) > LEVELS.llm;
}

export interface RuleStatus { rule: RuleFile; approved: boolean; roleApplies: boolean; needsTrust: boolean; trusted: boolean }

/** Every rule at HEAD with whether it can apply here. */
export function ruleStatuses(root: string): RuleStatus[] {
  const set = loadRoleSet(root, CATALOG, BUILTIN_ROLES);
  return set.rules.map((rule) => {
    const level = ruleRoleLevel(rule.role, set.roles);
    const needsTrust = level !== undefined && aboveLlm(rule.role, set.roles);
    return { rule, approved: ruleApproved(root, set.notes, rule), roleApplies: level !== undefined, needsTrust, trusted: level !== undefined && isTrusted(root, rule, level) };
  });
}

/** The role an LLM with these factors has: the matching applicable rule of the highest priority (then the smallest ID), else `llm`. */
export function resolveLlmRole(root: string, factors: LlmFactors): RoleId {
  try {
    const usable = ruleStatuses(root).filter((s) => s.approved && s.roleApplies && (!s.needsTrust || s.trusted) && ruleMatches(s.rule, factors));
    usable.sort((a, b) => b.rule.priority - a.rule.priority || a.rule.id.localeCompare(b.rule.id));
    return usable[0]?.rule.role ?? "llm";
  } catch { return "llm"; }
}
