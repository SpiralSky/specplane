import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configSet } from "../config-ops.js";
import { describePermission } from "../perm/docs.js";
import { CATALOG, PRESETS, activePreset } from "../perm/permissions.js";
import { roleApprove, roleCreate, roleEdit } from "../perm/role-ops.js";
import { makeRepo } from "../test-repo.js";
import {
  generateCommandSteering, generatePermissionSteering, generateRoleSteering, inspectSteering,
  matchingCustom, readSteeringTemplate, regenerateSteering, steeringInputs, steeringStamp,
  steeringWarnings, UNTRUSTED_STEERING, STEERING_COMMANDS, type SteeringInputs,
} from "./steering.js";

const packageDir = fileURLToPath(new URL("../../", import.meta.url));
// File-backed capture avoids Bun subprocess pipe writes failing with EPERM in restricted environments.
function capture(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steering-output-"));
  const out = path.join(dir, "stdout"), err = path.join(dir, "stderr");
  const stdout = fs.openSync(out, "w"), stderr = fs.openSync(err, "w");
  try {
    const result = spawnSync(command, args, { cwd, env, stdio: ["ignore", stdout, stderr] });
    return { ...result, stdout: fs.readFileSync(out, "utf8"), stderr: fs.readFileSync(err, "utf8") };
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function git(root: string, ...args: string[]): void {
  const p = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr);
}
function repo(config = ""): string {
  const root = makeRepo({ ".specplane/config.yaml": config });
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  commit(root);
  return root;
}
function commit(root: string): void {
  git(root, "add", ".specplane/config.yaml");
  git(root, "commit", "-qm", "config");
}
const input: SteeringInputs = { role: "llm", preset: PRESETS[0], version: "0.1.0", custom: [] };

test("every default preset and role has limit and no-bypass steering for every permission", () => {
  for (const preset of PRESETS) for (const role of ["llm", "standard-user", "administrator"] as const) for (const permission of CATALOG) {
    const text = generatePermissionSteering({ ...input, preset, role }, permission);
    for (const part of [permission, `Role: ${role}`, "Mode:", "Allows:", "Does not allow:", "Do not bypass", "authoritative"]) assert.ok(text.includes(part), `${preset.id}/${permission}: ${part}`);
    assert.match(text, /^Steering stamp: [a-f0-9]{64}\n/);
    assert.doesNotMatch(text, /\{\{/);
  }
});

test("role and command templates cover all five cases, hierarchy, secrets and no skipping", () => {
  const role = generateRoleSteering(input);
  for (const part of ["Role: llm", "permission checks, not steering", "A denial is final", "another tool", "another role", "direct file edits", "Do not call the Specplane CLI", "credentials"]) assert.ok(role.includes(part), part);
  for (const command of Object.keys(STEERING_COMMANDS)) {
    const text = generateCommandSteering(input, command);
    for (const part of ["Request-user:", "Deny:", "User-run command:", "Allow:", "Blocked in a plan:", "prefer blocking", "Outside a plan", "Requirements > Feature > Architecture", "same-layer", "Awaiting Review", "older commit", "current step", "Never skip an unfinished step", "gaps and assumptions"]) assert.ok(text.includes(part), `${command}: ${part}`);
  }
  assert.match(generateCommandSteering(input, "spec-assist", { specType: "architecture" }), /Permission: spec.edit.architecture/);
  assert.doesNotMatch(generateCommandSteering(input, "spec-assist", { specType: "architecture" }), /Permission: spec.edit.feature/);
  assert.match(generateCommandSteering(input, "spec-draft-architecture", { specType: "feature" }), /Permission: spec.create.feature/);
  const step = generateCommandSteering(input, "plan-step");
  for (const permission of ["info.retrieve", "spec.edit.feature", "spec.edit.architecture", "test.record", "plan.softstop"]) {
    assert.ok(step.includes(`Permission: ${permission}.`), permission);
  }
});

test("overall, target and context custom steering is appended in specificity order without replacing base", () => {
  const custom = [
    { permission: "spec.approve", scope: "P1", text: "plan-specific" },
    { permission: "spec.approve", scope: "feature", text: "type-specific" },
    { permission: "spec.approve", scope: "all", text: "permission-general" },
    { command: "approve", scope: "all", text: "command-specific" },
    { command: "*", scope: "all", text: "overall-general" },
    { permission: "spec.approve", scope: "P2", text: "wrong-plan" },
  ];
  const source = { ...input, custom };
  assert.deepEqual(matchingCustom(source, { permission: "spec.approve" }, { specType: "feature", planId: "P1" }).map((c) => c.text), ["overall-general", "permission-general", "type-specific", "plan-specific"]);
  const text = generatePermissionSteering(source, "spec.approve", { specType: "feature", planId: "P1" });
  assert.match(text, /Do not bypass/);
  assert.match(text, /on conflict the more specific wins/);
  assert.match(text, /\[overall\]/);
  assert.ok(text.indexOf("overall-general") < text.indexOf("permission-general"));
  assert.ok(text.indexOf("permission-general") < text.indexOf("type-specific"));
  assert.ok(text.indexOf("type-specific") < text.indexOf("plan-specific"));
  assert.doesNotMatch(text, /wrong-plan|command-specific/);
  assert.doesNotMatch(generatePermissionSteering(source, "spec.approve"), /type-specific|plan-specific|wrong-plan/);
  assert.match(generateCommandSteering(source, "approve"), /command-specific/);
  const command = generateCommandSteering(source, "approve");
  assert.equal(command.split("overall-general").length - 1, 1);
  assert.ok(command.indexOf("overall-general") < command.indexOf("permission-general"));
  assert.doesNotMatch(generateCommandSteering(source, "validate"), /command-specific|permission-general/);
  assert.match(generateRoleSteering(source), /overall-general/);
});

test("stamps are stable and change with preset identity, mode content, custom text and package version", () => {
  const first = steeringStamp(input);
  assert.equal(first, steeringStamp({ ...input, role: "administrator" }));
  for (const changed of [
    { ...input, preset: PRESETS[1] },
    { ...input, preset: { ...input.preset, defaultMode: "allow" as const } },
    { ...input, custom: [{ command: "*", text: "Ask first" }] },
    { ...input, version: "0.2.0" },
  ]) assert.notEqual(first, steeringStamp(changed));
});

test("steering uses approved custom permissions and refreshes its stamp only when an edit is approved", () => {
  const root = repo();
  const ctx = () => ({ root, actor: { kind: "human" as const, role: "administrator", name: "Test" }, preset: activePreset(root) });
  assert.equal(roleCreate(ctx(), "helper", { level: 2, defaultMode: "deny", sets: ["info.retrieve=allow", "spec.create.feature=request-user"] }).ok, true);
  git(root, "add", ".specplane/roles");
  git(root, "commit", "-qm", "role");
  const pending = inspectSteering(root, "info.retrieve", {}, "helper");
  assert.match(pending.text, /Role: helper\. Mode: deny/);
  assert.equal(roleApprove(ctx(), "helper").ok, true);
  const before = inspectSteering(root, "info.retrieve", {}, "helper");
  assert.equal(before.trusted, true);
  assert.match(before.text, /Role: helper\. Mode: allow/);
  assert.notEqual(before.stamp, pending.stamp);
  assert.match(inspectSteering(root, "spec.create.feature", {}, "helper").text, /Role: helper\. Mode: request-user/);
  const role = inspectSteering(root, "role", {}, "helper");
  assert.match(role.text, /info.retrieve: allow/);
  assert.match(role.text, /spec.create.feature: request-user/);
  assert.match(role.text, /spec.edit.architecture: deny/);
  assert.match(inspectSteering(root, "plan-status", {}, "helper").text, /Role: helper\. Mode: allow/);
  assert.equal(roleEdit(ctx(), "helper", { sets: ["info.retrieve=deny"] }).ok, true);
  git(root, "add", ".specplane/roles");
  git(root, "commit", "-qm", "edit role");
  assert.deepEqual(inspectSteering(root, "info.retrieve", {}, "helper"), before);
  assert.equal(roleApprove(ctx(), "helper").ok, true);
  const after = inspectSteering(root, "info.retrieve", {}, "helper");
  assert.equal(after.trusted, true);
  assert.match(after.text, /Role: helper\. Mode: deny/);
  assert.notEqual(after.stamp, before.stamp);
});

test("config effects regenerate HEAD only; preset and custom changes stay inactive until committed", () => {
  const root = repo("permissions:\n  preset: full-manual-editing\n");
  const before = inspectSteering(root, "spec.edit.feature");
  const ctx = { root, actor: { kind: "human" as const, role: "standard-user" as const, name: "Test" }, preset: activePreset(root) };
  const result = configSet(ctx, "permissions.preset", "full-llm-control");
  assert.ok(result.ok);
  assert.match(result.lines.join("\n"), /regenerated from committed configuration/);
  assert.match(result.lines.join("\n"), /legacy managed files were not rewritten/);
  assert.deepEqual(inspectSteering(root, "spec.edit.feature"), before);
  assert.match(before.text, /Mode: deny/);
  const pending = configSet(ctx, "steering.custom", '[{command: "*", scope: all, text: "Pending private convention"}]');
  assert.ok(pending.ok);
  assert.doesNotMatch(inspectSteering(root, "validate").text, /Pending private convention/);
  commit(root);
  const after = inspectSteering(root, "spec.edit.feature");
  assert.match(after.text, /Mode: allow/);
  assert.match(after.text, /Pending private convention/);
  assert.notEqual(after.stamp, before.stamp);
  assert.deepEqual(steeringWarnings(root), []);
});

test("CLI inspection and permission documentation expose the same complete LLM permission text", () => {
  const root = repo('steering:\n  custom:\n    - command: "*"\n      text: Overall convention\n    - permission: spec.approve\n      text: Approval convention\n');
  const expected = inspectSteering(root, "spec.approve");
  const detail = describePermission(root, "spec.approve", "standard-user")!;
  assert.equal(detail.readerMode, "allow");
  assert.ok(detail.lines.includes(expected.text));
  assert.match(expected.text, /Role: llm. Mode: request-user/);
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const output = capture(process.execPath, [cli, "steering", "spec.approve", "--json"], root, { ...process.env, SPECPLANE_AGENT: "", SPECPLANE_SESSION: "" });
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).data.text, expected.text);
});

test("regeneration failure replaces output with an untrusted notice and produces an installation warning", () => {
  const root = repo();
  assert.ok(regenerateSteering(root).trusted);
  const broken = () => { throw new Error("secret credentials must not be echoed"); };
  const failed = regenerateSteering(root, broken);
  assert.equal(failed.text, UNTRUSTED_STEERING);
  assert.equal(failed.trusted, false);
  assert.doesNotMatch(failed.text, /secret credentials must not be echoed|Mode: allow/);
  assert.equal(inspectSteering(root, "approve", {}, "llm", broken).text, UNTRUSTED_STEERING);
  assert.deepEqual(steeringWarnings(root, broken), [UNTRUSTED_STEERING]);
  assert.deepEqual(steeringWarnings(root, (name) => name === "permission" ? "" : readSteeringTemplate(name)), [UNTRUSTED_STEERING]);
  assert.ok(inspectSteering(root, "approve").trusted, "an ordinary read retries and repairs a historical failure");
  assert.deepEqual(steeringWarnings(root), []);
});

test("published tarball includes steering assets and generator resolves them from installed layout", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steering-package-"));
  const packed = capture("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", dir], packageDir, { ...process.env, npm_config_cache: path.join(dir, "npm-cache") });
  assert.equal(packed.status, 0, packed.stderr);
  const pack = JSON.parse(packed.stdout)[0];
  for (const name of ["role", "permission", "cases"]) assert.ok(pack.files.some((f: { path: string }) => f.path === `assets/steering/${name}.md`));
  const unpack = spawnSync("tar", ["-xzf", path.join(dir, pack.filename), "-C", dir], { encoding: "utf8" });
  assert.equal(unpack.status, 0, unpack.stderr);
  fs.symlinkSync(path.join(packageDir, "node_modules"), path.join(dir, "package/node_modules"), "dir");
  const installed = await import(pathToFileURL(path.join(dir, "package/dist/harness/steering.js")).href);
  const generated = installed.generateCommandSteering(steeringInputs(repo()), "approve");
  assert.match(generated, /Command: approve/);
  assert.match(generated, /Do not bypass/);
  const instructions = await import(pathToFileURL(path.join(dir, "package/dist/harness/instructions.js")).href);
  for (const command of instructions.COMMANDS) {
    assert.ok(pack.files.some((f: { path: string }) => f.path === `assets/commands/${command}.md`));
    assert.ok(instructions.assembleInstructions(repo(), command).text.includes(instructions.commandDocumentation(command)));
  }
});
