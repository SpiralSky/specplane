import * as fs from "node:fs";
import * as path from "node:path";
import { codexAdapter } from "./adapter-codex.js";
import { noCapabilities, registerAdapter, type Capabilities, type HarnessAdapter } from "./adapter.js";

/**
 * The capability declarations of the supported harnesses (`harness R35.1`). Only what is verified or installed is
 * claimed; the Claude and Codex integration units add the host-specific behaviour behind these claims. Codex claims
 * nothing until each surface has a live check (`codex-integration` §7).
 */

export const claudeAdapter: HarnessAdapter = {
  name: "claude",
  capabilities(root?: string): Capabilities {
    const caps = noCapabilities();
    caps["instructions-on-demand"] = true; // Skills load on demand.
    caps.subagents = true;
    caps.viewing = true; // `/spec-view` runs in the user-command runner with no model turn.
    caps["usage-measurement"] = true; // The session adapter reads usage from the host's rate limit event.
    caps["session-opening"] = true; // `claude -p` in the plan checkout.
    // Blocking needs the installed pre-tool hook, so it is claimed only when that file is present.
    caps["command-blocking"] = !!root && fs.existsSync(path.join(root, ".claude/hooks/specplane-cli-block.sh"));
    // The marker, headless-session and store guards live in one installed hook (`roles-and-permissions` R58).
    caps["bypass-guards"] = !!root && fs.existsSync(path.join(root, ".claude/hooks/specplane-bypass-guard.sh"));
    return caps;
  },
};

export { codexAdapter };
registerAdapter(claudeAdapter);
registerAdapter(codexAdapter);
