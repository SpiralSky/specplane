import * as fs from "node:fs";
import * as path from "node:path";
import { audit, type AuditActor } from "../audit/log.js";
import { clock, randomHex } from "../clock.js";
import { storeDir } from "../repo/store.js";

/** Test logs (`architecture/reference-cli` §10.5, `architecture/file-formats` §11.4). */

const DAY = 86_400_000;
const LOG_FILE = /^\d{8}T\d{6}Z-[0-9a-f]{4}\.log$/;

export type LogMode = "local" | "git" | "off";

/** `<YYYYMMDDTHHMMSSZ>-<4 hex>`. */
export function newLogId(now: Date = clock.now()): string {
  return `${now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "")}-${randomHex(4)}`;
}

/** The folder for `git` logs: `paths.test_logs` inside the checkout, or null when it points outside it. */
export function gitLogDir(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const within = path.relative(path.resolve(root), abs);
  return within === "" || within.startsWith("..") || path.isAbsolute(within) ? null : abs;
}

export const GIT_LOG_WARNING = "tests.logs is git: test logs are committed with the project, so make sure they hold no private information";

export interface LogWrite { id: string; file: string; warning?: string }

/** Write one log. Returns null when logs are off, or when the folder could not be used (the caller warns). */
export function writeLog(root: string, mode: LogMode, gitDir: string, text: string, now: Date = clock.now()): LogWrite | { error: string } | null {
  if (mode === "off") return null;
  const dir = mode === "local" ? path.join(storeDir(root), "logs") : gitLogDir(root, gitDir);
  if (dir === null) return { error: `paths.test_logs \`${gitDir}\` is outside the repository; the log was not written` };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const id = newLogId(now);
    const file = path.join(dir, `${id}.log`);
    fs.writeFileSync(file, text, { flag: "wx" });
    return { id, file, ...(mode === "git" ? { warning: `${GIT_LOG_WARNING} (wrote ${path.relative(root, file)})` } : {}) };
  } catch (e) { return { error: `the test log could not be written: ${(e as Error).message}` }; }
}

/** Delete local logs older than `days` (never `git` logs) and audit the prune (`§10.5`). Returns how many went. */
export function pruneLogs(root: string, days: number | "forever", actor: AuditActor, now: Date = clock.now()): number {
  if (days === "forever") return 0;
  const dir = path.join(storeDir(root), "logs");
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    if (!LOG_FILE.test(n)) continue;
    try {
      if (now.getTime() - fs.statSync(path.join(dir, n)).mtimeMs > days * DAY) { fs.rmSync(path.join(dir, n), { force: true }); removed++; }
    } catch { /* the file vanished: someone else pruned it */ }
  }
  if (removed) audit(root, { command: "logs prune", args: [], permission: null, outcome: "done", actor, new: { removed } }, now);
  return removed;
}
