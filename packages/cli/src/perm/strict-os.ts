import * as fs from "node:fs";
import * as path from "node:path";
import { hookFile } from "../git/hooks.js";
import { storeDir } from "../repo/store.js";

/**
 * The operating system measure of strict mode, `strict_mode.os_permissions` (`feature/roles-and-permissions` R55.1,
 * `architecture/reference-cli` §15.3). Specplane's own files that decide who may do what are made read-only, and the
 * local store is kept private to its owner. This stops a process that runs as another operating system user, and makes
 * a same-user process change a mode first (which the harness hook blocks); it does not stop the owner or root.
 */

/** Hooks and settings that carry the harness measures, and the pre-commit hook that carries the commit guard. */
export function guardedFiles(root: string): string[] {
  const out: string[] = [];
  const hooks = path.join(root, ".claude", "hooks");
  try { for (const f of fs.readdirSync(hooks)) if (f.startsWith("specplane-")) out.push(path.join(hooks, f)); } catch { /* none installed */ }
  const settings = path.join(root, ".claude", "settings.json");
  if (fs.existsSync(settings)) out.push(settings);
  try { const h = hookFile(root); if (fs.existsSync(h)) out.push(h); } catch { /* not a repository */ }
  return out;
}

/** Local store files (`role.json`, `os-users.json`, `trusted-rules.json`, state) and the store folder. */
function storeEntries(root: string): { dir: string; files: string[] } {
  const dir = storeDir(root);
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(path.join(d, e.name)); else files.push(path.join(d, e.name));
    }
  };
  try { walk(dir); } catch { /* no store yet */ }
  return { dir, files };
}

const mode = (f: string): number => fs.statSync(f).mode & 0o777;

/** Make the guarded files read-only (keeping the execute bits), the store folder 0700 and its files 0600. Lines to print. */
export function applyOsSafeguards(root: string): string[] {
  const out: string[] = [];
  let changed = 0;
  for (const f of guardedFiles(root)) {
    const m = mode(f);
    if (m & 0o222) { fs.chmodSync(f, m & ~0o222); changed++; }
  }
  const { dir, files } = storeEntries(root);
  try { if (mode(dir) !== 0o700) { fs.chmodSync(dir, 0o700); changed++; } } catch { /* no store yet */ }
  for (const f of files) if (mode(f) !== 0o600) { fs.chmodSync(f, 0o600); changed++; }
  out.push(changed ? `Made ${changed} Specplane file(s) read-only or private (strict_mode.os_permissions).` : "The Specplane hooks, settings and local store already have the strict file permissions.");
  return out;
}

/** Undo the read-only bit on the guarded files; the store stays private, as it is harmless there. */
export function relaxOsSafeguards(root: string): string[] {
  let changed = 0;
  for (const f of guardedFiles(root)) {
    const m = mode(f);
    if (!(m & 0o200)) { fs.chmodSync(f, m | 0o200); changed++; }
  }
  return [changed ? `Made ${changed} Specplane hook or settings file(s) writable again.` : "No Specplane hook or settings file was read-only."];
}

/** Files that should be locked down but are not, for `validate`. */
export function openFiles(root: string): string[] {
  const out: string[] = [];
  for (const f of guardedFiles(root)) if (mode(f) & 0o222) out.push(path.relative(root, f));
  const { dir, files } = storeEntries(root);
  for (const f of files) if (mode(f) & 0o077) out.push(path.relative(root, f) || f);
  try { if (mode(dir) & 0o077) out.push(path.relative(root, dir)); } catch { /* no store */ }
  return out;
}
