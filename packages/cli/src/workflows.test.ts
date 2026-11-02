import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url)); // packages/cli/dist
const repoRoot = path.resolve(here, "..", "..", "..");
const load = (name: string) =>
  yaml.load(fs.readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8")) as any;

test("specplane-validate.yml parses and runs specplane validate", () => {
  const wf = load("specplane-validate.yml");
  assert.deepEqual(wf.on.push.branches, ["**"]);
  assert.deepEqual(wf.on.pull_request.branches, ["main"]);
  const runs = wf.jobs.validate.steps.map((s: any) => s.run);
  assert.ok(runs.includes("specplane validate"));
});

test("specplane-generate.yml parses, filters paths, and commits only on change", () => {
  const wf = load("specplane-generate.yml");
  assert.deepEqual(wf.on.push.branches, ["main"]);
  assert.equal(wf.concurrency.group, "specplane-generate-${{ github.ref }}");
  assert.equal(wf.jobs.generate.steps[0].with.ref, "${{ github.ref }}");
  assert.ok(wf.jobs.generate.steps.some((s: any) => s.run === "specplane plan index --source head"));
  assert.deepEqual(wf.on.push.paths, ["**/PLAN.md", ".specplane/config.yaml"]);
  assert.equal(wf.jobs.generate.permissions.contents, "write");
  const commit = wf.jobs.generate.steps.find((s: any) => s.name === "Commit if changed").run as string;
  assert.match(commit, /git diff --cached --quiet/);
  assert.match(commit, /chore\(specplane\): regenerate PLANS\.md \[skip ci\]/);
  assert.match(commit, /Specplane-Workflow: generate/);
  assert.match(commit, /Specplane-Agent: ci/);
});

test(".gitattributes marks PLANS.md as generated", () => {
  const ga = fs.readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
  assert.match(ga, /^PLANS\.md linguist-generated=true$/m);
});
