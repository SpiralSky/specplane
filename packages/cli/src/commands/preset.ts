import { withStoreLock } from "../repo/store.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor } from "../perm/permissions.js";
import { presetCreate, presetDelete, presetEdit, presetList, presetShow, type Edits, type PresetResult } from "../perm/preset-ops.js";
import type { CommandResult } from "./runner.js";

/** `preset list|show|create|edit|delete` (`architecture/reference-cli` §7.5). */

const result = (r: PresetResult): CommandResult => ({ ok: r.ok, data: r.data ?? null, findings: r.reasons, lines: r.lines, permission: r.permission ?? "config.change" });

function write(fn: (c: { root: string; actor: ReturnType<typeof cliActor>; preset: ReturnType<typeof activePreset> }) => PresetResult): CommandResult {
  const root = checkoutRoot();
  return result(withStoreLock(root, "commands", () => fn({ root, actor: cliActor(root), preset: activePreset(root) })));
}

export const presetListCommand = (): CommandResult => result(presetList(checkoutRoot()));
export const presetShowCommand = (id: string): CommandResult => result(presetShow(checkoutRoot(), id));
export const presetCreateCommand = (id: string, e: Edits): CommandResult => write((c) => presetCreate(c, id, e));
export const presetEditCommand = (id: string, e: Edits): CommandResult => write((c) => presetEdit(c, id, e));
export const presetDeleteCommand = (id: string): CommandResult => write((c) => presetDelete(c, id));
