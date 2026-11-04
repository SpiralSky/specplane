import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULT_CONFIG } from "../config.js";
import type { SessionAdapter, SessionCapabilities, SessionRequest, SessionState } from "../core/contracts.js";
import { sessionIdFor } from "./session-identity.js";
import type { PlanNext } from "./next.js";
import { runPlan, runPlans, type ConductorDependencies, type RunDependencies } from "./run.js";

const id = "2026-11-01-test-plan";
function temp(t: TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-run-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function ready(root: string, plan = id): PlanNext {
  return { plan, title: "Test", effectiveStatus: "in_progress", step: { number: 1, title: "One", status: "pending", file: "steps/01.md" }, context: [], checkout: root, blocked: [], openGaps: [], warnings: [], attention: [], action: "spawn_step", reason: "Ready" };
}
function finished(n: PlanNext): PlanNext {
  return { ...n, step: null, attention: [{ kind: "finish_ready", message: "Ready for human review" }], action: "finish", reason: "Ready for human review" };
}
type State = SessionState["state"];
interface Fake extends SessionAdapter { calls: string[]; requests: SessionRequest[]; caps: SessionCapabilities; }
function fake(onLaunch: (r: SessionRequest) => void = () => {}, observe: () => State = () => "completed", caps: Partial<SessionCapabilities> = {}): Fake {
  const calls: string[] = []; const requests: SessionRequest[] = [];
  const capabilities: SessionCapabilities = { host: "fake", surface: "test", backends: ["worktree"], launch: true, observe: true, resume: true, cancel: true, budgetEnforcement: true, ...caps };
  return {
    name: "fake", calls, requests, caps: capabilities,
    async probe() { calls.push("probe"); return capabilities; },
    async launch(r) { calls.push("launch"); requests.push(r); onLaunch(r); return { orchestrationId: r.orchestrationId, pid: 123, state: "running" }; },
    async observe(ref) { calls.push("observe"); return { orchestrationId: ref.orchestrationId, state: observe() }; },
    async resume(ref, r) { calls.push("resume"); requests.push(r); onLaunch(r); return { orchestrationId: ref.orchestrationId, state: "running" }; },
    async recovery(ref) { calls.push("recovery"); return { available: true, instructions: [["fake", "attach", ref.orchestrationId]] }; },
    async cancel() { calls.push("cancel"); return { stopped: true, recoveryRequired: false }; },
  };
}
function deps(root: string, next: () => PlanNext, adapter: SessionAdapter): ConductorDependencies {
  return { next, adapter, halfFinished: () => false, stateDir: path.join(root, "runtime") };
}

test("conductor: fake successful step advances to human finish without finalizing", async t => {
  const root = temp(t); let n = ready(root); const requests: SessionRequest[] = [];
  const adapter = fake(r => { requests.push(r); n = finished(n); });
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, adapter));
  assert.equal(result.code, 0); assert.equal(result.action, "finish_ready"); assert.equal(result.steps, 1);
  assert.equal(requests.length, 1); assert.equal(requests[0].mode, "unattended"); assert.equal(requests[0].workflowRequestPath.startsWith(path.join(root, "runtime")), true);
  assert.equal(n.effectiveStatus, "in_progress");
  assert.equal(fs.readdirSync(path.join(root, "runtime")).some(f => f.endsWith(".lock")), false);
});

test("conductor: unchanged step is never retried automatically", async t => {
  const root = temp(t); const n = ready(root); let launches = 0;
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { maxSteps: 3 }, deps(root, () => n, fake(() => launches++)));
  assert.equal(result.code, 5); assert.match(result.reason, /without advancing/); assert.equal(launches, 1);
});

test("conductor: blocked, gap, dirty and divergence stop before spawning", async t => {
  const root = temp(t);
  for (const kind of ["blocked", "gap_decision", "dirty", "diverged"] as const) {
    const n = { ...ready(root), attention: [{ kind, message: kind }], action: "ask_human" as const, reason: kind };
    let launches = 0;
    const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, fake(() => launches++)));
    assert.equal(result.code, ["dirty", "diverged"].includes(kind) ? 5 : 2); assert.equal(launches, 0);
  }
});

test("conductor: initially blocked plan emits its selected harness alert", async t => {
  const root = temp(t); const config = structuredClone(DEFAULT_CONFIG); config.execution.notify.transport = "harness";
  const n = { ...ready(root), attention: [{ kind: "blocked" as const, message: "Decision needed" }], action: "ask_human" as const, reason: "Decision needed" };
  const messages: string[] = []; const adapter = fake(); adapter.notify = m => messages.push(m);
  const result = await runPlan(id, config, root, {}, deps(root, () => n, adapter));
  assert.equal(result.code, 2); assert.equal(messages.length, 1); assert.match(messages[0], /Decision needed/);
});

test("conductor: interruption leaves a running session alone", async t => {
  const root = temp(t); const n = ready(root); const abort = new AbortController(); let launches = 0;
  const adapter = fake(() => launches++, () => "running");
  const d = deps(root, () => n, adapter); d.sleep = async () => { abort.abort(); };
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { signal: abort.signal }, d);
  assert.equal(result.code, 4); assert.match(result.reason, /left running/); assert.equal(launches, 1);
  assert.equal(adapter.calls.includes("cancel"), false, "interrupting observation never stops the session");
  assert.equal(fs.readdirSync(path.join(root, "runtime")).some(f => f.endsWith(".session.json")), true, "the running session stays recorded");
});

test("conductor: dry-run makes no runtime files and never spawns", async t => {
  const root = temp(t); const n = ready(root); let launches = 0;
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { dryRun: true }, deps(root, () => n, fake(() => launches++)));
  assert.equal(result.action, "dry_run"); assert.equal(launches, 0); assert.deepEqual(fs.readdirSync(root), []);
});

test("conductor: distinct plans honor parallel bound and duplicate IDs fail before launch", async t => {
  const root = temp(t); let active = 0, peak = 0, launches = 0;
  const ids = ["2026-11-01-first", "2026-11-01-second", "2026-11-01-third"];
  const plans = new Map<string, { n: PlanNext }>(ids.map(plan => [plan, { n: ready(root, plan) }]));
  const adapter = fake(r => { active++; launches++; peak = Math.max(peak, active); }, () => "running");
  const slots = new Map<string, boolean>();
  adapter.observe = async ref => ({ orchestrationId: ref.orchestrationId, state: slots.get(ref.orchestrationId) ? "completed" : "running" });
  const factory = (plan: string): RunDependencies => ({
    next: () => plans.get(plan)!.n, halfFinished: () => false, stateDir: path.join(root, "runtime"),
    sleep: async () => { await new Promise(r => setTimeout(r, 5)); slots.set(sessionIdFor(plan, 1), true); active--; plans.get(plan)!.n = finished(plans.get(plan)!.n); },
  });
  const results = await runPlans(ids, structuredClone(DEFAULT_CONFIG), root, { maxParallel: 2 }, adapter, factory);
  assert.deepEqual(results.map(r => r.code), [0, 0, 0]); assert.equal(peak, 2); assert.equal(launches, 3);
  await assert.rejects(runPlans([id, id], structuredClone(DEFAULT_CONFIG), root, {}, adapter, factory), /distinct/);
  assert.equal(launches, 3);
});

test("conductor: reserves bounded session budgets and refuses unsupported enforcement", async t => {
  const root = temp(t); let n = ready(root); const budgets: (number | null | undefined)[] = [];
  const adapter = fake(r => { budgets.push(r.budgetUsd); n = n.step!.number === 1 ? { ...n, step: { ...n.step!, number: 2 } } : finished(n); });
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { maxSteps: 2, maxBudgetUsd: 1 }, deps(root, () => n, adapter));
  assert.equal(result.code, 0); assert.deepEqual(budgets, [0.5, 0.5]); assert.equal(result.reservedBudgetUsd, 1);
  let launches = 0; const unsupported = fake(() => launches++, undefined, { budgetEnforcement: false });
  const denied = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { maxBudgetUsd: 1 }, deps(root, () => ready(root), unsupported));
  assert.equal(denied.code, 5); assert.equal(launches, 0); assert.equal(denied.reservedBudgetUsd, 0);
});

test("conductor: concurrent invocation of one plan refuses a duplicate session", async t => {
  const root = temp(t); let n = ready(root), complete = false, launches = 0;
  let release!: () => void;
  const paused = new Promise<void>(r => { release = r; });
  const adapter = fake(() => launches++, () => complete ? "completed" : "running");
  const d = { ...deps(root, () => n, adapter), sleep: async () => { await paused; complete = true; n = finished(n); } };
  const first = runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, d);
  while (launches < 1) await new Promise(r => setTimeout(r, 1));
  const second = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, d);
  assert.equal(second.code, 3); assert.equal(launches, 1);
  release(); assert.equal((await first).code, 0); assert.equal(launches, 1);
});

test("conductor: uncertain launch outcomes retain their attempted budget reservation", async t => {
  const root = temp(t); const n = ready(root);
  const adapter = fake(() => { throw new Error("Launch outcome unknown"); });
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { maxBudgetUsd: 1 }, deps(root, () => n, adapter));
  assert.equal(result.code, 5); assert.match(result.reason, /Launch outcome unknown/);
  assert.equal(result.reservedBudgetUsd, 1);
});

test("conductor: initially blocked dry-run never writes alert cache", async t => {
  const root = temp(t); const config = structuredClone(DEFAULT_CONFIG); config.execution.notify.transport = "harness";
  const n = { ...ready(root), attention: [{ kind: "blocked" as const, message: "Blocked" }], action: "ask_human" as const, reason: "Blocked" };
  let notifications = 0; const adapter = fake(); adapter.notify = () => notifications++;
  const result = await runPlan(id, config, root, { dryRun: true }, deps(root, () => n, adapter));
  assert.equal(result.code, 2); assert.equal(notifications, 0); assert.deepEqual(fs.readdirSync(root), []);
});

test("conductor: orchestration identity is deterministic per plan and step, and a mismatched identity is refused", async t => {
  const root = temp(t); let n = ready(root);
  const adapter = fake(() => { n = finished(n); });
  assert.equal((await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, adapter))).code, 0);
  assert.equal(adapter.requests[0].orchestrationId, sessionIdFor(id, 1));
  assert.equal(adapter.requests[0].plan, id); assert.equal(adapter.requests[0].step, 1);
  assert.match(adapter.requests[0].requestId, /^[0-9a-f-]{36}$/);
  const raw = JSON.parse(fs.readFileSync(adapter.requests[0].workflowRequestPath, "utf8"));
  assert.deepEqual([raw.workflow, raw.plan, raw.step, raw.mode], ["plan-step", id, 1, "unattended"]);
  const other = fake(); other.launch = async r => ({ orchestrationId: `${r.orchestrationId}x`, state: "running" });
  const refused = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => ready(root), other));
  assert.equal(refused.code, 5); assert.match(refused.reason, /unexpected session identity/);
});

test("conductor: an uncertain launch leaves a record, and the next run refuses instead of launching a duplicate", async t => {
  const root = temp(t); const n = ready(root);
  const throwing = fake(() => { throw new Error("Launch outcome unknown"); });
  const first = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, throwing));
  assert.equal(first.code, 5); assert.equal(first.steps, 1);
  const unobservable = fake(undefined, () => "unknown");
  const second = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, unobservable));
  assert.equal(second.code, 5); assert.match(second.reason, /not proof of absence/);
  assert.equal(unobservable.calls.includes("launch"), false); assert.equal(unobservable.calls.includes("resume"), false);
  assert.deepEqual(second.commands, [["fake", "attach", sessionIdFor(id, 1)]], "recovery instructions are reported");
  const running = fake(undefined, () => "running");
  assert.equal((await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, running))).code, 3);
  assert.equal(running.calls.includes("launch"), false);
});

test("conductor: a failed prior session is resumed under the same identity, only when the adapter can resume", async t => {
  const root = temp(t); let n = ready(root);
  const first = fake(() => { throw new Error("Launch outcome unknown"); });
  await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, first));
  const cannot = fake(undefined, () => "failed", { resume: false });
  const denied = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, cannot));
  assert.equal(denied.code, 5); assert.match(denied.reason, /cannot resume/);
  assert.equal(cannot.calls.includes("resume"), false);
  let state: State = "failed";
  const adapter = fake(() => { n = finished(n); state = "completed"; }, () => state);
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, adapter));
  assert.equal(result.code, 0, result.reason); assert.equal(result.action, "finish_ready");
  assert.equal(adapter.calls.includes("resume"), true); assert.equal(adapter.calls.includes("launch"), false);
  assert.equal(adapter.requests[0].orchestrationId, sessionIdFor(id, 1));
});

test("conductor: failed or unknown observation never counts as completion", async t => {
  for (const state of ["failed", "unknown"] as const) {
    const root = temp(t); const n = ready(root);
    const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, fake(undefined, () => state)));
    assert.equal(result.code, 5); assert.match(result.reason, /no completion inferred/);
  }
  const root = temp(t); const n = ready(root);
  const completedButUnchanged = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, {}, deps(root, () => n, fake()));
  assert.match(completedButUnchanged.reason, /without advancing/, "completed is accepted only after core verification of the plan state");
});

test("conductor: step, observation-time and capability limits stop the run without approving or merging", async t => {
  const root = temp(t); let n = ready(root);
  const adapter = fake(() => { n = { ...n, step: { ...n.step!, number: n.step!.number + 1 } }; });
  const limited = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { maxSteps: 1 }, deps(root, () => n, adapter));
  assert.equal(limited.code, 4); assert.equal(limited.action, "limit"); assert.equal(adapter.requests.length, 1);
  const timed = temp(t); let clock = 0;
  const slow = fake(undefined, () => "running");
  const d = deps(timed, () => ready(timed), slow); d.now = () => clock; d.sleep = async () => { clock += 10_000; };
  const timeout = await runPlan(id, structuredClone(DEFAULT_CONFIG), timed, { timeoutSeconds: 5 }, d);
  assert.equal(timeout.code, 4); assert.match(timeout.reason, /left running/); assert.equal(slow.calls.includes("cancel"), false);
  for (const caps of [{ backends: ["branch"] }, { launch: false }, { observe: false }] as const) {
    const bad = fake(undefined, undefined, caps as Partial<SessionCapabilities>); const r = temp(t);
    const denied = await runPlan(id, structuredClone(DEFAULT_CONFIG), r, {}, deps(r, () => ready(r), bad));
    assert.equal(denied.code, 5); assert.equal(bad.requests.length, 0);
  }
});

test("conductor: cancellation before launch starts nothing, and an aborted signal reaches the adapter request", async t => {
  const root = temp(t); const abort = new AbortController(); abort.abort();
  const adapter = fake();
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { signal: abort.signal }, deps(root, () => ready(root), adapter));
  assert.equal(result.code, 4); assert.equal(adapter.requests.length, 0);
  const live = new AbortController(); const r2 = temp(t); let n = ready(r2);
  const a2 = fake(() => { n = finished(n); });
  await runPlan(id, structuredClone(DEFAULT_CONFIG), r2, { signal: live.signal }, deps(r2, () => n, a2));
  assert.equal(a2.requests[0].signal, live.signal);
});

test("conductor: finish-ready and stop-at-finish never call approval, finish or merge operations", async t => {
  const root = temp(t); let n = ready(root);
  const adapter = fake(() => { n = finished(n); });
  const result = await runPlan(id, structuredClone(DEFAULT_CONFIG), root, { until: "finish", maxSteps: 3 }, deps(root, () => n, adapter));
  assert.equal(result.action, "finish_ready"); assert.equal(result.code, 0);
  assert.deepEqual([...new Set(adapter.calls)].sort(), ["launch", "observe", "probe", "recovery"], "only adapter session methods are used");
  assert.equal(n.effectiveStatus, "in_progress");
});
