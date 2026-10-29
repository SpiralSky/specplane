import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path inside `packages/cli/test/fixtures` (works from `dist/`). */
export function fixture(...parts: string[]): string {
  return path.join(fileURLToPath(new URL("../test/fixtures/", import.meta.url)), ...parts);
}
