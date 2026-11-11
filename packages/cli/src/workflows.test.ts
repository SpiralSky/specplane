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
