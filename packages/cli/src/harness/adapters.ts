import * as fs from "node:fs";
import * as path from "node:path";
import { codexAdapter } from "./adapter-codex.js";
import { readStoreJson, storeDir } from "../repo/store.js";
import { guardHookHasStrict } from "../perm/strict.js";
import { noCapabilities, registerAdapter, type Capabilities, type HarnessAdapter } from "./adapter.js";

/**
 * The capability declarations of the supported harnesses (`harness R35.1`). Only what is verified or installed is
 * claimed; the Claude and Codex integration units add the host-specific behaviour behind these claims. Codex claims
 * nothing until each surface has a live check (`codex-integration` §7).
 */

/** The match recorded by each live session server (`reference-cli` §12.8); empty when no session server runs. */
export function sessionServerMatches(root: string): boolean[] {
  const out: boolean[] = [];
  try {
    for (const f of fs.readdirSync(path.join(storeDir(root), "sessions"))) {
      if (!f.endsWith(".host.json")) continue;
      const rec = readStoreJson<{ adapter?: string; pid?: number; match?: boolean }>(root, `sessions/${f}`);
      if (rec?.adapter !== "claude" || !Number.isInteger(rec.pid)) continue;
      try { process.kill(rec.pid!, 0); out.push(rec.match === true); } catch (e) { if ((e as NodeJS.ErrnoException).code === "EPERM") out.push(rec.match === true); }
    }
  } catch { /* no store or no record */ }
  return out;
}

export const claudeAdapter: HarnessAdapter = {
  name: "claude",
  capabilities(root?: string): Capabilities {
    const caps = noCapabilities();
    caps["instructions-on-demand"] = true; // Skills load on demand.
    caps.subagents = true;
    caps.viewing = true; // `/spec-view` runs in the user-command runner with no model turn.
    caps["usage-measurement"] = true; // The session adapter reads usage from the host's rate limit event.
    caps.push = true; // The plugin's `$.ui.notify` sends it (`claude-integration` §3); the adapter cannot tell whether the plugin is loaded, so a session without the plugin sends none.
    caps["session-opening"] = true; // `claude -p` in the plan checkout.
    // Blocking needs the installed pre-tool hook, so it is claimed only when that file is present.
    caps["command-blocking"] = !!root && fs.existsSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"));
    // The marker, headless-session and store guards live in one installed hook (`roles-and-permissions` R58).
    caps["bypass-guards"] = !!root && fs.existsSync(path.join(root, ".claude/hooks/specplane-bypass-guard.sh"));
    // Strict mode's edit block lives in the same hook, so an installed copy that predates it does not count.
    caps["strict-mode"] = !!root && guardHookHasStrict(root);
    // Per-call subagent identity comes from the caller hook (`roles-and-permissions` R58).
    // Or from the session server of `reference-cli` §12.8.
    // When a session server serves the session, only its version match decides; the hook then does not count.
    const served = root ? sessionServerMatches(root) : [];
    caps["subagent-identity"] = !!root && (served.length ? served.some(Boolean) : fs.existsSync(path.join(root, ".claude/hooks/specplane-caller.sh")));
    return caps;
  },
};

export { codexAdapter };
registerAdapter(claudeAdapter);
registerAdapter(codexAdapter);
