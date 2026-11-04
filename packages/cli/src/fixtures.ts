import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path inside `packages/cli/test/fixtures` (works from `dist/`). */
export function fixture(...parts: string[]): string {
  return path.join(fileURLToPath(new URL("../test/fixtures/", import.meta.url)), ...parts);
}

/** Fault injection for builtin fs imports in either supported test runner. */
export async function filesystemMocks() {
  const nativeFs = await import('node:fs');
  const restorations = new Set<() => void>();
  // Keep the optional Bun test module out of Node's static module resolution.
  const runnerModule = 'bun:test';
  const bun = 'bun' in process.versions ? await import(runnerModule) : null;
  const node = bun ? null : await import('node:test');
  return {
    method<K extends keyof typeof nativeFs.default>(target: typeof nativeFs.default, key: K, implementation: typeof nativeFs.default[K]) {
      const replacement = bun
        ? bun.spyOn(nativeFs, key).mockImplementation(implementation)
        : node!.mock.method(target, key, implementation as never);
      const restore = () => {
        if (!restorations.delete(restore)) return;
        if (bun) replacement.mockRestore(); else replacement.mock.restore();
      };
      restorations.add(restore);
      return { mock: { restore } };
    },
    restoreAll() { for (const restore of [...restorations].reverse()) restore(); },
  };
}
