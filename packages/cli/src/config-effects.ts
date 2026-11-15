/**
 * Side effects of a setting change (`architecture/reference-cli` §3.2): turning `pre_commit.*` on or off installs or
 * removes the hook section (`§14.2`, U19); preset/custom changes regenerate currently committed steering.
 * Other handlers may be registered here; the built-in effects run when none is registered for the key.
 */

import { HOOK_SETTINGS, STRICT_CHECK, hookFile, installHookSection, removeHookSection } from "./git/hooks.js";
import { strictMeasureInWorkingTree } from "./perm/strict.js";
import { applyOsSafeguards, relaxOsSafeguards } from "./perm/strict-os.js";
import { steeringConfigEffect } from "./harness/steering.js";
import { pushMissingNotes } from "./harness/install.js";

export type EffectHandler = (root: string, key: string, old: unknown, next: unknown) => string[];

const handlers = new Map<string, EffectHandler>();

/** Register the handler for a setting key or a key prefix ending in `.` (for example `pre_commit.`). */
export function registerEffect(keyOrPrefix: string, handler: EffectHandler): void { handlers.set(keyOrPrefix, handler); }

export function clearEffects(): void { handlers.clear(); }

/** Install or remove the hook section of a `pre_commit.*` setting (`§14.2`). */
function preCommitEffect(root: string, key: string, next: unknown): string[] {
  const check = HOOK_SETTINGS[key];
  if (!check) return [];
  if (next === true) return [installHookSection(root, check) === "installed" ? `Installed the ${check} check in ${hookFile(root)}.` : `The ${check} check is already in the pre-commit hook.`];
  return [removeHookSection(root, check) === "removed" ? `Removed the ${check} check from the pre-commit hook.` : `The ${check} check was not in the pre-commit hook.`];
}

/**
 * A `strict_mode.*` change (`roles-and-permissions R55.1`): the commit guard section and the file permissions follow the
 * setting as it stands in the working-tree file, which the change just wrote.
 */
function strictEffect(root: string): string[] {
  const out: string[] = [];
  if (strictMeasureInWorkingTree(root, "git_commit_guard")) {
    out.push(installHookSection(root, STRICT_CHECK) === "installed" ? `Installed the strict commit guard in ${hookFile(root)}.` : "The strict commit guard is already in the pre-commit hook.");
  } else if (removeHookSection(root, STRICT_CHECK) === "removed") out.push("Removed the strict commit guard from the pre-commit hook.");
  if (strictMeasureInWorkingTree(root, "os_permissions")) out.push(...applyOsSafeguards(root));
  else out.push(...relaxOsSafeguards(root));
  return out;
}

/** Run the registered effect for `key`; the lines to print. */
export function applyEffects(root: string, key: string, old: unknown, next: unknown): string[] {
  if (JSON.stringify(old) === JSON.stringify(next)) return [];
  const out: string[] = [];
  let handled = false;
  for (const [k, h] of handlers) {
    if (key === k || (k.endsWith(".") && key.startsWith(k))) { out.push(...h(root, key, old, next)); handled = true; }
  }
  if (!handled && (key === "permissions.preset" || key === "steering.custom")) {
    out.push(...steeringConfigEffect(root));
    handled = true;
  }
  if (!handled && key.startsWith("pre_commit.")) out.push(...preCommitEffect(root, key, next));
  if (!handled && key === "notifications.push" && next === true) out.push(...pushMissingNotes(root));
  if (!handled && key.startsWith("strict_mode")) out.push(...strictEffect(root));
  return out;
}
