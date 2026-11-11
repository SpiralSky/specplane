#!/usr/bin/env node
// Stand-alone entry of the Specplane MCP server: `node <package>/dist/harness/mcp-main.js`; same as `specplane mcp`.
import { runMcp } from "./mcp-run.js";

await runMcp();
