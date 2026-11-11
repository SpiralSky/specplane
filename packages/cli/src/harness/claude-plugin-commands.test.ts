/**
 * Offline coverage for the Claude Code plugin's slash-command dispatch (`claude-integration` §3, `reference-cli` §12.2).
 * The plugin source is TypeScript under harnesses/claude/plugin/hooks, so Bun loads it; the Node fallback skips this
 * file. The core arrives as a fake port, so no test starts the CLI or Claude Code.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { COMMANDS } from "./instructions.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const opts = { skip: hasBun ? false : "loads TypeScript source; run with Bun" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = async (): Promise<any> => import(pathToFileURL(path.join(repo, "harnesses/claude/plugin/hooks/commands.ts")).href);

test("every harness command has exactly one slash command", opts, async () => {
  const m = await load();
  assert.deepEqual(m.SLASH_COMMANDS.map((c: { name: string }) => c.name).sort(), [...COMMANDS].sort());
});

test("splitArgs keeps quoted text together", opts, async () => {
  const m = await load();
  assert.deepEqual(m.splitArgs(`a "b c" 'd e'  f`), ["a", "b c", "d e", "f"]);
  assert.deepEqual(m.splitArgs(""), []);
});

test("a model command with arguments is handed to its skill, and no core call is made", opts, async () => {
  const m = await load();
  const calls: string[][] = [];
  const core = { run: async (argv: string[]) => { calls.push(argv); return { exitCode: 0, stdout: "", stderr: "" }; } };
  const cmd = m.SLASH_COMMANDS.find((c: { name: string }) => c.name === "spec-assist");
  const out = await m.dispatch(cmd, `"add a login spec"`, core);
  assert.equal(out.prompt, `Use the specplane-spec-assist skill. Arguments: ["add a login spec"]`);
  assert.deepEqual(calls, []);
});

test("a command without arguments runs through the user-command runner with no prompt", opts, async () => {
  const m = await load();
  const calls: string[][] = [];
  const core = { run: async (argv: string[]) => { calls.push(argv); return { exitCode: 0, stdout: "No plans.\n", stderr: "" }; } };
  for (const name of ["spec-assist", "plan-status"]) {
    const out = await m.dispatch(m.SLASH_COMMANDS.find((c: { name: string }) => c.name === name), "", core);
    assert.equal(out.prompt, undefined);
    assert.equal(out.output.text, "No plans.");
  }
  assert.deepEqual(calls[0], ["harness", "run", "--adapter", "claude", "spec-assist"]);
});

test("a failing core and a refused command report their exit code and text", opts, async () => {
  const m = await load();
  const cmd = m.SLASH_COMMANDS.find((c: { name: string }) => c.name === "approve");
  const refused = await m.dispatch(cmd, "x", { run: async () => ({ exitCode: 2, stdout: "", stderr: "denied\n" }) });
  assert.deepEqual(refused.output, { text: "denied", exitCode: 2 });
  const broken = await m.dispatch(cmd, "x", { run: async () => { throw new Error("no node"); } });
  assert.equal(broken.output.exitCode, 1);
  assert.match(broken.output.text, /could not run the Specplane core: no node/);
});

test("the commands the plugin hands to the assistant are the ones the runner passes on", opts, async () => {
  const { runHarnessCommand } = await import("./run.js");
  const m = await load();
  for (const c of m.SLASH_COMMANDS.filter((x: { modelWithArgs: boolean }) => x.modelWithArgs)) {
    const r = await runHarnessCommand(c.name, ["x"], repo);
    assert.ok((r.data as { passToLlm?: unknown })?.passToLlm, `${c.name} should pass its arguments to the assistant`);
  }
});
