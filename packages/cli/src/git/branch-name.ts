import { AsyncLocalStorage } from 'node:async_hooks';
import { run } from './exec.js';

const validations = new AsyncLocalStorage<Set<string>>();

/** Reuse only successful syntax checks during one operation, never refs or objects. */
export function withBranchNameCache<T>(operation: () => T): T {
  return validations.run(new Set(), operation);
}

export function isBranchName(cwd: string, name: string): boolean {
  // --branch expands checkout-history expressions; these are not literal names.
  if (!name || name.startsWith('-') || name.includes('@{')) return false;
  const key = JSON.stringify([cwd, name]);
  const cache = validations.getStore();
  if (cache?.has(key)) return true;
  try {
    if (run('git', ['check-ref-format', '--branch', name], { cwd }).trim() !== name) return false;
    cache?.add(key);
    return true;
  } catch {
    return false;
  }
}
