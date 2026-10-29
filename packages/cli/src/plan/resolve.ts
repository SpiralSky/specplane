import * as fs from "node:fs";
import * as path from "node:path";
import { PlanNotFoundError } from "../errors.js";
import type { Config } from "../types.js";

export interface PlanRecord {
  /** Plan ID (folder name). */
  id: string;
  /** Absolute plan directory. */
  dir: string;
  /** Absolute path of PLAN.md. */
  planFile: string;
  archived: boolean;
}

function scan(dir: string, archived: boolean): PlanRecord[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !(d.name === "archive" && !archived))
    .map((d) => ({ id: d.name, dir: path.join(dir, d.name), planFile: path.join(dir, d.name, "PLAN.md"), archived }))
    .filter((p) => fs.existsSync(p.planFile));
}

/** Every `<plans.dir>/<id>/PLAN.md` and `<plans.dir>/archive/<id>/PLAN.md`, sorted by ID. */
export function listPlans(config: Config, root: string): PlanRecord[] {
  const plansDir = path.join(root, config.plans.dir);
  return [...scan(plansDir, false), ...scan(path.join(plansDir, "archive"), true)].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** Directory of a plan, active or archived. Throws PlanNotFoundError. */
export function planDir(planId: string, config: Config, root: string): string {
  const found = listPlans(config, root).find((p) => p.id === planId);
  if (!found) throw new PlanNotFoundError(planId);
  return found.dir;
}
