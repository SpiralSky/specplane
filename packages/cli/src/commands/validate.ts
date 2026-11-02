import { capturePlanSnapshot } from "../generate/snapshot.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkStanding } from "../agents/standing.js";
import { type Harness, HARNESSES, templatesDir } from "../harness/index.js";
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

const STANDING_MSG = (file: string, detail = "") =>
  `Specplane standing instructions in ${file} are missing or out of date; run specplane init.${detail}`;

/** True when the harness's rules file exists and equals its bundled template. */
function rulesFresh(h: Harness, root: string): boolean {
  if (!h.rulesTemplate) return false;
  const abs = path.join(root, h.rulesFile);
  const tpl = path.join(templatesDir(h.name), h.rulesTemplate);
  return fs.existsSync(abs) && fs.existsSync(tpl) && fs.readFileSync(abs).equals(fs.readFileSync(tpl));
}

/**
 * Standing-instructions freshness (type `freshness`): the block in `AGENTS.md` or a fresh rules file of an
 * installed harness satisfies it; each installed harness's rules file must also match its bundled template.
 */
export function checkFreshness(root: string, registry: Harness[] = HARNESSES): ValidationReport {
  const file = "AGENTS.md";
  const abs = path.join(root, file);
  const content = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  const installed = registry.filter((h) => h.detect(root));
  const lines = [undefined, ...registry.map((h) => h.workflowsLine)];
  const states = lines.map((l) => checkStanding(content, l));
  const state = states.includes("ok") ? "ok" : states[0];
  const findings = [];
  const files = [file];
  for (const h of installed) {
    if (!h.rulesTemplate) continue;
    files.push(h.rulesFile);
    if (!rulesFresh(h, root)) findings.push(finding("warning", "freshness", h.rulesFile, STANDING_MSG(h.rulesFile)));
  }
  const delivered = installed.some((h) => rulesFresh(h, root));
  if (state !== "ok" && !delivered) {
    const detail = state === "malformed" ? " (malformed specplane block)" : "";
    findings.unshift(finding("warning", "freshness", file, STANDING_MSG(file, detail)));
  }
  return makeReport(findings, files);
}

/** PLANS.md freshness: the committed file must equal the generated one (type `freshness`). */
export function checkPlansMd(config: Config, root: string): ValidationReport {
  let file = path.join(config.plans.dir, "PLANS.md");
  let expected: string;
  let planCount = 0;
  let excluded: string[] = [];
  try {
    const snapshot = capturePlanSnapshot(root, "head");
    expected = generatePlansMd(snapshot);
    config = snapshot.config;
    file = snapshot.outputPath;
    planCount = snapshot.plans.length;
    excluded = snapshot.excluded;
  } catch {
    return makeReport([], []); // unparsable plans are reported by plan validation
  }
  const abs = plansMdPath(config, root);
  const exists = fs.existsSync(abs);
  if (!exists && planCount === 0) return makeReport([], [file]);
  if (exists && fs.readFileSync(abs, "utf8") === expected) return makeReport([], [file]);
  const why = exists ? "is out of date" : "is missing";
  return makeReport([finding("warning", "freshness", file, `${file} ${why} (source: head${excluded.length ? `; excluded pending inputs: ${excluded.join(", ")}` : ""}); run specplane plan index.`)], [file]);
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
  if (opts.json) process.stdout.write(formatJson(report));
  else process.stderr.write(formatHuman(report));
  process.exitCode = report.valid ? 0 : 1;
}

