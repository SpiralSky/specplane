import { withCheckoutLease } from "../core/checkout-coordination.js";
import { configGet, configList, configSet, configUnset, type ConfigCtx, type ConfigResult } from "../config-ops.js";
import { reportError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliRole, gitUserName } from "../perm/permissions.js";
import { describePermission, listPermissions } from "../perm/docs.js";

/** `config get|set|unset|list` and `permissions` (`architecture/reference-cli` §13.1). */

function ctx(): ConfigCtx {
  const root = checkoutRoot();
  return { root, actor: { role: cliRole(root), kind: "human", name: gitUserName(root) ?? "unknown" }, preset: activePreset(root) };
}

function print(r: ConfigResult, json?: boolean): void {
  if (json) process.stdout.write(JSON.stringify({ ok: r.ok, data: r.data ?? null, findings: r.reasons, warnings: [] }) + "\n");
  else {
    for (const l of r.lines) process.stdout.write(`${l}\n`);
    for (const l of r.reasons) process.stderr.write(`${l}\n`);
  }
  if (!r.ok) process.exitCode = 1;
}

function guarded(fn: () => void): void {
  try { fn(); } catch (e) { if (!reportError(e)) throw e; }
}

export const configGetCommand = (key: string | undefined, opts: { json?: boolean }) => guarded(() => print(configGet(checkoutRoot(), key), opts.json));
export const configListCommand = (opts: { json?: boolean }) => guarded(() => print(configList(checkoutRoot()), opts.json));
export const configSetCommand = (key: string, value: string, opts: { json?: boolean }) => guarded(() => {
  const c = ctx();
  print(withCheckoutLease(c.root, "config", false, () => configSet(c, key, value)), opts.json);
});
export const configUnsetCommand = (key: string, opts: { json?: boolean }) => guarded(() => {
  const c = ctx();
  print(withCheckoutLease(c.root, "config", false, () => configUnset(c, key)), opts.json);
});

export const permissionsCommand = (id: string | undefined, opts: { json?: boolean }) => guarded(() => {
  const root = checkoutRoot();
  const reader = cliRole(root);
  if (id === undefined) {
    const l = listPermissions(root, reader);
    if (opts.json) process.stdout.write(JSON.stringify({ ok: true, data: { preset: l.preset, reader: l.reader, permissions: l.rows }, findings: [], warnings: [] }) + "\n");
    else process.stdout.write(l.lines.join("\n") + "\n");
    return;
  }
  const d = describePermission(root, id, reader);
  if (!d) { process.stderr.write(`unknown permission \`${id}\`; \`specplane permissions\` lists them\n`); process.exitCode = 1; return; }
  if (opts.json) process.stdout.write(JSON.stringify({ ok: true, data: d, findings: [], warnings: [] }) + "\n");
  else process.stdout.write(d.lines.join("\n") + "\n");
});
