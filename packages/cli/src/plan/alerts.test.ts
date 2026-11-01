import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULT_CONFIG } from "../config.js";
import { dispatchAlerts, type Attention } from "./alerts.js";

function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-alert-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = structuredClone(DEFAULT_CONFIG), logs: string[] = [], messages: string[] = [];
  const alert: Attention = { kind: "blocked", detail: "Resolve requirement", command: "specplane plan show 2026-11-01-test" };
  return { root, config, logs, messages, input: { plan: "2026-11-01-test", checkout: root, sessionId: "session", alerts: [alert], cache: path.join(root, "alerts.json"), config, log: (s: string) => logs.push(s), harness: (s: string) => messages.push(s) } };
}

test("alerts: none has no delivery or filesystem side effects", t => {
  const s = setup(t); dispatchAlerts(s.input);
  assert.deepEqual(s.messages, []); assert.deepEqual(fs.readdirSync(s.root), []);
});

test("alerts: harness deduplicates across calls/restarts and re-alerts after resolution", t => {
  const s = setup(t); s.config.execution.notify.transport = "harness";
  dispatchAlerts(s.input); dispatchAlerts({ ...s.input });
  assert.equal(s.messages.length, 1); assert.match(s.messages[0], /Resolve requirement.*Decision\/action: specplane plan show/);
  dispatchAlerts({ ...s.input, alerts: [] }); dispatchAlerts(s.input);
  assert.equal(s.messages.length, 2);
  dispatchAlerts({ ...s.input, alerts: [{ ...s.input.alerts[0], detail: "Changed decision" }] });
  assert.equal(s.messages.length, 3);
});

test("alerts: event filter groups considerations and supports dedupe disabled", t => {
  const s = setup(t); s.config.execution.notify.transport = "harness";
  s.config.execution.notify.on = ["consideration"];
  dispatchAlerts(s.input); assert.equal(s.messages.length, 0);
  const input = { ...s.input, alerts: [{ kind: "gap_decision", detail: "Gap", command: "review gap" }] };
  dispatchAlerts(input); assert.equal(s.messages.length, 1);
  s.config.execution.notify.dedupe = false;
  dispatchAlerts(input); assert.equal(s.messages.length, 2);
});

test("alerts: command receives documented env without shell interpolation of details", t => {
  const s = setup(t); s.config.execution.notify.transport = "command"; s.config.execution.notify.command = "configured-hook";
  const calls: { cmd: string; env: NodeJS.ProcessEnv }[] = [];
  const detail = '$(do-not-execute); "sensitive detail"';
  dispatchAlerts({ ...s.input, alerts: [{ ...s.input.alerts[0], detail }], command: (cmd, env) => calls.push({ cmd, env }) });
  assert.equal(calls.length, 1); assert.equal(calls[0].cmd, "configured-hook");
  const env = calls[0].env;
  assert.equal(env.SPECPLANE_PLAN, s.input.plan); assert.equal(env.SPECPLANE_KIND, "blocked");
  assert.equal(env.SPECPLANE_DETAIL, detail); assert.equal(env.SPECPLANE_COMMAND, s.input.alerts[0].command);
  assert.equal(env.SPECPLANE_SESSION, "session"); assert.equal(env.SPECPLANE_CHECKOUT, s.root);
});

test("alerts: uncertain transport failures do not throw or automatically resend", t => {
  const s = setup(t); s.config.execution.notify.transport = "command"; s.config.execution.notify.command = "configured-hook";
  let calls = 0;
  const input = { ...s.input, command: () => { calls++; throw new Error("exit 1"); } };
  assert.doesNotThrow(() => dispatchAlerts(input)); assert.doesNotThrow(() => dispatchAlerts(input));
  assert.equal(calls, 1); assert.equal(s.logs.filter(l => l.includes("delivery failed")).length, 1);
});

test("alerts: malformed cache suppresses uncertain repeat delivery", t => {
  const s = setup(t); s.config.execution.notify.transport = "harness";
  fs.writeFileSync(s.input.cache, "broken JSON"); dispatchAlerts(s.input);
  assert.equal(s.messages.length, 0); assert.ok(s.logs.some(l => l.includes("cache unreadable")));
  assert.equal(fs.readFileSync(s.input.cache,"utf8"),"broken JSON");
});

test("alerts: duplicate copies of one consideration are delivered only once", t => {
  const s = setup(t); s.config.execution.notify.transport = "harness";
  dispatchAlerts({ ...s.input, alerts: [s.input.alerts[0], { ...s.input.alerts[0] }] });
  assert.equal(s.messages.length, 1);
});
