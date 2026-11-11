import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { run } from "../git/exec.js";
import { makeRepo, spec } from "../test-repo.js";
import { DEFAULT_PRESET, type Mode } from "../perm/permissions.js";
import { acceptRequest, sendRequest } from "../requests/ops.js";
import { listRequests, readRequest } from "../requests/store.js";
import { actionNeeds } from "../requests/requirements.js";
import { splitFrontmatter } from "../spec/frontmatter.js";
import { headContext } from "../verify/implementation.js";
import { computeStatus } from "../spec/status.js";
import { readNotes } from "../spec/notes.js";
import { createActionRuntime, listActions, validateActionInput } from "./actions.js";
import { retrieveSpecs } from "./retrieve.js";

const file = "docs/specifications/features/a.md";
const text = (id = "feature/a", body = "# A\n\n## R1: First\n\nOriginal\n\n### R1.1: Nested\n\nNested\n\n## R2: Second\n\nOther\n") => spec({ id, title: "A", authors: [] }, body);
function repo(config = ""): string {
  const root = makeRepo({ ".specplane/config.yaml": `auto_warn: false\n${config}`, [file]: text() });
  for (const args of [["init", "-q"], ["config", "user.name", "Test"], ["config", "user.email", "test@example.invalid"], ["add", "."], ["commit", "-qm", "fixture"]]) run("git", args, { cwd: root });
  return root;
}
const runtime = (root: string, id = "agent-session") => createActionRuntime({ root, id, reportsContext: false, model: "reported-model" });
const human = (root: string) => ({ root, actor: { role: "standard-user" as const, kind: "human" as const, name: "Test" }, preset: DEFAULT_PRESET });
const inputs: Record<string, Record<string, unknown>> = {
  "spec.retrieve": { ids: ["feature/a"] }, "spec.review-context": { ids: ["feature/a"] },
  "spec.list": {}, "spec.meta.read": { spec: "feature/a" },
  "spec.create": { spec: "feature/new", text: text("feature/new") },
  "spec.edit": { spec: "feature/a", text: text().replace("Original", "Changed") },
  "spec.delete": { spec: "feature/a" }, "spec.approve": { ids: ["feature/a"] },
  validate: {}, warnings: {}, coverage: {}, "config.get": {}, "permissions.docs": {}, "audit.read": {},
  "warnings.report": { text: "Layer mix", subject: "spec", why: "Review", ref: "feature/a" },
};

const specActions = new Set(Object.keys(inputs));
for (const action of listActions().filter((a) => specActions.has(a.id))) for (const mode of ["allow", "request-user", "deny"] as Mode[]) {
  test(`${action.id}: ${mode} uses the in-process LLM permission`, async () => {
    const root = repo();
    const input = inputs[action.id];
    assert.ok(input, "Every registered action must have permission-path coverage");
    const prior = DEFAULT_PRESET.llm.modes;
    DEFAULT_PRESET.llm.modes = { ...prior, ...Object.fromEntries(action.permissions(input).map((p) => [p, mode])) };
    try {
      const r = await runtime(root).call(action.id, input);
      const guarded = action.permissions(input).length > 0;
      if (guarded && mode === "deny") {
        assert.equal(r.ok, false);
        assert.match(r.findings.join(), /permission/);
        assert.equal(listRequests(root).length, 0);
      } else if (guarded && mode === "request-user") {
        assert.equal(r.ok, true, r.findings.join());
        assert.ok(r.request);
        assert.equal(fs.readFileSync(path.join(root, file), "utf8"), text());
        assert.equal(fs.existsSync(path.join(root, "docs/specifications/features/new.md")), false);
        const request = readRequest(root, r.request)!;
        assert.equal(request.from.session, "agent-session");
        assert.equal(request.from.model, "reported-model");
        const accepted = await acceptRequest(human(root), r.request);
        assert.equal(accepted.ok, true, accepted.reasons.join());
        assert.equal((await acceptRequest(human(root), r.request)).ok, false, "execute only once");
      } else {
        assert.equal(r.ok, true, r.findings.join());
        assert.equal(r.request, undefined);
      }
      if (guarded) assert.match(r.instructions.map((x) => x.text).join(), /Do not bypass/);
    } finally { DEFAULT_PRESET.llm.modes = prior; }
  });
}

test("schemas reject role injection, unknown fields and user-only action names", async () => {
  const r = runtime(repo());
  for (const id of ["request.accept", "request.decline", "role.switch", "toString"]) assert.equal((await r.call(id, {})).ok, false);
  for (const extra of [{ role: "administrator" }, { actor: { role: "administrator" } }, { status: "approved" }, { approval: {} }]) {
    assert.equal((await r.call("spec.create", { ...inputs["spec.create"], ...extra })).ok, false);
  }
  assert.throws(() => validateActionInput("spec.retrieve", { ids: [] }), /Invalid input/);
  assert.throws(() => validateActionInput("spec.edit", { spec: "feature/a" }), /Invalid input/);
});

test("all legacy record keys are rejected in supplied spec text before a request", async () => {
  const root = repo();
  const r = runtime(root);
  for (const key of ["status", "approval", "review-reason", "results", "implementation"]) {
    for (const operation of ["create", "edit"]) {
      const id = operation === "create" ? "feature/new" : "feature/a";
      const reply = await r.call(`spec.${operation}`, { spec: id, text: text(id).replace("---\n", `---\n${key}: approved\n`) });
      assert.equal(reply.ok, false);
      assert.match(reply.findings.join(), /Legacy record key/);
    }
  }
  assert.equal(listRequests(root).length, 0);
  assert.equal(fs.readFileSync(path.join(root, file), "utf8"), text());
});

test("accepted edits preserve human authors and use originating model with contribution", async () => {
  const root = repo();
  const original = spec({ id: "feature/a", title: "A", authors: [{ human: "Pat" }] }, "# A\n\n## R1: Goal\n\nOld\n");
  fs.writeFileSync(path.join(root, file), original);
  const r = await runtime(root).call("spec.edit", { spec: "feature/a", section: "R1", text: "## R1: Goal\n\nNew\n", contribution: "Reword goal" });
  assert.ok(r.request, r.findings.join());
  assert.equal((await acceptRequest(human(root), r.request)).ok, true);
  const changed = fs.readFileSync(path.join(root, file), "utf8");
  assert.deepEqual(splitFrontmatter(changed).data?.authors, [{ human: "Pat" }, { llm: "reported-model", contribution: "Reword goal" }]);
  assert.match(changed, /New/);
  const { project, ctx } = headContext(root);
  assert.equal(computeStatus(project, project.specs.get("feature/a")!, ctx).status, "awaiting-review");
  assert.equal(run("git", ["show", `HEAD:${file}`], { cwd: root }), text(), "writes do not commit");
  const forged = changed.replace('"Pat"', '"Invented"');
  assert.equal((await runtime(root).call("spec.edit", { spec: "feature/a", text: forged })).ok, false);
});

test("create and delete requests cannot overwrite intervening work; paths and symlinks are refused", async () => {
  for (const operation of ["create", "edit", "delete"]) {
    const root = repo();
    const r = await runtime(root).call(`spec.${operation}`, inputs[`spec.${operation}`]);
    assert.ok(r.request);
    const target = operation === "create" ? "docs/specifications/features/new.md" : file;
    fs.writeFileSync(path.join(root, target), "Later human work\n");
    assert.equal((await acceptRequest(human(root), r.request)).ok, false);
    assert.equal(fs.readFileSync(path.join(root, target), "utf8"), "Later human work\n");
  }
  const root = repo();
  for (const id of ["feature/../../escape", "/tmp/escape", "feature/a/b"]) assert.equal((await runtime(root).call("spec.delete", { spec: id })).ok, false);
  fs.symlinkSync(path.join(root, file), path.join(root, "docs/specifications/features/link.md"));
  assert.equal((await runtime(root).call("spec.delete", { spec: "feature/link" })).ok, false);
  assert.equal(fs.readFileSync(path.join(root, file), "utf8"), text());
});

test("retrieval deduplicates cited sections, includes subsections, reports missing cites and HEAD differences", () => {
  const root = repo();
  const b = spec({ id: "feature/b", title: "B", authors: [], references: ["feature/a R1", "root:feature/a R1", "feature/missing"] }, "# B\n");
  fs.writeFileSync(path.join(root, "docs/specifications/features/b.md"), b);
  fs.appendFileSync(path.join(root, file), "Uncommitted text\n");
  const parts = retrieveSpecs(root, ["feature/b", "feature/a"], true);
  const section = parts.filter((p) => p.cite === "feature/a R1");
  assert.equal(section.length, 1);
  assert.match(section[0].text!, /Nested/);
  assert.doesNotMatch(section[0].text!, /R2|Other/);
  assert.equal(section[0].status, "awaiting-review");
  assert.match(section[0].notes!.join(), /uncommitted/);
  assert.match(parts.find((p) => !p.found)!.reason!, /not found/);
  assert.equal(retrieveSpecs(root, ["feature/b"], false).length, 1);
});

test("authorship can be disabled; missing adapter model is recorded as unknown", async () => {
  for (const enabled of [true, false]) {
    const root = repo(`permissions:\n  preset: full-llm-control\nauthorship:\n  record_llm: ${enabled}\n`);
    const r = await createActionRuntime({ root, id: "unknown", reportsContext: false }).call("spec.create", inputs["spec.create"]);
    assert.equal(r.ok, true, r.findings.join());
    const fm = splitFrontmatter(fs.readFileSync(path.join(root, "docs/specifications/features/new.md"), "utf8"));
    assert.deepEqual(fm.data?.authors, enabled ? [{ llm: "unknown", contribution: "create feature/new" }] : []);
  }
});

test("warnings.report lasts only for its runtime session; reads cannot dispatch a write", async () => {
  const root = repo();
  const one = runtime(root);
  await one.call("warnings.report", inputs["warnings.report"]);
  const warnings = (await one.call("warnings", {})).data as { text: string }[];
  assert.ok(warnings.some((w) => w.text === "Layer mix"));
  assert.ok(!((await runtime(root, "other").call("warnings", {})).data as { text: string }[]).some((w) => w.text === "Layer mix"));
  assert.throws(() => actionNeeds(root, "harness read", { id: "spec.delete", input: { spec: "feature/a" } }), /Only read/);
  const result = sendRequest({ ...human(root), actor: { role: "llm", kind: "llm", name: "Agent" } }, {
    command: "harness read", params: { id: "role.switch", input: {} }, reason: "Bypass", permissions: ["info.retrieve"],
  });
  assert.equal(result.ok, false);
});

test("adapter command delivery includes the contract; LLM approvals never invent a human approver", async () => {
  const root = repo();
  const prior = DEFAULT_PRESET.llm.modes;
  DEFAULT_PRESET.llm.modes = { ...prior, "spec.approve": "allow" };
  try {
    const r = await createActionRuntime({ root, id: "approval", reportsContext: true, command: "approve", model: "actual-model", delegatedBy: "Pat" }).call("spec.approve", { ids: ["feature/a"] });
    assert.equal(r.ok, true, r.findings.join());
    assert.match(r.instructions[0].text!, /## Purpose/);
    assert.deepEqual(readNotes(root).bySpec.get("feature/a")!.at(-1)!.rec.by, { llm: "actual-model", "delegated-by": "Pat" });
  } finally { DEFAULT_PRESET.llm.modes = prior; }
});

test("retrieval refuses references escaping the repository, including symlinks", () => {
  const root = repo();
  const outside = repo();
  fs.writeFileSync(path.join(outside, "hidden.txt"), "Outside content");
  fs.symlinkSync(path.join(outside, "hidden.txt"), path.join(root, "link.txt"));
  const parts = retrieveSpecs(root, [`file:${path.relative(root, outside)}/hidden.txt`, "file:link.txt"]);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => !p.found && !p.text));
});

test("no-op edits leave authorship and requests unchanged", async () => {
  const root = repo();
  const r = await runtime(root).call("spec.edit", { spec: "feature/a", text: text() });
  assert.equal(r.ok, true);
  assert.equal(r.request, undefined);
  assert.equal(fs.readFileSync(path.join(root, file), "utf8"), text());
  assert.equal(listRequests(root).length, 0);
});
