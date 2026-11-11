import * as fs from "node:fs";
import * as path from "node:path";
import { storeDir } from "../repo/store.js";

/** Reading the audit log for `specplane audit` (`architecture/reference-cli` §9). */

export interface AuditLine {
  ts: string; branch: string; actor: { role: string; kind: string; name: string }; model: string | null;
  command: string; args: string[]; permission: string | null; outcome: string; reason: string | null;
  old: unknown; new: unknown; request: string | null;
}

export interface AuditFilter { since?: Date; branch?: string; actor?: string }

/** Matching entries in file order, and the number of lines that could not be parsed (skipped). */
export function readAudit(root: string, f: AuditFilter = {}): { entries: AuditLine[]; skipped: number } {
  let text = "";
  try { text = fs.readFileSync(path.join(storeDir(root), "audit.jsonl"), "utf8"); } catch { return { entries: [], skipped: 0 }; }
  const entries: AuditLine[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: AuditLine;
    try {
      e = JSON.parse(line) as AuditLine;
      if (typeof e.ts !== "string" || typeof e.command !== "string" || Number.isNaN(Date.parse(e.ts))) throw new Error("shape");
    } catch { skipped++; continue; }
    if (f.since && Date.parse(e.ts) < f.since.getTime()) continue;
    if (f.branch && e.branch !== f.branch) continue;
    if (f.actor && e.actor?.role !== f.actor) continue;
    entries.push(e);
  }
  return { entries, skipped };
}
