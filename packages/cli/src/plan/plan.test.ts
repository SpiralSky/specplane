import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../config.js";
import { FrontmatterError, PlanNotFoundError } from "../errors.js";
import { fixture } from "../fixtures.js";
import { listStepFiles, parsePlan, parseStep } from "./parse.js";
import { listPlans, planDir } from "./resolve.js";

const root = fixture("plans-repo");
const sample = path.join(root, "plans/2026-01-01-sample");

test("listPlans finds active and archived plans", () => {
  const plans = listPlans(DEFAULT_CONFIG, root);
  assert.deepEqual(plans.map((p) => [p.id, p.archived]), [["2025-12-31-old", true], ["2026-01-01-sample", false]]);
});

test("planDir resolves active and archived, throws for unknown", () => {
  assert.equal(planDir("2026-01-01-sample", DEFAULT_CONFIG, root), sample);
  assert.equal(planDir("2025-12-31-old", DEFAULT_CONFIG, root), path.join(root, "plans/archive/2025-12-31-old"));
  assert.throws(() => planDir("2020-01-01-none", DEFAULT_CONFIG, root), PlanNotFoundError);
});

test("listPlans returns [] when the plans directory is absent", () => {
  assert.deepEqual(listPlans(DEFAULT_CONFIG, fixture("configs")), []);
});

test("parsePlan returns typed frontmatter", () => {
  const { frontmatter, body } = parsePlan(sample);
  assert.equal(frontmatter.status, "ready");
  assert.deepEqual(frontmatter.specs, ["feature/spec-system"]);
  assert.match(body, /## Goal/);
  assert.equal(parsePlan(path.join(root, "plans/archive/2025-12-31-old")).frontmatter.status, "done");
});

test("parseStep returns typed frontmatter with context", () => {
  const files = listStepFiles(sample);
  assert.equal(files.length, 2);
  const { frontmatter } = parseStep(files[0]);
  assert.equal(frontmatter.step, 1);
  assert.equal(frontmatter.use_subagent, true);
  assert.deepEqual(frontmatter.context, [
    { spec: "architecture/reference-cli#Config loading" },
    { decision: "decision/0001" },
    { file: "src/" },
  ]);
});

test("parseStep rejects a step number that mismatches the filename", () => {
  assert.throws(() => parseStep(listStepFiles(sample)[1]), (e) => e instanceof FrontmatterError && /prefix/.test(e.message));
});

test("parsePlan/parseStep reject id and plan mismatches", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-plan-"));
  const dir = path.join(tmp, "2026-02-02-other");
  fs.mkdirSync(path.join(dir, "steps"), { recursive: true });
  fs.copyFileSync(path.join(sample, "PLAN.md"), path.join(dir, "PLAN.md"));
  fs.copyFileSync(path.join(sample, "steps/01-first.md"), path.join(dir, "steps/01-first.md"));
  assert.throws(() => parsePlan(dir), (e) => e instanceof FrontmatterError && /folder name/.test(e.message));
  assert.throws(() => parseStep(path.join(dir, "steps/01-first.md")), (e) => e instanceof FrontmatterError && /plan folder/.test(e.message));
  fs.rmSync(tmp, { recursive: true });
});
