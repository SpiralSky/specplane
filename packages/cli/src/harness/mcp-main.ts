#!/usr/bin/env node
// Entry of the Specplane MCP server: `node <package>/dist/harness/mcp-main.js` (`architecture/reference-cli` §12.1).
// The harness adapter starts it with the session it belongs to. The checkout is SPECPLANE_CHECKOUT, else the working
// directory. Identity comes only from the adapter's environment, never from tool input: SPECPLANE_SESSION,
// SPECPLANE_MODEL, SPECPLANE_DELEGATED_BY and SPECPLANE_MEASURABLE_RESOURCES (comma separated).
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createMcpServer } from "./mcp.js";

const root = process.env.SPECPLANE_CHECKOUT ?? process.cwd();
if (!path.isAbsolute(root)) {
  process.stderr.write("SPECPLANE_CHECKOUT or the working directory must be an absolute path.\n");
  process.exit(2);
}
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;
const measurable = env("SPECPLANE_MEASURABLE_RESOURCES")?.split(",").map((x) => x.trim()).filter(Boolean);
const server = createMcpServer({
  root,
  id: env("SPECPLANE_SESSION") ?? `mcp-${randomUUID()}`,
  // Without an adapter that reports compaction, instructions are delivered again when unsure (`reference-cli` §12.3).
  reportsContext: false,
  model: env("SPECPLANE_MODEL"),
  delegatedBy: env("SPECPLANE_DELEGATED_BY"),
  ...(measurable ? { measurable } : {}),
});
await server.serve({ input: process.stdin, write: (line) => process.stdout.write(line) });
