import * as fs from "node:fs";
import * as path from "node:path";
import { clock } from "../clock.js";
import { storeDir } from "../repo/store.js";
import { audit, type AuditActor } from "./log.js";

/** Audit retention (`architecture/reference-cli` §9, `architecture/file-formats` §10). */

const DAY = 86_400_000;
/** A lock older than this was left by a crashed process. */
const STALE_LOCK_MS = 60_000;

export interface PruneResult { removed: number; oldest: string | null }

export interface PruneOptions {
  now?: Date;
  actor: AuditActor;
  /** Test hook: runs after the new file is written and before it replaces the log. */
  beforeRename?: () => void;
}

function takeLock(lock: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.closeSync(fs.openSync(lock, "wx")); return true; } catch {
      try {
        if (clock.now().getTime() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) { fs.rmSync(lock, { force: true }); continue; }
      } catch { /* the lock vanished; try again */ }
      return false;
    }
  }
  return false;
}

/**
 * Drop entries older than `days` by rewriting the log through a temp file and a rename, under `audit.lock`
 * (created with `wx`; pruning is skipped when another command holds it). A line appended while the rewrite runs is kept.
 * Lines that do not parse are kept, because the reader reports them. When something was removed, one `audit prune`
 * entry records how many and the oldest date kept. Returns `null` when nothing was done.
 */
export function pruneAudit(root: string, days: number | "forever", opts: PruneOptions): PruneResult | null {
  if (days === "forever") return null;
  const dir = storeDir(root);
  const file = path.join(dir, "audit.jsonl");
  if (!fs.existsSync(file)) return null;
  const now = opts.now ?? clock.now();
  const lock = path.join(dir, "audit.lock");
  if (!takeLock(lock)) return null;
  try {
    const raw = fs.readFileSync(file);
    const cutoff = now.getTime() - days * DAY;
    const kept: string[] = [];
    let removed = 0;
    let oldest: string | null = null;
    for (const line of raw.toString("utf8").split("\n")) {
      if (!line) continue;
      let ts: number | null = null;
      try { const t = Date.parse((JSON.parse(line) as { ts?: string }).ts ?? ""); ts = Number.isNaN(t) ? null : t; } catch { /* kept */ }
      if (ts !== null && ts < cutoff) { removed++; continue; }
      kept.push(line);
      if (ts !== null) { const d = new Date(ts).toISOString().slice(0, 10); if (oldest === null || d < oldest) oldest = d; }
    }
    if (removed === 0) return null;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, kept.length ? kept.join("\n") + "\n" : "");
    opts.beforeRename?.();
    const now2 = fs.readFileSync(file);
    if (now2.length > raw.length) fs.appendFileSync(tmp, now2.subarray(raw.length));
    fs.renameSync(tmp, file);
    audit(root, { command: "audit prune", args: [], permission: null, outcome: "done", actor: opts.actor, new: { removed, oldest } }, now);
    return { removed, oldest };
  } catch { return null; } finally { fs.rmSync(lock, { force: true }); }
}
