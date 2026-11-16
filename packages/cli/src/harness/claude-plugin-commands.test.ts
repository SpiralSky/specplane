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

// ---- the /requests dialogue (claude-integration §3) ----
const rec = (id: string, extra: Record<string, unknown> = {}) => ({ id, state: "pending", from: { role: "spec-writer" }, action: { command: "spec edit" }, reason: `why ${id}`, diff: null, ...extra });
const listOut = (records: unknown[]) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: records }), stderr: "" });
const listOutOne = (record: unknown) => ({ exitCode: 0, stdout: JSON.stringify({ ok: true, data: record }), stderr: "" });
function fakes(records: unknown[], answers: Array<string | Error>, shown: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  const asked: Array<{ q: string; o: unknown }> = [];
  const core = { run: async (argv: string[]) => { calls.push(argv); if (argv.includes("show")) { const id = argv[argv.indexOf("show") + 1]!; return listOutOne(shown[id] ?? (records as Array<{ id: string }>).find(r => r.id === id)); } return argv.includes("--json") ? listOut(records) : { exitCode: 0, stdout: argv.at(-1) === "requests" ? "plain list\n" : `ok ${argv.at(-1)}\n`, stderr: "" }; } };
  const ask = { ask: async (q: string, o: unknown) => { asked.push({ q, o }); const a = answers.shift(); if (a instanceof Error || a === undefined) throw a ?? new Error("none"); return a; } };
  return { calls, asked, core, ask };
}
const requestsCmd = async () => (await load()).SLASH_COMMANDS.find((c: { name: string }) => c.name === "requests");

test("/requests with no arguments opens a dialogue per pending request and runs accept, decline, skip", opts, async () => {
  const m = await load();
  const f = fakes([rec("a1"), rec("b2", { state: "accepted" }), rec("c3"), rec("d4")], ["Go through one by one", "Accept", "Decline", "Skip"]);
  const out = await m.dispatch(await requestsCmd(), "", f.core, undefined, f.ask);
  assert.deepEqual(f.calls[0], ["harness", "run", "--adapter", "claude", "requests", "list", "--json"]);
  assert.deepEqual(f.calls.filter(c => !c.includes("--json")), [["harness", "run", "--adapter", "claude", "requests", "accept", "a1"], ["harness", "run", "--adapter", "claude", "requests", "decline", "c3"]]);
  assert.equal(f.asked.length, 4);
  assert.deepEqual(f.asked[0]!.o, { options: ["Accept all", "Decline all", "Go through one by one"], header: "Requests" });
  assert.deepEqual(f.asked[1]!.o, { options: ["Accept", "Decline", "Skip"], header: "Request" });
  assert.match(f.asked[1]!.q, /spec-writer/); assert.match(f.asked[1]!.q, /spec edit/); assert.match(f.asked[1]!.q, /why a1/);
  assert.match(out.output.text, /ok a1/); assert.match(out.output.text, /ok c3/); assert.match(out.output.text, /Skipped d4/);
});

test("the dialogue includes the diff and truncates a long one", opts, async () => {
  const m = await load();
  const diff = ["-old", "+new", ...Array.from({ length: 80 }, (_, i) => `+l${i}`)].join("\n");
  const f = fakes([rec("a1", { diff })], ["Skip"]);
  await m.dispatch(await requestsCmd(), "", f.core, undefined, f.ask);
  const q = f.asked[0]!.q;
  assert.match(q, /^-old$/m); assert.match(q, /^\+new$/m);
  assert.match(q, /\.\.\. 22 more lines; see `specplane requests show a1`/);
  assert.doesNotMatch(q, /l79/);
});

test("no pending requests prints the empty message and asks nothing", opts, async () => {
  const m = await load();
  const f = fakes([rec("a1", { state: "declined" })], []);
  const out = await m.dispatch(await requestsCmd(), "", f.core, undefined, f.ask);
  assert.equal(out.output.text, "No requests waiting."); assert.equal(f.asked.length, 0);
});

test("a rejected or unexpected answer falls back to the text list and the answer line", opts, async () => {
  const m = await load();
  for (const a of [new Error("dismissed"), "something else"]) {
    const f = fakes([rec("a1"), rec("b2")], [a]);
    const out = await m.dispatch(await requestsCmd(), "", f.core, undefined, f.ask);
    assert.equal(out.output.text, "plain list\nAnswer with /requests accept <id> or /requests decline <id>.");
    assert.equal(f.asked.length, 1);
  }
});

test("/requests with arguments keeps the text behaviour and opens no dialogue", opts, async () => {
  const m = await load();
  const f = fakes([rec("a1")], ["Accept"]);
  const out = await m.dispatch(await requestsCmd(), "accept a1", f.core, undefined, f.ask);
  assert.deepEqual(f.calls, [["harness", "run", "--adapter", "claude", "requests", "accept", "a1"]]);
  assert.equal(out.output.text, "ok a1"); assert.equal(f.asked.length, 0);
});

test("/requests shows the recomputed diff and a visible warning when the current diff is unavailable", opts, async () => {
  const m = await load();
  const f = fakes([rec("a1", { diff: "-stale\n+stale" }), rec("b2", { diff: "-stale" })], ["Go through one by one", "Skip", "Skip"], {
    a1: rec("a1", { diff: "-fresh\n+fresh" }),
    b2: rec("b2", { diff: null, warning: "Current diff unavailable: the proposed patch no longer applies." }),
  });
  await m.dispatch(await requestsCmd(), "", f.core, undefined, f.ask);
  assert.match(f.asked[1]!.q, /^-fresh$/m); assert.doesNotMatch(f.asked[1]!.q, /stale/);
  assert.match(f.asked[2]!.q, /^Warning: Current diff unavailable: the proposed patch no longer applies\.$/m);
});

test("a dismissed second dialogue keeps the first answer before the fallback list", opts, async () => {
  const m = await load();
  const f = fakes([rec("a1"), rec("b2")], ["Go through one by one", "Accept", new Error("dismissed")]);
  const out = await m.dispatch(await requestsCmd(), "", f.core, undefined, f.ask);
  assert.equal(out.output.text, "ok a1\nplain list\nAnswer with /requests accept <id> or /requests decline <id>.");
});

test("the result line drops the warning count, strips control characters and keeps stdout and stderr apart", opts, async () => {
  const m = await load();
  const core = { run: async () => ({ exitCode: 0, stdout: "Accepted r1.\u001b[31m red\u0007\n3 warnings; run `specplane warnings`\n", stderr: "warning: x\n" }) };
  const out = await m.runDialogue([rec("r1")], { ask: async () => "Accept" }, core);
  assert.deepEqual(out, { lines: ["Accepted r1. red\nwarning: x"], done: true });
  const only = await m.runDialogue([rec("r1")], { ask: async () => "Decline" }, { run: async () => ({ exitCode: 0, stdout: "0 warnings\n", stderr: "" }) });
  assert.deepEqual(only.lines, ["Decline r1: done."]);
});

test("bulk dialogue: Accept all, Decline all, one by one, single pending, one failure, deduplicated note", opts, async () => {
  const m = await load();
  const cmd = await requestsCmd();
  const note = "Commit it to apply:\ngit add x.md && git commit -m y";
  // Accept all of two: one list dialogue, each accepted, the note once.
  const calls: string[][] = [];
  const core = { run: async (argv: string[]) => { calls.push(argv); if (argv.includes("show") || argv.includes("--json")) return argv.includes("show") ? listOutOne(rec(argv.at(-2)!, argv.at(-2) === "b2" ? { diff: "-a\n+b" } : {})) : listOut([rec("a1"), rec("b2", { diff: "-a\n+b" })]); const id = argv.at(-1)!; return id === "c3" ? { exitCode: 1, stdout: "", stderr: "c3 could not be done: nope\n" } : { exitCode: 0, stdout: `Accepted ${id}.\n${note}\n`, stderr: "" }; } };
  const asked: Array<{ q: string; o: unknown }> = [];
  const mk = (answers: string[]) => ({ ask: async (q: string, o: unknown) => { asked.push({ q, o }); return answers.shift()!; } });
  const out = await m.dispatch(cmd, "", core, undefined, mk(["Accept all"]));
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0]!.o, { options: ["Accept all", "Decline all", "Go through one by one"], header: "Requests" });
  assert.match(asked[0]!.q, /- a1: spec edit from spec-writer\n- b2: spec edit from spec-writer \(spec change; diff in one-by-one\)/);
  assert.deepEqual(calls.filter(c => !c.includes("--json")).map(c => c.slice(-2)), [["accept", "a1"], ["accept", "b2"]]);
  assert.equal(out.output.text.split("Not yet in effect: commit to apply.").length - 1, 1);
  assert.match(out.output.text, /Accepted a1\.[\s\S]*Accepted b2\./);
  // Decline all.
  const f = fakes([rec("a1"), rec("b2")], ["Decline all"]);
  const d = await m.dispatch(cmd, "", f.core, undefined, f.ask);
  assert.deepEqual(f.calls.filter(c => !c.includes("--json")).map(c => c.slice(-2)), [["decline", "a1"], ["decline", "b2"]]);
  assert.equal(d.output.text, "ok a1\nok b2");
  // One by one runs the per-request dialogue.
  const g = fakes([rec("a1"), rec("b2")], ["Go through one by one", "Skip", "Skip"]);
  const o = await m.dispatch(cmd, "", g.core, undefined, g.ask);
  assert.equal(g.asked.length, 3); assert.match(o.output.text, /Skipped a1/);
  // A single pending request skips the list dialogue.
  const h = fakes([rec("a1")], ["Accept"]);
  await m.dispatch(cmd, "", h.core, undefined, h.ask);
  assert.equal(h.asked.length, 1); assert.deepEqual(h.asked[0]!.o, { options: ["Accept", "Decline", "Skip"], header: "Request" });
  // One failure does not stop the others and its reason is listed.
  const calls2: string[][] = [];
  const core2 = { run: async (argv: string[]) => { calls2.push(argv); const id = argv.at(-1)!; return id === "a1" ? { exitCode: 1, stdout: "", stderr: "a1 could not be done: nope\n" } : { exitCode: 0, stdout: `Accepted ${id}.\n`, stderr: "" }; } };
  const r = await m.runBulkDialogue([rec("a1"), rec("b2")], { ask: async () => "Accept all" }, core2);
  assert.equal(calls2.length, 2); assert.deepEqual(r, { lines: ["a1 could not be done: nope", "Accepted b2."], done: true });
});
