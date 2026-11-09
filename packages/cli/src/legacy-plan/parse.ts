import * as fs from "node:fs";
import * as path from "node:path";
import { FrontmatterError } from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
import { PLAN_SCHEMA, STEP_SCHEMA, describeErrors, validator } from "../schemas.js";
import type { PlanFrontmatter, StepFrontmatter } from "../types.js";

function check(file: string, schema: object, data: unknown): void {
  const v = validator(schema);
  if (!v(data)) throw new FrontmatterError(file, describeErrors(v.errors));
}

/** Parse `<planDir>/PLAN.md`; `id` must equal the folder name. */
export function parsePlan(planDir: string): { frontmatter: PlanFrontmatter; body: string; dir: string } {
  const file = path.join(planDir, "PLAN.md");
  const { data, body } = readFrontmatter(file);
  check(file, PLAN_SCHEMA, data);
  const folder = path.basename(path.resolve(planDir));
  if (data.id !== folder) {
    throw new FrontmatterError(file, `\`id\` \`${data.id}\` does not match the folder name \`${folder}\``);
  }
  return { frontmatter: data as unknown as PlanFrontmatter, body, dir: planDir };
}

/** Step files of a plan (`steps/NN-*.md`), sorted by name. */
export function listStepFiles(planDir: string): string[] {
  const dir = path.join(planDir, "steps");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Parse a step file; `step` must equal the filename prefix and `plan` the plan folder name. */
export function parseStep(stepFile: string): { frontmatter: StepFrontmatter; body: string; file: string } {
  const { data, body } = readFrontmatter(stepFile);
  check(stepFile, STEP_SCHEMA, data);
  const prefix = /^(\d+)-/.exec(path.basename(stepFile));
  if (!prefix) throw new FrontmatterError(stepFile, "file name must start with a numeric prefix (`NN-`)");
  if (data.step !== Number(prefix[1])) {
    throw new FrontmatterError(stepFile, `\`step\` ${data.step} does not match the file name prefix \`${prefix[1]}\``);
  }
  const planId = path.basename(path.dirname(path.dirname(path.resolve(stepFile))));
  if (data.plan !== planId) {
    throw new FrontmatterError(stepFile, `\`plan\` \`${data.plan}\` does not match the plan folder \`${planId}\``);
  }
  return { frontmatter: data as unknown as StepFrontmatter, body, file: stepFile };
}
