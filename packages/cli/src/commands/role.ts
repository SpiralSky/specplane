import { withStoreLock } from "../repo/store.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, osUserName } from "../perm/permissions.js";
import {
  mapList, mapUser, roleApprove, roleCreate, roleDelete, roleEdit, roleList, roleShow, ruleApprove, ruleCreate, ruleDelete, ruleEdit, ruleList, ruleShow, ruleTrust,
  unmapUser, type RoleCtx, type RoleEdits, type RoleResult, type RuleEdits,
} from "../perm/role-ops.js";
import type { CommandResult } from "./runner.js";

/** `role list|show|create|edit|delete|approve`, `role rule ...`, `role map|unmap|mappings` (`architecture/reference-cli` §7.7). */

const result = (r: RoleResult, permission: string | null = null): CommandResult => ({ ok: r.ok, data: r.data ?? null, findings: r.reasons, lines: r.lines, ...(permission ? { permission } : {}) });

function write(permission: string | null, fn: (c: RoleCtx) => RoleResult): CommandResult {
  const root = checkoutRoot();
  return result(withStoreLock(root, "commands", () => fn({ root, actor: cliActor(root), preset: activePreset(root) })), permission);
}

export const roleListCommand = (): CommandResult => result(roleList(checkoutRoot()));
export const roleDescribeCommand = (id: string): CommandResult => result(roleShow(checkoutRoot(), id));
export const roleCreateCommand = (id: string, e: RoleEdits): CommandResult => write("role.manage", (c) => roleCreate(c, id, e));
export const roleEditCommand = (id: string, e: RoleEdits): CommandResult => write("role.manage", (c) => roleEdit(c, id, e));
export const roleDeleteCommand = (id: string): CommandResult => write("role.manage", (c) => roleDelete(c, id));
export const roleApproveCommand = (id: string): CommandResult => write("role.manage", (c) => roleApprove(c, id));

export const ruleListCommand = (): CommandResult => result(ruleList(checkoutRoot()));
export const ruleShowCommand = (id: string): CommandResult => result(ruleShow(checkoutRoot(), id));
export const ruleCreateCommand = (id: string, e: RuleEdits): CommandResult => write("role.map", (c) => ruleCreate(c, id, e));
export const ruleEditCommand = (id: string, e: RuleEdits): CommandResult => write("role.map", (c) => ruleEdit(c, id, e));
export const ruleDeleteCommand = (id: string): CommandResult => write("role.map", (c) => ruleDelete(c, id));
export const ruleApproveCommand = (id: string): CommandResult => write("role.manage", (c) => ruleApprove(c, id));
export const ruleTrustCommand = (id: string): CommandResult => write(null, (c) => ruleTrust(c, id));

export const mappingsCommand = (): CommandResult => result(mapList(checkoutRoot(), osUserName()));
export const mapCommand = (user: string, role: string, adminSwitch: boolean): CommandResult => write("role.map", (c) => mapUser(c, user, role, adminSwitch));
export const unmapCommand = (user: string): CommandResult => write("role.map", (c) => unmapUser(c, user));
