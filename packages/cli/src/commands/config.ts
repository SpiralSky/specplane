import { withCheckoutLease } from "../core/checkout-coordination.js";
import { configGet, configList, configSet, configUnset, type ConfigCtx, type ConfigResult } from "../config-ops.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, cliRole } from "../perm/permissions.js";
import type { CommandResult } from "./runner.js";
import { describePermission, listPermissions } from "../perm/docs.js";

/** `config get|set|unset|list` and `permissions` (`architecture/reference-cli` §13.1). */

function ctx(): ConfigCtx {
  const root = checkoutRoot();
  return { root, actor: cliActor(root), preset: activePreset(root) };
}

function result(r: ConfigResult): CommandResult {
  return { ok: r.ok, data: r.data ?? null, findings: r.reasons, lines: r.lines, held: !!r.request, ...(r.request ? { permission: "config.change" } : {}) };
}

export const configGetCommand = (key: string | undefined): CommandResult => result(configGet(checkoutRoot(), key));
export const configListCommand = (): CommandResult => result(configList(checkoutRoot()));
export const configSetCommand = (key: string, value: string): CommandResult => {
  const c = ctx();
  return result(withCheckoutLease(c.root, "config", false, () => configSet(c, key, value)));
};
export const configUnsetCommand = (key: string): CommandResult => {
  const c = ctx();
  return result(withCheckoutLease(c.root, "config", false, () => configUnset(c, key)));
};

export const permissionsCommand = (id: string | undefined): CommandResult => {
  const root = checkoutRoot();
  const reader = cliRole(root);
  if (id === undefined) {
    const l = listPermissions(root, reader);
    return { ok: true, data: { preset: l.preset, reader: l.reader, permissions: l.rows }, lines: l.lines };
  }
  const d = describePermission(root, id, reader);
  if (!d) return { ok: false, findings: [`unknown permission \`${id}\`; \`specplane permissions\` lists them`] };
  return { ok: true, data: d, lines: d.lines };
};
