import { allSpecs } from "../spec/project.js";
import { configSet } from "../config-ops.js";
import { loadSettings } from "../config.js";
import { presetCreate, presetList, presetParamsEdits, presetShow } from "../perm/preset-ops.js";
import { PreconditionError } from "../errors.js";
import { docsSearch, loadEssentials } from "../docs/operations.js";
import { REQUESTABLE_COMMANDS } from "../requests/actions.js";
import { sendRequest } from "../requests/ops.js";
import { headCommit } from "../spec/source.js";
import { findSpecId, headContext, implementSpec } from "../verify/implementation.js";
import { recordResults, type RecordableResult } from "../verify/test-record.js";
import { DEFAULT_TIMEOUT_SEC, runTests, type Selection } from "../verify/test-run.js";
import { bool, str, type ActionContext, type Adder, type Input } from "./action-types.js";

/** Actions that verify, record, configure, document and ask (`architecture/reference-cli` §12.1). */
const base = (c: ActionContext) => ({ root: c.root, actor: c.actor, preset: c.preset, now: c.now });
const actorTag = (c: ActionContext) => `${c.actor.kind === "llm" ? "llm" : "human"}:${c.actor.name}`;

export function registerOperationActions(add: Adder): void {
  add("spec.implement", { spec: str }, ["spec"], ["test.record"], false, async (c, p) => {
    const r = await implementSpec(base(c), p.spec);
    const reasons = [...r.failed.map((t) => `${t}: failed`), ...r.missing.map((t) => `${t}: no passing result from this run`), ...r.needsHarness.map((t) => `${t}: needs harness for intelligent judgement`)];
    return { ok: r.implemented, reasons, ...r };
  });
  add("test.run", { spec: str, section: str, label: { type: "string", pattern: "^T\\d+$" }, all: bool, timeout: { type: "number", exclusiveMinimum: 0 } }, [], ["info.retrieve"], true, async (c, p: Input) => {
    if (!p.spec && !p.all) throw new PreconditionError(["Name a spec or pass all."]);
    const commit = headCommit(c.root);
    if (!commit) throw new PreconditionError(["The repository has no commits; tests run on the committed content at HEAD."]);
    const { project } = headContext(c.root);
    const selection: Selection = p.spec ? { spec: findSpecId(allSpecs(project).map((d) => d.id), p.spec), ...(p.label ? { label: p.label } : p.section ? { section: p.section } : {}) } : {};
    const settings = loadSettings(c.root).config;
    const report = await runTests({ root: c.root, project, selection, timeoutSec: p.timeout ?? DEFAULT_TIMEOUT_SEC, commit,
      logMode: settings.values["tests.logs"] as "local" | "git" | "off", gitLogDir: settings.abs.testLogs, actor: actorTag(c) });
    const ran = report.results.filter((r): r is typeof r & { outcome: "passed" | "failed" } => r.outcome === "passed" || r.outcome === "failed");
    const recording = recordResults(base(c), commit, ran);
    const failed = report.results.filter((r) => r.outcome === "failed");
    return { ok: failed.length === 0, reasons: failed.map((r) => `${r.test}: failed`), commit, dirty: report.dirty, results: report.results, recording, warnings: [...report.warnings, ...recording.warnings] };
  });
  const result = { type: "object", additionalProperties: false, required: ["test", "spec", "kind", "outcome", "summary"],
    properties: { test: str, spec: str, kind: { enum: ["deterministic", "intelligent"] }, outcome: { enum: ["passed", "failed"] }, summary: str, log: str } };
  add("test.record", { results: { type: "array", items: result, minItems: 1 } }, ["results"], ["test.record"], false, (c, p) => {
    const commit = headCommit(c.root);
    if (!commit) throw new PreconditionError(["The repository has no commits; results are recorded on HEAD."]);
    const rep = recordResults(base(c), commit, p.results as RecordableResult[]);
    return { ok: !rep.notRecorded, reasons: rep.notRecorded ? [rep.notRecorded] : [], request: rep.held[0]?.request, ...rep };
  });
  add("config.set", { key: str, value: { type: "string" } }, ["key", "value"], ["config.change"], false, (c, p) => configSet(base(c), p.key, p.value));
  // Presets: the LLM reads them and may create one, never edit, delete or activate one (`roles-and-permissions R56.2`).
  add("preset.list", {}, [], ["info.retrieve"], true, (c) => presetList(c.root));
  add("preset.show", { id: str }, ["id"], ["info.retrieve"], true, (c, p) => presetShow(c.root, p.id));
  const roleBody = { type: "object", additionalProperties: false, properties: { default_mode: { enum: ["allow", "request-user", "deny"] }, modes: { type: "object", additionalProperties: { enum: ["allow", "request-user", "deny"] } } } };
  add("preset.create", { id: str, title: str, default_mode: { enum: ["allow", "request-user", "deny"] }, llm: roleBody, standard_user: roleBody }, ["id", "default_mode"], ["preset.create"], false, (c, p) => {
    const { id, edits, problems } = presetParamsEdits(p);
    return problems.length ? { ok: false, reasons: problems, lines: [], written: false } : presetCreate(base(c), id, edits);
  });
  // Documentation needs no permission (U0, `reference-cli` §7.3 and §13.1), like `permissions.docs`.
  add("docs.search", { query: str }, ["query"], [], true, (_c, p) => docsSearch(p.query));
  // The always-loaded essentials (`steering R23`): what the session-start delivery of an adapter sends, for a harness or
  // a session that did not receive it.
  add("docs.essentials", {}, [], [], true, () => ({ ok: true, essentials: loadEssentials() }));
  add("request.send", { command: { enum: [...REQUESTABLE_COMMANDS] }, params: { type: "object" }, reason: str, plan: str, blocking: bool }, ["command", "params", "reason"], [], false, (c, p) => {
    const r = sendRequest(base(c), { command: p.command, params: p.params, reason: p.reason, plan: p.plan, blocking: p.blocking });
    return { ok: r.ok, reasons: r.reasons, lines: r.lines, request: r.request?.id };
  });
}
