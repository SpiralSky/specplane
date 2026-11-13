import * as fs from "node:fs";
import * as path from "node:path";
import { readStoreJson, removeStoreJson, storeDir } from "../repo/store.js";

/**
 * Per-call subagent identity (`roles-and-permissions R58`, `reference-cli` §12.1). All callers of a Claude Code session
 * share one MCP process, so the host's pre-tool hook records who makes each call, keyed by the tool-use ID the MCP request
 * also carries. The record is read once and deleted; tool input never supplies it.
 */
export interface Caller { agentType?: string; agentId?: string }

export const TOOL_USE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const clean = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);

/** The tool-use ID of an MCP `tools/call` request, or undefined when absent or not of the accepted shape. */
export function toolUseIdOf(params: unknown): string | undefined {
  const meta = (params as { _meta?: unknown } | null)?._meta;
  const id = typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>)["claudecode/toolUseId"] : undefined;
  return typeof id === "string" && TOOL_USE_ID.test(id) ? id : undefined;
}

/** Remove records older than 24 hours; best effort. */
export function pruneCallers(root: string, now: number = Date.now()): void {
  try {
    const dir = path.join(storeDir(root), "callers");
    for (const f of fs.readdirSync(dir)) {
      const file = path.join(dir, f);
      try { if (now - fs.lstatSync(file).mtimeMs > MAX_AGE_MS) fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    }
  } catch { /* no folder */ }
}

/** Read and delete the caller record of a tool-use ID. No record, or an unreadable one, means no subagent identity. */
export function takeCaller(root: string, toolUseId: string | undefined): Caller | undefined {
  if (!toolUseId || !TOOL_USE_ID.test(toolUseId)) return undefined;
  try {
    pruneCallers(root);
    const name = `callers/${toolUseId}.json`;
    const rec = readStoreJson<Record<string, unknown>>(root, name);
    if (rec === null) return undefined;
    removeStoreJson(root, name);
    const agentType = clean(rec.agent_type), agentId = clean(rec.agent_id);
    return agentType || agentId ? { ...(agentType ? { agentType } : {}), ...(agentId ? { agentId } : {}) } : undefined;
  } catch { return undefined; }
}
