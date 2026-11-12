// The Specplane MCP server entry (`architecture/reference-cli` §12.1): the checkout is SPECPLANE_CHECKOUT, else the working
// directory. Identity comes only from the adapter's environment, never from tool input: SPECPLANE_SESSION,
// SPECPLANE_MODEL, SPECPLANE_DELEGATED_BY, SPECPLANE_PROVIDER, SPECPLANE_AGENT_TYPE, SPECPLANE_SUBAGENT, SPECPLANE_ADAPTER (claude or codex) and SPECPLANE_MEASURABLE_RESOURCES (comma separated).
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createMcpServer } from "./mcp.js";

/** Serve the Specplane MCP server on stdio until the harness closes it; used by `specplane mcp` and the plugin entry. */
export async function runMcp(): Promise<void> {
  const root = process.env.SPECPLANE_CHECKOUT ?? process.cwd();
  if (!path.isAbsolute(root)) {
    process.stderr.write("SPECPLANE_CHECKOUT or the working directory must be an absolute path.\n");
    process.exit(2);
  }
  const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;
  const measurable = env("SPECPLANE_MEASURABLE_RESOURCES")?.split(",").map((x) => x.trim()).filter(Boolean);
  // The adapter the harness names opens plan sessions for `plan.start`; unset means the action only starts the plan.
  const adapter = env("SPECPLANE_ADAPTER");
  const launcher = adapter === "claude" ? (await import("./adapter-claude.js")).claudeLauncher
    : adapter === "codex" ? (await import("./adapter-codex.js")).codexLauncher : undefined;
  const server = createMcpServer({
    root,
    id: env("SPECPLANE_SESSION") ?? `mcp-${randomUUID()}`,
    // A session ID given by the adapter is the one its compaction hook reports (`specplane harness compact <session>`), so
    // delivery can be remembered. Without one, instructions are delivered again when unsure (`reference-cli` §12.3).
    reportsContext: env("SPECPLANE_SESSION") !== undefined,
    model: env("SPECPLANE_MODEL"),
    delegatedBy: env("SPECPLANE_DELEGATED_BY"),
    // Factors of the LLM role rules (`roles-and-permissions R44.1`): the provider defaults from the adapter.
    provider: env("SPECPLANE_PROVIDER") ?? (adapter === "claude" ? "anthropic" : adapter === "codex" ? "openai" : undefined),
    agentType: env("SPECPLANE_AGENT_TYPE"),
    subagent: env("SPECPLANE_SUBAGENT"),
    ...(measurable ? { measurable } : {}),
    ...(launcher ? { launcher } : {}),
  });
  await server.serve({ input: process.stdin, write: (line) => process.stdout.write(line) });
}
