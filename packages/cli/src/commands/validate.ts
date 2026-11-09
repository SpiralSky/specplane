import { releaseIdentity, standingBlockReasons } from "../docs/freshness.js";
import { capturePlanSnapshot, hasRecoveryOperation, type PlanSnapshot } from "../generate/snapshot.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkStanding, withDecisionFraming } from "../agents/standing.js";
import { type Harness, HARNESSES, templatesDir } from "../harness/index.js";
import { generatePlansMd } from "../generate/plans-md.js";
import { checkoutRoot } from "../git/repo.js";
import { configuredFraming } from "../config.js";
import { finding, makeReport } from "../report.js";
import { formatReport, validateProject } from "../verify/validate.js";
import type { Config, ValidationReport } from "../types.js";

const STANDING_MSG = (file: string, detail = "") =>
  `Specplane standing instructions in ${file} are missing or out of date; run specplane init.${detail}`;

/** True when the harness's rules file exists and equals its bundled template. */
function rulesFresh(h: Harness, root: string): boolean {
  if (!h.rulesTemplate) return false;
  const abs = path.join(root, h.rulesFile);
  const tpl = path.join(templatesDir(h.name), h.rulesTemplate);
  if (!fs.existsSync(abs) || !fs.existsSync(tpl)) return false;
  return fs.readFileSync(abs, "utf8") === withDecisionFraming(fs.readFileSync(tpl, "utf8"), configuredFraming(root));
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
  const framing = configuredFraming(root);
  let state = checkStanding(content, framing);
  // Version/hash metadata embedded by an explicit refresh: stale release identity or an edited block is reported, never repaired.
  if (state === "ok") {
    try {
      if (standingBlockReasons(content, releaseIdentity(), framing).state === "stale") state = "outdated";
    } catch {
      // A damaged documentation bundle is reported by `specplane docs`; it does not make the standing block stale.
    }
  }
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
export function checkPlansMd(config: Config | undefined, root: string, selected?: PlanSnapshot, notice?: (message: string) => void): ValidationReport {
  let file = path.join(config?.plans.dir ?? "plans", "PLANS.md");
  let expected: string;
  let planCount = 0;
  let excluded: string[] = [];
  let source = selected?.source ?? "head";
  try {
    if (!selected && hasRecoveryOperation(root)) source = "staged";
    const snapshot = selected ?? capturePlanSnapshot(root, source as "head" | "staged");
    expected = generatePlansMd(snapshot);
    config = snapshot.config;
    file = snapshot.outputPath;
    planCount = snapshot.plans.length;
    excluded = snapshot.excluded;
    notice?.(`plan index freshness source: ${snapshot.source}${excluded.length ? `; excluded pending inputs: ${excluded.join(", ")}` : ""}`);
    if (snapshot.source === "staged" && snapshot.outputUnmerged) {
      return makeReport([finding("warning", "freshness", file, `${file} is conflicted (source: staged); run specplane plan index --source staged, then stage ${file}.`)], [file]);
    }
    if (snapshot.outputBytes == null && planCount === 0) return makeReport([], [file]);
    if (snapshot.outputBytes?.equals(Buffer.from(expected))) return makeReport([], [file]);
    const why = snapshot.outputBytes == null ? "is missing" : "is out of date";
    return makeReport([finding("warning", "freshness", file, `${file} ${why} (source: ${snapshot.source}${excluded.length ? `; excluded pending inputs: ${excluded.join(", ")}` : ""}); run specplane plan index${snapshot.source === "staged" ? " --source staged" : ""}.`)], [file]);
  } catch (e) {
    notice?.(`plan index freshness source: ${source}`);
    return makeReport([finding("error", "freshness", file, `Cannot check plan index freshness (source: ${source}): ${(e as Error).message}`)], [file]);
  }
}

export function validateCommand(ids: string[], opts: { json?: boolean }): void {
  const report = validateProject(checkoutRoot(), { ids });
  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stderr.write(formatReport(report));
  process.exitCode = report.counts.errors === 0 ? 0 : 1;
}
