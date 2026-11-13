import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { makeRepo, spec } from "../test-repo.js";
import { DEFAULT_PRESET, type Mode } from "../perm/permissions.js";
import { readAudit } from "../audit/read.js";
import { acceptRequest } from "../requests/ops.js";
import { listRequests, readRequest } from "../requests/store.js";
import { approvePlan } from "../plan/create.js";
import { loadPlanAt } from "../plan/ctx.js";
import { PreconditionError } from "../errors.js";
import { createActionRuntime, listActions } from "./actions.js";

const arch = "docs/specifications/architecture/arch.md";
const archText = spec({ id: "architecture/arch", title: "Arch", authors: [] },
  "# Arch\n\n## R1: One\n\nTest T1 (deterministic): runs.\n\n```specplane-test\nrun: [\"true\"]\n```\n\nTest T2 (intelligent): reads well.\n");
const arch2 = "docs/specifications/architecture/arch2.md";
const arch2Text = spec({ id: "architecture/arch2", title: "Arch2", authors: [] }, "# Arch2\n\nTest T1 (deterministic): runs.\n\n```specplane-test\nrun: [\"true\"]\n```\n");
const PLAN = "2026-11-11-some-plan";
function repo(config = ""): string {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-actions-wt-"));
  const root = makeRepo({ ".specplane/config.yaml": `auto_warn: false\narchitecture:\n  llm_may_mark_implemented: true\nplans:\n  dir: plans\n  worktree_dir: ${wt}\n${config}`, [arch]: archText, [arch2]: arch2Text });
  for (const args of [["init", "-q", "-b", "main"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"]]) run("git", args, { cwd: root });
  return root;
}
const runtime = (root: string, extra: Record<string, unknown> = {}) => createActionRuntime({ root, id: "agent-session", reportsContext: false, model: "reported-model", now: new Date("2026-11-11T12:00:00Z"), ...extra });
const human = (root: string) => ({ root, actor: { role: "standard-user" as const, kind: "human" as const, name: "Test" }, preset: DEFAULT_PRESET, now: new Date("2026-11-11T12:00:00Z") });
const passed = { test: "R1#T1", spec: "architecture/arch", kind: "deterministic", outcome: "passed", summary: "ran" };

const inputs: Record<string, Record<string, unknown>> = {
  "spec.implement": { spec: "architecture/arch2" }, "test.run": { spec: "architecture/arch" }, "test.record": { results: [passed] },
  "config.set": { key: "auto_warn", value: "false" }, "docs.search": { query: "spec" },
  "request.send": { command: "spec approve", params: { ids: ["architecture/arch"] }, reason: "Please approve" },
  "plan.create": { words: ["some", "plan"] }, "plan.edit": { id: PLAN, changes: [{ path: "PLAN.md", before: "a", after: "b" }] },
  "plan.list": {}, "plan.next": { id: PLAN }, "plan.step-done": { id: PLAN, step: 1, outcome: "done" },
  "plan.softstop": { id: PLAN }, "plan.start": { id: PLAN }, "plan.resume": { id: PLAN }, "plan.abandon": { id: PLAN }, "plan.delete": { id: PLAN },
  "plan.budget": { id: PLAN, resource: "tokens", soft: 80, hard: 90 }, "plan.review": { id: PLAN }, "plan.finish": { id: PLAN, complete: true }, "plan.merge": { id: PLAN, mode: "local" },
};
const added = listActions().filter((a) => a.id in inputs);

test("the remaining 20 actions are registered with strict schemas", () => {
  assert.equal(added.length, 20);
  assert.equal(listActions().length, 43);
  assert.equal(added.filter((a) => a.id.startsWith("plan.")).length, 14);
  for (const a of listActions()) assert.equal((a.inputSchema as { additionalProperties: boolean }).additionalProperties, false, a.id);
});

for (const action of added) for (const mode of ["allow", "request-user", "deny"] as Mode[]) {
  test(`${action.id}: ${mode} uses the in-process LLM permission`, async () => {
    const root = repo();
    const input = inputs[action.id];
    const permissions = action.permissions(input);
    const prior = DEFAULT_PRESET.llm.modes;
    DEFAULT_PRESET.llm.modes = { ...prior, ...Object.fromEntries(permissions.map((p) => [p, mode])) };
    try {
      const r = await runtime(root).call(action.id, input);
      if (!permissions.length) {
        assert.ok(!/permission/.test(r.findings.join()), r.findings.join());
        if (action.id === "docs.search" || action.id === "request.send") assert.equal(r.ok, true, r.findings.join());
        if (action.id === "request.send") assert.ok(r.request);
      } else if (mode === "deny") {
        assert.equal(r.ok, false);
        assert.match(r.findings.join(), /permission/);
        assert.equal(listRequests(root).length, 0);
      } else if (mode === "request-user") {
        if (action.id === "spec.implement") { assert.equal(r.ok, false); assert.match(r.findings.join(), /allow/); assert.equal(listRequests(root).length, 0); }
        else { assert.equal(r.ok, true, r.findings.join()); assert.ok(r.request); assert.ok(readRequest(root, r.request)); }
      } else {
        assert.equal(listRequests(root).length, 0);
        assert.ok(!/permission/.test(r.findings.join()), r.findings.join());
        // Fixtures exist for these; the plan actions refuse because no such plan exists, which still proves the guard passed.
        if (["spec.implement", "test.run", "test.record", "config.set", "plan.list"].includes(action.id)) assert.equal(r.ok, true, r.findings.join());
        else if (action.id.startsWith("plan.") && action.id !== "plan.create") assert.equal(r.ok, false);
      }
      if (permissions.length) assert.match(r.instructions.map((x) => x.text).join(), /Do not bypass/);
      const log = readAudit(root, {});
      assert.ok(JSON.stringify(log).includes(`"${action.id}"`), "the call is audited");
    } finally { DEFAULT_PRESET.llm.modes = prior; }
  });
}

test("held reads and writes replay once under the human request runner", async () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "info.retrieve": "request-user", "test.record": "request-user", "config.change": "request-user", "plan.create": "request-user" };
  try {
    for (const id of ["test.run", "plan.list", "test.record", "config.set", "plan.create"]) {
      const r = await runtime(root).call(id, inputs[id]);
      assert.ok(r.request, `${id}: ${r.findings.join()}`);
    }
    assert.equal(fs.existsSync(path.join(root, `plans/${PLAN}`)), false);
    // Accepting a plan change commits, so the result recording (bound to the tested HEAD) goes first.
    for (const rec of listRequests(root).sort((a, b) => Number(b.action.command === "test record") - Number(a.action.command === "test record"))) {
      const first = await acceptRequest(human(root), rec.id);
      assert.equal(first.ok, true, `${rec.action.command}: ${first.reasons.join()}`);
      assert.equal((await acceptRequest(human(root), rec.id)).ok, false, "execute only once");
    }
    assert.ok(loadPlanAt(root, PLAN), "plan.create ran on acceptance");
    assert.match(fs.readFileSync(path.join(root, ".specplane/config.yaml"), "utf8"), /auto_warn: false/);
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("plan actions run a plan under allow: create, list, next, start, budget, soft stop, resume, abandon", async () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "plan.create": "allow", "plan.start": "allow", "plan.budget": "allow", "plan.softstop": "allow", "plan.resume": "allow", "plan.abandon": "allow" };
  try {
    const rt = runtime(root, { measurable: ["tokens"] });
    const created = await rt.call("plan.create", { words: ["some", "plan"] });
    assert.equal(created.ok, true, created.findings.join());
    approvePlan({ ...human(root) }, PLAN);
    const next = await rt.call("plan.next", { id: PLAN });
    assert.equal(next.ok, true, next.findings.join());
    assert.equal((await rt.call("plan.budget", { id: PLAN, resource: "weekly", soft: 80, hard: 90 })).ok, false, "unmeasurable resources are refused");
    assert.equal((await rt.call("plan.start", { id: PLAN })).ok, true);
    assert.equal((await rt.call("plan.budget", { id: PLAN, resource: "tokens", soft: 80, hard: 90 })).ok, true);
    const stopped = await rt.call("plan.softstop", { id: PLAN, reason: "pause" });
    assert.equal(stopped.ok, true, stopped.findings.join());
    assert.equal((await rt.call("plan.resume", { id: PLAN })).ok, true);
    assert.equal((await rt.call("plan.finish", { id: PLAN })).ok, false, "finish needs exactly one decision");
    assert.equal((await rt.call("plan.abandon", { id: PLAN })).ok, true);
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("test.record intelligent verdicts record the LLM identity; unknown tests are refused", async () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "test.record": "allow" };
  try {
    const ok = await runtime(root).call("test.record", { results: [{ ...passed, test: "R1#T2", kind: "intelligent" }] });
    assert.equal(ok.ok, true, ok.findings.join());
    assert.equal((await runtime(root).call("test.record", { results: [{ ...passed, test: "R9#T1" }] })).ok, false);
    assert.equal((await runtime(root).call("test.record", { results: [{ ...passed, status: "approved" }] })).ok, false, "unknown fields are rejected");
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("docs.essentials returns the packaged essentials and needs no permission", async () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "info.retrieve": "deny" };
  try {
    const r = await runtime(root).call("docs.essentials", {});
    assert.equal(r.ok, true, r.findings.join());
    const text = (r.data as { essentials: string }).essentials;
    assert.ok(text.length > 100 && Buffer.byteLength(text) <= 8192);
    assert.ok(text.includes("docs.search"));
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("plan.start opens the plan's session through the adapter, and reports a refusal as an error after the plan started", async () => {
  const opened: { sessionId: string; resume: boolean }[] = [];
  const launcher = { name: "fake", newSessionId: () => "fake-session-1", open: (_c: unknown, _id: string, o: { sessionId: string; resume: boolean }) => { opened.push(o); return ["Opened fake-session-1."]; } };
  const refusing = { ...launcher, newSessionId: () => "fake-session-2", open: () => { throw new PreconditionError(["No host here; open it yourself."]); } };
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "plan.create": "allow", "plan.start": "allow" };
  try {
    const root = repo();
    await runtime(root).call("plan.create", { words: ["some", "plan"] });
    approvePlan({ ...human(root) }, PLAN);
    const r = await runtime(root, { launcher }).call("plan.start", { id: PLAN });
    assert.equal(r.ok, true, r.findings.join());
    assert.deepEqual(opened, [{ sessionId: "fake-session-1", resume: false }]);
    assert.equal((r.data as { session: string }).session, "fake-session-1");

    const root2 = repo();
    await runtime(root2).call("plan.create", { words: ["some", "plan"] });
    approvePlan({ ...human(root2) }, PLAN);
    const failed = await runtime(root2, { launcher: refusing }).call("plan.start", { id: PLAN });
    assert.equal(failed.ok, false);
    assert.match(failed.findings.join(), /open it yourself/);
    assert.match(String(run("git", ["branch", "--list", `plan/${PLAN}`], { cwd: root2 })), new RegExp(`plan/${PLAN}`), "the plan itself started before the launch was refused");
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});
