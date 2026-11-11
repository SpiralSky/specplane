/**
 * Side effects of a setting change (`architecture/reference-cli` §3.2): turning `pre_commit.*` on or off installs or
 * removes the hook section (`§14.2`, U19); changing `permissions.preset` regenerates steering (`§12.4`, U9). Those
 * units register their handler here; until then a change only reports the effect that is still to come.
 */

export type EffectHandler = (root: string, key: string, old: unknown, next: unknown) => string[];

const handlers = new Map<string, EffectHandler>();

/** Register the handler for a setting key or a key prefix ending in `.` (for example `pre_commit.`). */
export function registerEffect(keyOrPrefix: string, handler: EffectHandler): void { handlers.set(keyOrPrefix, handler); }

export function clearEffects(): void { handlers.clear(); }

const PENDING: Array<[string, string]> = [
  ["permissions.preset", "The active preset changed; steering is regenerated once steering generation is available."],
  ["pre_commit.", "The pre-commit hook section is installed or removed once pre-commit checks are available."],
];

/** Run the registered effect for `key`; the lines to print. */
export function applyEffects(root: string, key: string, old: unknown, next: unknown): string[] {
  if (JSON.stringify(old) === JSON.stringify(next)) return [];
  const out: string[] = [];
  let handled = false;
  for (const [k, h] of handlers) {
    if (key === k || (k.endsWith(".") && key.startsWith(k))) { out.push(...h(root, key, old, next)); handled = true; }
  }
  if (!handled) for (const [k, note] of PENDING) if (key === k || (k.endsWith(".") && key.startsWith(k))) out.push(note);
  return out;
}
