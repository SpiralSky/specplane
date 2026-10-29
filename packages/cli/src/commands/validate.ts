import * as fs from "node:fs";
import * as path from "node:path";
import { checkStanding } from "../agents/standing.js";
import { HARNESSES } from "../harness/index.js";
import { CONFIG_PATH, loadConfig } from "../config.js";
import { loadAdrs, validateAdrs } from "../decisions/validate.js";
import { ConfigError, FrontmatterError, FrontmatterMissingError } from "../errors.js";
import { generatePlansMd, plansMdPath } from "../generate/plans-md.js";
import { checkoutRoot } from "../git/repo.js";
import { formatHuman } from "../output/human.js";
import { formatJson } from "../output/json.js";
import { listPlans } from "../plan/resolve.js";
import { validatePlans } from "../plan/validate.js";
import { finding, makeReport, mergeReports } from "../report.js";
import { checkSkillDrift } from "../spec/skill-drift.js";
import { validateSpecs } from "../spec/validate.js";
import type { Config, ValidationReport } from "../types.js";

/** Standing-instructions freshness check (type `freshness`). */
export function checkFreshness(root: string): ValidationReport {
  const file = "AGENTS.md";
  const abs = path.join(root, file);
  const content = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  const lines = [undefined, ...HARNESSES.map((h) => h.workflowsLine)];
  const states = lines.map((l) => checkStanding(content, l));
  const state = states.includes("ok") ? "ok" : states[0];
  if (state === "ok") return makeReport([], [file]);
  const detail = state === "malformed" ? " (malformed specplane block)" : "";
  return makeReport(
    [finding("warning", "freshness", file, `Specplane standing instructions in ${file} are missing or out of date; run specplane init.${detail}`)],
    [file],
  );
}

/** PLANS.md freshness: the committed file must equal the generated one (type `freshness`). */
export function checkPlansMd(config: Config, root: string): ValidationReport {
  const file = path.join(config.plans.dir, "PLANS.md");
  let expected: string;
  try {
    expected = generatePlansMd(config, root);
  } catch {
    return makeReport([], []); // unparsable plans are reported by plan validation
  }
  const abs = plansMdPath(config, root);
  const exists = fs.existsSync(abs);
  if (!exists && listPlans(config, root).length === 0) return makeReport([], [file]);
  if (exists && fs.readFileSync(abs, "utf8") === expected) return makeReport([], [file]);
  const why = exists ? "is out of date" : "is missing";
  return makeReport([finding("warning", "freshness", file, `${file} ${why}; run specplane generate.`)], [file]);
}

/** Run every validation and merge the results. */
export function runValidate(root: string): ValidationReport {
  let loaded;
  try {
    loaded = loadConfig(root);
  } catch (e) {
    if (e instanceof ConfigError || e instanceof FrontmatterError || e instanceof FrontmatterMissingError) {
      return makeReport([finding("error", "config", CONFIG_PATH, e.message)], [CONFIG_PATH]);
    }
    throw e;
  }
  const { config, warnings } = loaded;
  const configReport = makeReport(
    warnings.map((w) => finding("warning", "config", CONFIG_PATH, w.message)),
    [CONFIG_PATH],
  );
  const specs = validateSpecs(config, root);
  const { adrs, findings: adrLoad } = loadAdrs(config, root);
  const adrReport = validateAdrs(adrs, config, root, adrLoad);
  const plans = validatePlans(listPlans(config, root), adrs, config, root);
  return mergeReports(configReport, specs, adrReport, plans, checkFreshness(root), checkPlansMd(config, root), makeReport(checkSkillDrift(config, root)));
}

export function validateCommand(opts: { json?: boolean }): void {
  const report = runValidate(checkoutRoot());
  process.stdout.write(opts.json ? formatJson(report) : formatHuman(report));
  process.exitCode = report.valid ? 0 : 1;
}

