import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { checkPlansMd } from "../commands/validate.js";
import { runInit } from "../commands/init.js";
import { loadConfig } from "../config.js";
import { blockedReason, getIndexStatus } from "../plan/status.js";
import { makeRepo } from "../test-repo.js";
import { toMermaid } from "./mermaid.js";
import { generatePlansMd } from "./plans-md.js";

const plan = (id: string, status: string, deps: string[] = []) =>
  `---\nid: ${id}\ntitle: Title ${id}\nstatus: ${status}\nspecs: [feature/alpha]\n${deps.length ? `depends_on: [${deps.join(", ")}]\n` : ""}---\n# P\n`;

const A = "2026-01-01-alpha", B = "2026-01-02-beta", C = "2026-01-03-gamma";
const files = {
  [`plans/${B}/PLAN.md`]: plan(B, "ready", [A, C]),
  [`plans/${C}/PLAN.md`]: plan(C, "draft"),
  [`plans/archive/${A}/PLAN.md`]: plan(A, "done"),
};

test("getIndexStatus", () => {
  const root = makeRepo({});
  const { config } = loadConfig(root);
  const m = new Map([["x", { status: "ready" as const }], ["d", { status: "done" as const }]]);
  assert.equal(getIndexStatus({ status: "draft" }, m, config), "draft");
  assert.equal(getIndexStatus({ status: "ready", depends_on: ["x"] }, m, config), "blocked");
  assert.equal(getIndexStatus({ status: "ready", depends_on: ["d"] }, m, config), "ready");
  assert.equal(getIndexStatus({ status: "ready" }, m, config), "ready");
  const stack = { ...config, plans: { ...config.plans, dependency_mode: "stack" as const } };
  const two = new Map([["x", { status: "ready" as const }], ["y", { status: "ready" as const }], ["d", { status: "done" as const }]]);
  assert.equal(getIndexStatus({ status: "ready", depends_on: ["x"] }, m, stack), "ready");
  assert.equal(getIndexStatus({ status: "ready", depends_on: ["d", "x"] }, two, stack), "ready");
  assert.equal(getIndexStatus({ status: "ready", depends_on: ["x", "y"] }, two, stack), "blocked");
  assert.equal(getIndexStatus({ status: "ready", depends_on: ["x", "y"] }, two, config), "blocked");
  assert.equal(blockedReason({ depends_on: ["x", "y"] }, two, stack), "Cannot stack on more than one unmerged dependency: `x`, `y`.");
  assert.equal(blockedReason({ depends_on: ["d", "x"] }, two, stack), null);
  assert.equal(blockedReason({ depends_on: ["x"] }, two, config), null);
});

test("toMermaid: node classes, edges after nodes, classDefs", () => {
  const g = new Map([["2026-01-01-a", []], ["2026-01-02-b", ["2026-01-01-a"]]]);
  const out = toMermaid(g, new Map([["2026-01-01-a", "done"], ["2026-01-02-b", "blocked"]]));
  const lines = out.split("\n");
  assert.equal(lines[0], "graph TD");
  assert.equal(lines[1], "    p_2026_01_01_a[a]:::done");
  assert.equal(lines[2], "    p_2026_01_02_b[b]:::blocked");
  assert.equal(lines[3], "    p_2026_01_01_a --> p_2026_01_02_b");
  assert.equal(lines.filter((l) => l.includes("classDef")).length, 7);
});

test("generatePlansMd: sections, blocked status, links, determinism", () => {
  const root = makeRepo(files);
  const { config } = loadConfig(root);
  const md = generatePlansMd(config, root);
  assert.ok(md.startsWith("<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane generate -->\n\n# Plans\n"));
  assert.ok(md.includes(`| [${B}](${B}/PLAN.md) | Title ${B} | blocked | [${A}](archive/${A}/PLAN.md), [${C}](${C}/PLAN.md) | feature/alpha |`));
  assert.ok(md.includes(`| [${A}](archive/${A}/PLAN.md) | Title ${A} | done | feature/alpha |`));
  assert.ok(md.includes("p_2026_01_02_beta[beta]:::blocked"));
  assert.equal(generatePlansMd(config, root), md);
});

test("generatePlansMd: stack mode blocks a ready plan with two unmerged dependencies", () => {
  const root = makeRepo({
    ".specplane/config.yaml": "spec_roots:\n  - name: base\n    path: docs/specifications\nplans:\n  dependency_mode: stack\n",
    "plans/2026-01-01-alpha/PLAN.md": plan(A, "ready"),
    "plans/2026-01-02-beta/PLAN.md": plan(B, "ready"),
    "plans/2026-01-03-gamma/PLAN.md": plan(C, "ready", [A, B]),
  });
  const md = generatePlansMd(loadConfig(root).config, root);
  assert.match(md, new RegExp(`\\| \\[${C}\\]\\(${C}/PLAN\\.md\\) \\| Title ${C} \\| blocked \\|`));
});

test("generatePlansMd: empty sections render _None._", () => {
  const root = makeRepo({});
  const md = generatePlansMd(loadConfig(root).config, root);
  assert.equal(md.split("_None._").length - 1, 2);
});

test("PLANS.md freshness warning", () => {
  const root = makeRepo(files);
  const { config } = loadConfig(root);
  assert.equal(checkPlansMd(config, root).warnings.length, 1); // missing
  fs.writeFileSync(path.join(root, "plans", "PLANS.md"), generatePlansMd(config, root));
  assert.equal(checkPlansMd(config, root).warnings.length, 0);
  fs.appendFileSync(path.join(root, "plans", "PLANS.md"), "x\n");
  assert.equal(checkPlansMd(config, root).warnings[0].type, "freshness");
});

test("init: creates files, preserves AGENTS.md text, idempotent", () => {
  const root = makeRepo({ "AGENTS.md": "# Mine\n\nhand-written\n" });
  const first = runInit(root);
  assert.ok(first.includes("Created .specplane/config.yaml"));
  assert.ok(first.includes("Created docs/specifications/features/INFO.md"));
  assert.ok(first.includes("Created docs/specifications/architecture/INFO.md"));
  assert.ok(first.includes("Updated AGENTS.md (appended Specplane block)"));
  assert.ok(first.includes("Created plans/.gitkeep"));
  const after1 = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.ok(after1.startsWith("# Mine\n\nhand-written\n"));
  const second = runInit(root);
  assert.ok(
    second.filter((l) => !l.startsWith("No `.claude/`")).every((l) => l.startsWith("Skipped")),
    second.join("\n"),
  );
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), after1);
  loadConfig(root); // generated default config is valid
});

test("init: scaffolds spec roots that do not exist yet", () => {
  const root = makeRepo({}, { createSpecRoots: false });
  const lines = runInit(root);
  assert.ok(lines.includes("Created .specplane/config.yaml"));
  assert.ok(lines.includes("Created docs/specifications/features/INFO.md"));
  assert.ok(fs.statSync(path.join(root, "docs/specifications")).isDirectory());
});

test("init: uses existing config paths and skips non-empty plans dir", () => {
  const root = makeRepo({
    ".specplane/config.yaml": "spec_roots:\n  - name: base\n    path: specs\nplans:\n  dir: work\n",
    "work/x/PLAN.md": "x",
  });
  const lines = runInit(root);
  assert.ok(lines.includes("Created specs/features/INFO.md"));
  assert.ok(lines.some((l) => l.startsWith("Skipped work/.gitkeep")));
  assert.ok(lines.includes("Skipped .specplane/config.yaml (already exists)"));
});
