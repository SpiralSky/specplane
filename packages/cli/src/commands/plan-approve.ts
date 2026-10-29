import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.js";
import { loadAdrs } from "../decisions/validate.js";
import {
  ApprovalRefusedError,
  PlanStateError,
  UncommittedChangesError,
  reportError,
} from "../errors.js";
import { readFrontmatter, writeStatus } from "../frontmatter.js";
import { generatePlansMd, plansMdPath } from "../generate/plans-md.js";
import { abbrev, hasUncommittedChanges } from "../git/blobs.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { checkoutRoot } from "../git/repo.js";
import { formatHuman } from "../output/human.js";
import { parsePlan } from "../plan/parse.js";
import { listPlans, planDir } from "../plan/resolve.js";
import { validatePlans } from "../plan/validate.js";
import { makeReport } from "../report.js";
import { resolveSpecId } from "../spec/resolve.js";
import { displayId } from "../spec/pins.js";
import { loadSpecs } from "../spec/validate.js";
import type { Config } from "../types.js";

const toPosix = (p: string) => p.split(path.sep).join("/");

/** Stage the given files and commit them with the `approve` workflow; returns the short SHA. */
function commitFiles(root: string, files: string[], scope: string, summary: string): string {
  const trailers = cliTrailers("approve", "");
  const msg = formatMessage({ type: "docs", scope, summary, trailers });
  run("git", ["add", "--", ...files], { cwd: root });
  run("git", ["commit", "-F", "-", "--", ...files], { cwd: root, input: msg });
  return abbrev(run("git", ["rev-parse", "HEAD"], { cwd: root }).trim(), root);
}

/** `plans.require_approved_specs` (`feature/configuration` § `plans.require_approved_specs`). */
function checkRequiredSpecs(planId: string, specs: string[], config: Config, root: string): void {
  const policy = config.plans.require_approved_specs;
  if (policy === "none") return;
  const loaded = loadSpecs(config, root).specs;
  for (const raw of specs) {
    const resolved = resolveSpecId(raw, config, undefined, root);
    const spec = loaded.find((s) => s.file === resolved.path);
    const id = spec ? displayId(spec) : resolved.id;
    if (policy === "feature" && !resolved.id.startsWith("feature/")) continue;
    const status = String(readFrontmatter(resolved.path).data.status ?? "unknown");
    if (status !== "approved") {
      throw new ApprovalRefusedError(`Cannot approve \`${planId}\`: \`${id}\` is \`${status}\`, not \`approved\`.`);
    }
  }
}

function approveOne(rawId: string, config: Config, root: string, dryRun: boolean): boolean {
  const dir = planDir(rawId, config, root);
  const id = path.basename(dir);
  const fm = parsePlan(dir).frontmatter;
  if (fm.status !== "draft") {
    throw new PlanStateError(`Plan \`${id}\` is \`${fm.status}\`; only \`draft\` plans can be approved.`);
  }
  const planRel = toPosix(path.relative(root, dir));
  if (hasUncommittedChanges(planRel, root)) throw new UncommittedChangesError(planRel);

  checkRequiredSpecs(id, fm.specs, config, root);

  const { adrs } = loadAdrs(config, root);
  const report = validatePlans(listPlans(config, root), adrs, config, root);
  const errors = report.errors.filter((f) => f.plan === id);
  if (errors.length > 0) {
    process.stderr.write(formatHuman(makeReport(errors, [id])));
    process.exitCode = 1;
    return false;
  }

  const plansRel = toPosix(path.relative(root, plansMdPath(config, root)));
  if (dryRun) {
    process.stdout.write(`would approve ${id}\n`);
    process.stdout.write(`would regenerate ${plansRel}\n`);
    process.stdout.write(`would commit docs(${id}): approve plan\n`);
    return true;
  }

  const planFile = path.join(dir, "PLAN.md");
  writeStatus(planFile, "ready");
  fs.writeFileSync(plansMdPath(config, root), generatePlansMd(config, root));

  const sha = commitFiles(root, [toPosix(path.relative(root, planFile)), plansRel], id, "approve plan");
  process.stdout.write(`approved ${id} ${sha}\n`);
  return true;
}

export function planApproveCommand(ids: string[], opts: { dryRun?: boolean }): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    for (const id of ids) {
      if (!approveOne(id, config, root, opts.dryRun === true)) return;
    }
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
