import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { runValidate } from "./commands/validate.js";
import { formatHuman } from "./output/human.js";
import { formatJson } from "./output/json.js";
import { CONFIG, makeRepo, spec } from "./test-repo.js";

const feat = (id: string, extra: Record<string, unknown> = {}, body?: string) =>
  spec({ id, title: "T", status: "approved", author: "user", ...extra }, body);
const arch = (id: string, extra: Record<string, unknown> = {}, body?: string) =>
  spec({ id, title: "T", status: "approved", author: "user", ...extra }, body);

const run = (files: Record<string, string>) =>
  runValidate(makeRepo({ ".specplane/config.yaml": CONFIG, ...files }));
const msgs = (r: ReturnType<typeof run>, sev: "errors" | "warnings") => r[sev].map((f) => `${f.type}: ${f.message}`);

test("clean repository is valid", () => {
  const r = run({ "specs/features/alpha.md": feat("feature/alpha") });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test("mismatched ID is an error", () => {
  const r = run({ "specs/features/alpha.md": feat("feature/beta") });
  assert.ok(msgs(r, "errors").includes("id: ID `feature/beta` does not match path-derived ID `feature/alpha`."));
  assert.equal(r.valid, false);
});

test("missing frontmatter is a schema error; INFO.md with frontmatter is an error, without is ignored", () => {
  const r = run({
    "specs/features/alpha.md": "# no frontmatter\n",
    "specs/features/INFO.md": "---\nx: 1\n---\n",
    "specs/architecture/INFO.md": "# docs\n",
  });
  assert.equal(r.errors.filter((e) => e.type === "schema").length, 2);
  assert.ok(r.errors.some((e) => e.message.includes("`INFO.md` is not a spec")));
});

test("leak guard: path and tech_name warnings, with exclusions", () => {
  const r = run({
    "specs/features/alpha.md": feat("feature/alpha", {}, "# T\n\nSee src/foo.ts and TypeScript.\n\n```\nsrc/bar.ts\n```\n\nSet status_source. Widget src/foo.ts\n"),
    "specs/features/beta.md": feat("feature/beta", { allow_architecture: true, architecture_reason: "needed" }, "# T\n\nsrc/foo.ts\n"),
  });
  const types = r.warnings.map((w) => `${w.spec}:${w.type}:${w.line}`);
  assert.ok(types.includes("feature/alpha:path:9"));
  assert.ok(types.includes("feature/alpha:tech_name:9"));
  assert.ok(!types.some((t) => t.startsWith("feature/beta")));
  assert.ok(!r.warnings.some((w) => w.message.includes("bar.ts") || w.message.includes("status_source")));
  assert.equal(r.valid, true);
});

test("ordering: approved architecture spec with non-approved feature is an error; draft is not", () => {
  const files = { "specs/features/alpha.md": feat("feature/alpha", { status: "draft" }) };
  const bad = run({ ...files, "specs/architecture/xray.md": arch("architecture/xray", { implements: ["feature/alpha"] }) });
  assert.ok(msgs(bad, "errors").includes("ordering: Cannot approve `architecture/xray`: `feature/alpha` is `draft`, not `approved`."));
  const ok = run({ ...files, "specs/architecture/xray.md": arch("architecture/xray", { status: "draft", implements: ["feature/alpha"] }) });
  assert.deepEqual(ok.errors, []);
});

test("unresolved implements/supersedes are errors", () => {
  const r = run({ "specs/architecture/xray.md": arch("architecture/xray", { implements: ["feature/none"], supersedes: ["architecture/old"] }) });
  assert.equal(r.errors.filter((e) => e.type === "reference").length, 2);
});

test("overlay with the same ID as a base spec is a shadowing error", () => {
  const r = run({
    "specs/features/alpha.md": feat("feature/alpha"),
    "ext-specs/features/alpha.md": feat("feature/alpha"),
  });
  assert.ok(r.errors.some((e) => e.type === "id" && e.message.includes("shadows")));
});

test("extends: valid overlay passes; standalone root and unresolved target error", () => {
  const ok = run({
    "specs/features/alpha.md": feat("feature/alpha"),
    "ext-specs/features/beta.md": feat("feature/beta", { extends: "feature/alpha" }),
  });
  assert.deepEqual(ok.errors, []);
  const bad = run({
    "specs/features/alpha.md": feat("feature/alpha", { extends: "feature/zzz" }),
    "ext-specs/features/beta.md": feat("feature/beta", { extends: "feature/zzz" }),
  });
  assert.equal(bad.errors.filter((e) => e.type === "reference").length, 2);
});

test("overlay contradiction heuristic warns", () => {
  const r = run({
    "specs/features/alpha.md": feat("feature/alpha", {}, "# T\n\nThe planner writes migration records for every project.\n"),
    "ext-specs/features/beta.md": feat("feature/beta", { extends: "feature/alpha" }, "# T\n\nThe planner must not write migration records.\n"),
  });
  assert.ok(r.warnings.some((w) => w.type === "overlay" && w.message.includes("may contradict")));
});

test("based_on key must appear in extends or implements; anchors warn", () => {
  const r = run({
    "specs/features/alpha.md": feat("feature/alpha", {}, "# T\n\n## Real\n"),
    "ext-specs/features/beta.md": feat("feature/beta", { extends: "feature/alpha#missing", based_on: { "feature/qq": "abcdef1" } }),
  });
  assert.ok(r.errors.some((e) => e.type === "pin"));
  assert.ok(r.warnings.some((w) => w.type === "anchor"));
});

test("authorship: llm author on a review spec under user authorship warns", () => {
  const r = run({ "specs/features/alpha.md": feat("feature/alpha", { author: "llm", status: "review" }) });
  assert.ok(r.warnings.some((w) => w.type === "authorship"));
});

const PLAN = (id: string, extra: Record<string, unknown> = {}) =>
  `---\n${Object.entries({ id, title: "P", status: "ready", specs: ["feature/alpha"], ...extra })
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n# P\n`;
const STEP = (plan: string, step: number, extra: Record<string, unknown> = {}) =>
  `---\n${Object.entries({ plan, step, title: "S", status: "pending", ...extra })
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n## Goal\n`;
const base = { "specs/features/alpha.md": feat("feature/alpha", {}, "# A\n\n## Rules\n") };

test("plan dependency cycle and dangling dependency are errors", () => {
  const r = run({
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1", { depends_on: ["2026-01-02-p2", "ghost"] }),
    "plans/2026-01-02-p2/PLAN.md": PLAN("2026-01-02-p2", { depends_on: ["2026-01-01-p1"] }),
  });
  assert.ok(r.errors.some((e) => e.message.startsWith("Dependency cycle: 2026-01-01-p1 -> 2026-01-02-p2 -> 2026-01-01-p1")));
  assert.ok(r.errors.some((e) => e.message.includes("`ghost`")));
});

test("dependency on an abandoned plan is an error; stored in_progress warns under git status_source", () => {
  const r = run({
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1", { depends_on: ["2026-01-02-p2"], status: "in_progress" }),
    "plans/2026-01-02-p2/PLAN.md": PLAN("2026-01-02-p2", { status: "abandoned" }),
  });
  assert.ok(r.errors.some((e) => e.message.includes("abandoned")));
  assert.ok(r.warnings.some((w) => w.type === "plan"));
});

test("step number must match the file name", () => {
  const r = run({
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1),
    "plans/2026-01-01-p1/steps/02-foo.md": STEP("2026-01-01-p1", 3),
  });
  assert.ok(r.errors.some((e) => e.type === "step" && e.message.includes("does not match the file name prefix")));
});

test("step numbering: missing and duplicate numbers are errors", () => {
  const r = run({
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1),
    "plans/2026-01-01-p1/steps/03-c.md": STEP("2026-01-01-p1", 3),
    "plans/2026-01-02-p2/PLAN.md": PLAN("2026-01-02-p2"),
    "plans/2026-01-02-p2/steps/01-a.md": STEP("2026-01-02-p2", 1),
    "plans/2026-01-02-p2/steps/01-b.md": STEP("2026-01-02-p2", 1),
  });
  assert.ok(r.errors.some((e) => e.message.includes("step 2 is missing")));
  assert.ok(r.errors.some((e) => e.message.includes("Duplicate step number 1")));
});

test("step context: anchors, decisions, files, drafts", () => {
  const r = run({
    ...base,
    "decisions/0001-x.md": spec({ id: "decision/0001", title: "D", date: "2026-01-01", status: "accepted" }),
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1, {
      context: [
        { spec: "feature/alpha#Rules" },
        { spec: "feature/alpha#Nope" },
        { spec: "feature/missing" },
        { decision: "decision/0001" },
        { decision: "decision/0009" },
        { file: "nowhere.ts" },
      ],
    }),
  });
  assert.equal(r.warnings.filter((w) => w.type === "anchor").length, 1);
  assert.equal(r.errors.filter((e) => e.type === "reference").length, 2);
  assert.ok(r.warnings.some((w) => w.message.includes("nowhere.ts")));
});

test("skipped and blocked steps need a matching HANDOFF section", () => {
  const files = {
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1, { status: "blocked" }),
  };
  assert.ok(run(files).errors.some((e) => e.type === "step" && e.message.includes("HANDOFF.md")));
  const ok = run({ ...files, "plans/2026-01-01-p1/HANDOFF.md": "# HANDOFF — 2026-01-01-p1\n\n## Step 01: S\n\n**Date**: 2026-01-01\n**Outcome**: blocked\n" });
  assert.deepEqual(ok.errors, []);
});

test("HANDOFF repeated sections: only the latest outcome is checked", () => {
  const files = {
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1, { status: "done" }),
  };
  const handoff = (...outcomes: string[]) =>
    `# HANDOFF — 2026-01-01-p1\n\n${outcomes.map((o) => `## Step 01: S\n\n**Date**: 2026-01-01\n**Outcome**: ${o}\n`).join("\n")}`;
  const ok = run({ ...files, "plans/2026-01-01-p1/HANDOFF.md": handoff("blocked", "done") });
  assert.deepEqual(ok.errors, [], "an earlier blocked section stays valid once the step is re-run");
  const bad = run({ ...files, "plans/2026-01-01-p1/HANDOFF.md": handoff("done", "blocked") });
  assert.ok(bad.errors.some((e) => e.message === "Step 1 is `done` but the latest HANDOFF.md `## Step 01` section has `**Outcome**: blocked`."));
});

const GAP = (n: number, fields: Record<string, string> = {}) => {
  const all: Record<string, string> = {
    Kind: "gap", Step: "1", Case: "the case", Resolution: "the resolution", "Target spec": "`feature/alpha`", Status: "open", ...fields,
  };
  return `## G${n}: case ${n}\n\n${Object.entries(all).filter(([, v]) => v !== "").map(([k, v]) => `**${k}**: ${v}`).join("\n")}\n`;
};

test("spec-gaps.md: valid entries pass; format, kind, status, step and target are checked", () => {
  const files = {
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1),
  };
  const valid = run({ ...files, "plans/2026-01-01-p1/spec-gaps.md": `# Spec gaps — 2026-01-01-p1\n\n${GAP(1)}\n${GAP(2, { Kind: "proposal", Status: "applied" })}\n` });
  assert.deepEqual(valid.errors, []);
  const bad = run({
    ...files,
    "plans/2026-01-01-p1/spec-gaps.md": [
      "# Spec gaps",
      GAP(1, { Kind: "note", Status: "wip", Step: "9", "Target spec": "`feature/missing`" }),
      GAP(2, { Resolution: "", "Target spec": "" }),
      "## Not a gap heading\n",
    ].join("\n"),
  });
  const errs = bad.errors.map((e) => e.message);
  assert.ok(errs.includes("spec-gaps.md: heading `Not a gap heading` must be `## G<n>: <case>`."));
  assert.ok(errs.includes("spec-gaps.md: G1 has Kind `note`; expected gap, assumption, proposal."));
  assert.ok(errs.includes("spec-gaps.md: G1 has Status `wip`; expected open, applied, rejected."));
  assert.ok(errs.includes("spec-gaps.md: G1 Step 9 is not a step of this plan."));
  assert.ok(errs.includes("spec-gaps.md: G2 has no **Resolution**."));
  assert.ok(errs.includes("spec-gaps.md: G2 has no **Target spec**."));
  assert.ok(bad.warnings.some((w) => w.message.includes("G1 Target spec `feature/missing` does not resolve")));
});

test("spec-gaps.md: out-of-order numbers are errors; an archived feature-spec-proposals.md is ignored", () => {
  const files = {
    ...base,
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1"),
    "plans/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1),
  };
  const r = run({ ...files, "plans/2026-01-01-p1/spec-gaps.md": `${GAP(2)}\n${GAP(1)}\n` });
  assert.ok(r.errors.some((e) => e.message === "spec-gaps.md: entry G1 is duplicated or out of order."));
  const archived = run({
    ...base,
    "plans/archive/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1", { status: "done" }),
    "plans/archive/2026-01-01-p1/steps/01-a.md": STEP("2026-01-01-p1", 1, { status: "done" }),
    "plans/archive/2026-01-01-p1/HANDOFF.md": "# HANDOFF — 2026-01-01-p1\n\n## Step 01: S\n\n**Date**: 2026-01-01\n**Outcome**: done\n",
    "plans/archive/2026-01-01-p1/feature-spec-proposals.md": "## P1: anything\n\nfree form\n",
  });
  assert.deepEqual(archived.errors, []);
});

test("plan specs: unresolved is an error, deprecated warns", () => {
  const r = run({
    ...base,
    "specs/features/old.md": feat("feature/old", { status: "deprecated" }),
    "plans/2026-01-01-p1/PLAN.md": PLAN("2026-01-01-p1", { specs: ["feature/old", "feature/gone"] }),
  });
  assert.equal(r.errors.filter((e) => e.type === "reference").length, 1);
  assert.ok(r.warnings.some((w) => w.message.includes("deprecated")));
});

const adr = (n: string, extra: Record<string, unknown> = {}) =>
  spec({ id: `decision/${n}`, title: "D", date: "2026-01-01", status: "accepted", ...extra });

test("ADR rules: duplicate number, id mismatch, superseded_by, related_specs", () => {
  const r = run({
    "decisions/0003-a.md": adr("0003"),
    "decisions/0003-b.md": adr("0003"),
    "decisions/0004-c.md": adr("0005"),
    "decisions/0006-d.md": adr("0006", { status: "superseded", superseded_by: "decision/0099" }),
    "decisions/0007-e.md": adr("0007", { superseded_by: "decision/0003" }),
    "decisions/0008-f.md": adr("0008", { related_specs: ["feature/none"] }),
  });
  const e = msgs(r, "errors").join("\n");
  assert.match(e, /Duplicate ADR number `0003`: `0003-a.md`, `0003-b.md`\. Renumber the later one\./);
  assert.match(e, /ADR file `0004-c\.md` has id `decision\/0005`; the id number must match the filename\./);
  assert.match(e, /ADR `decision\/0006` is superseded by unknown ADR `decision\/0099`\./);
  assert.ok(
    r.warnings.some(
      (w) => w.message === "ADR `decision/0007` has `superseded_by` but status `accepted`.",
    ),
  );
  assert.ok(
    r.warnings.some((w) => w.message === "ADR `decision/0008` references unknown spec `feature/none`."),
  );
});

test("ADR supersession cycle is reported once from its lowest-numbered ADR", () => {
  const r = run({
    "decisions/0001-a.md": adr("0001"),
    "decisions/0002-b.md": adr("0002", { status: "superseded", superseded_by: "decision/0005" }),
    "decisions/0005-e.md": adr("0005", { status: "superseded", superseded_by: "decision/0002" }),
  });
  const cycles = r.errors.filter((e) => e.message.startsWith("Supersession cycle:"));
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].message, "Supersession cycle: `decision/0002` -> `decision/0005` -> `decision/0002`.");
  assert.equal(cycles[0].file, "decisions/0002-b.md");
});

test("freshness: missing AGENTS.md warns; current block does not", async () => {
  const { upsertBlock } = await import("./agents/standing.js");
  assert.ok(run({}).warnings.some((w) => w.type === "freshness"));
  assert.ok(!run({ "AGENTS.md": upsertBlock(null).content }).warnings.some((w) => w.type === "freshness"));
});

test("config errors become a config finding", () => {
  const r = runValidate(makeRepo({ ".specplane/config.yaml": "plans: {merge: nope}\n" }));
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].type, "config");
});

test("config: a missing spec root is a config error", () => {
  const root = makeRepo(
    { ".specplane/config.yaml": "spec_roots:\n  - name: base\n    path: specs\n" },
    { createSpecRoots: false },
  );
  const r = runValidate(root);
  assert.ok(
    r.errors.some((e) => e.type === "config" && e.message === "Spec root `base`: path `specs` does not exist."),
  );
});

test("output formats", () => {
  const r = run({ "specs/features/alpha.md": feat("feature/alpha", {}, "# T\n\nTypeScript\n") });
  const json = JSON.parse(formatJson(r));
  assert.deepEqual(Object.keys(json), ["valid", "errors", "warnings"]);
  assert.equal(json.valid, true);
  assert.equal(json.warnings[0].severity, "warning");
  assert.equal(json.warnings[0].type, "tech_name");
  assert.equal(json.warnings[0].spec, "feature/alpha");
  const human = formatHuman(r);
  assert.match(human, /Checking feature\/alpha\.\.\. 1 warning\n  \[warning\] feature\/alpha:9: Possible architecture detail \(tech_name\): "TypeScript"/);
  assert.match(human, /Summary: \d+ files checked, 0 errors, \d+ warnings?\n$/);
});

test("rules freshness: missing or differing warns; matching does not", async () => {
  const { templatesDir } = await import("./harness/index.js");
  const { upsertBlock } = await import("./agents/standing.js");
  const tpl = fs.readFileSync(path.join(templatesDir("claude"), "rules", "specplane.md"), "utf8");
  const rules = (f: Record<string, string>) => run(f).warnings.filter((w) => w.type === "freshness" && w.file === ".claude/rules/specplane.md");
  const agents = { "AGENTS.md": upsertBlock(null).content };
  assert.equal(rules({ ...agents, ".claude/settings.json": "{}" }).length, 1); // missing
  assert.equal(rules({ ...agents, ".claude/rules/specplane.md": tpl + "x" }).length, 1); // differs
  assert.equal(rules({ ...agents, ".claude/rules/specplane.md": tpl }).length, 0); // matches
  assert.equal(rules(agents).length, 0); // harness not installed
  // the rules file satisfies standing-instruction freshness without AGENTS.md
  assert.ok(!run({ ".claude/rules/specplane.md": tpl }).warnings.some((w) => w.type === "freshness" && w.file === "AGENTS.md"));
});

test("deprecated reference: extends warns, exit status unaffected", () => {
  const r = run({
    "specs/features/alpha.md": feat("feature/alpha", { status: "deprecated" }),
    "ext-specs/features/beta.md": feat("feature/beta", { extends: "feature/alpha" }),
  });
  assert.ok(msgs(r, "warnings").includes("reference: `feature/beta` references deprecated spec `feature/alpha`."));
  assert.equal(r.errors.filter((e) => e.type === "reference").length, 0);
});

test("non-deprecated reference gives no deprecated warning", () => {
  const r = run({
    "specs/features/alpha.md": feat("feature/alpha"),
    "ext-specs/features/beta.md": feat("feature/beta", { extends: "feature/alpha" }),
  });
  assert.ok(!r.warnings.some((w) => w.message.includes("deprecated")));
});
