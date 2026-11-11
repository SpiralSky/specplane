/**
 * Side effects of a setting change (`architecture/reference-cli` §3.2): turning `pre_commit.*` on or off installs or
 * removes the hook section (`§14.2`, U19); preset/custom changes regenerate currently committed steering.
 * Other handlers may be registered here; the built-in effects run when none is registered for the key.
 */

import { HOOK_SETTINGS, hookFile, installHookSection, removeHookSection } from "./git/hooks.js";
import { steeringConfigEffect } from "./harness/steering.js";

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
  return out;
}
