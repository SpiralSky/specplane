#!/usr/bin/env node
// Entry of the session server (`architecture/reference-cli` §12.8): `node session-server-main.js <session-id> <project-dir> <parent-pid>
// [--host-version <v>] [--checked-version <v>]`. The only stdout output is the readiness line; diagnostics go to stderr.
import * as fs from "node:fs";
import * as path from "node:path";
import { startSessionServer } from "./session-server.js";

const fail = (message: string, code = 1): never => { process.stderr.write(`specplane session server: ${message}\n`); process.exit(code); };

async function main(): Promise<void> {
  // Only the plugin mod's child starts it: the mod sets SPECPLANE_ACTOR=mod. A shell command of an LLM carries `llm`.
  if (process.env.SPECPLANE_ACTOR !== "mod") fail("refusing to start: SPECPLANE_ACTOR must be exactly `mod`, as the plugin mod sets it for its child.", 2);
  // Every process the server starts (test commands, git) is then marked as an LLM's.
  process.env.SPECPLANE_ACTOR = "llm";
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host-version" || args[i] === "--checked-version") flags[args[i]!] = args[++i] ?? "";
    else positional.push(args[i]!);
  }
  const [session, root, parent] = positional;
  const parentPid = Number(parent);
  if (positional.length !== 3 || !session || !root || !Number.isInteger(parentPid) || parentPid <= 0) fail("usage: session-server-main <session-id> <project-dir> <parent-pid> [--host-version <v>] [--checked-version <v>]", 2);
  if (!path.isAbsolute(root!) || !fs.statSync(root!, { throwIfNoEntry: false })?.isDirectory()) fail("the project directory must be an existing absolute path.", 2);
  process.stdout.on("error", () => { /* a closed stream is not ours to report */ });
  const server = await startSessionServer({ session: session!, root: root!, parentPid, hostVersion: flags["--host-version"] || undefined, checkedVersion: flags["--checked-version"] || undefined });
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void server.stop());
  process.stdout.write(`${JSON.stringify(server.ready)}\n`);
  await server.closed;
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
