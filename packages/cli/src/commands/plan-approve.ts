import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { withApprovalReadTree } from "./approval-read-tree.js";
import { acquireWriterLease, inspectWriterLease } from "../core/writer-leases.js";
import { capturePlanSnapshot, prospectivePlanSnapshot, recheckPlanSnapshot } from "../generate/snapshot.js";
import { loadConfig } from "../config.js";
import { loadAdrs } from "../decisions/validate.js";
import {
  ApprovalRefusedError,
  PlanStateError,
  UncommittedChangesError,
  reportError,
} from "../errors.js";
import { readFrontmatter } from "../frontmatter.js";
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

function approveOne(rawId: string, discovery: Config, root: string, dryRun: boolean): boolean {
  const request = { repository: true, plans: [rawId], checkouts: [root], requestId: `approve-${randomUUID()}` };
  const lease = dryRun ? null : acquireWriterLease(request);
  if (dryRun) inspectWriterLease(request);
  try {
  const snapshot = capturePlanSnapshot(root, "head");
  const head = snapshot.identity;
  const branch = run("git", ["symbolic-ref", "HEAD"], { cwd: root }).trim();
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const markerPath = run("git", ["rev-parse", "--path-format=absolute", "--git-path", marker], { cwd: root }).trim();
    if (fs.existsSync(markerPath)) throw new PlanStateError("Cannot approve during an unfinished Git operation.");
  }
  const config = snapshot.config;
  if (discovery.plans.dir !== config.plans.dir || discovery.decisions.dir !== config.decisions.dir || !isDeepStrictEqual(discovery.spec_roots, config.spec_roots)) {
    throw new PlanStateError("Working configuration paths differ from HEAD; reconcile plans.dir, decisions.dir and spec_roots before approval.");
  }
  for (const p of [config.plans.dir, config.decisions.dir, ...config.spec_roots.map(r => r.path)]) {
    if (path.isAbsolute(p) || path.relative(root, path.resolve(root, p)).startsWith("..")) throw new PlanStateError(`Approval configuration path must stay inside the repository: ${p}`);
  }
  const validation = withApprovalReadTree(root, head, tree => {
    const dir = planDir(rawId, config, tree);
    const id = path.basename(dir);
    const fm = parsePlan(dir).frontmatter;
    if (fm.status !== "draft") throw new PlanStateError(`Plan \`${id}\` is \`${fm.status}\`; only \`draft\` plans can be approved.`);
    checkRequiredSpecs(id, fm.specs, config, tree);
    const { adrs } = loadAdrs(config, tree);
    const report = validatePlans(listPlans(config, tree), adrs, config, tree);
    return { id, planRel: toPosix(path.relative(tree, dir)), errors: report.errors.filter(f => f.plan === id) };
  });
  const { id, planRel, errors } = validation;
  const planRelFile = `${planRel}/PLAN.md`;
  const dir = path.join(root, planRel);
  const captured = snapshot.plans.find(p => p.path === planRelFile);
  if (!captured || hasUncommittedChanges(planRelFile, root) || !fs.existsSync(path.join(dir, "PLAN.md")) || !captured.bytes.equals(fs.readFileSync(path.join(dir, "PLAN.md")))) throw new UncommittedChangesError(planRelFile);
  if (errors.length > 0) {
    process.stderr.write(formatHuman(makeReport(errors, [id])));
    process.exitCode = 1;
    return false;
  }

  const plansRel = toPosix(path.relative(root, plansMdPath(config, root)));
  // Git status may hide assume-unchanged or skip-worktree files: compare both
  // owned index entries and working bytes directly to the captured tree.
  const treeEntry = run("git", ["ls-tree", "-z", head, "--", plansRel], { cwd: root });
  const indexEntry = run("git", ["ls-files", "--stage", "-z", "--", plansRel], { cwd: root });
  const treeMatch = /^(100644|100755) blob ([0-9a-f]+)\t/.exec(treeEntry);
  const indexMatch = /^(100644|100755) ([0-9a-f]+) 0\t/.exec(indexEntry);
  const outputPath = path.join(root, plansRel);
  const outputExists = fs.existsSync(outputPath);
  const expectedOutput = treeMatch ? run("git", ["cat-file", "blob", treeMatch[2]], { cwd: root, binary: true }) : null;
  if ((treeEntry && !treeMatch) || (indexEntry && !indexMatch) || (treeMatch?.[1] ?? null) !== (indexMatch?.[1] ?? null) || (treeMatch?.[2] ?? null) !== (indexMatch?.[2] ?? null) || (expectedOutput === null ? outputExists : !outputExists || !fs.readFileSync(outputPath).equals(expectedOutput)) || hasUncommittedChanges(plansRel, root) || run("git", ["status", "--porcelain", "--ignored", "--", plansRel], { cwd: root }).trim()) throw new UncommittedChangesError(plansRel);
  if (snapshot.outputPath !== plansRel) throw new PlanStateError("Working config differs from HEAD.");

  const planFile = path.join(dir, "PLAN.md");
  const output = plansMdPath(config, root);
  if (snapshot.outputPath !== plansRel) throw new PlanStateError("Working config differs from HEAD.");
  const original = captured.bytes.toString("utf8");
  const header = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(original);
  if (!header || !/^status\s*:/m.test(header[2])) throw new PlanStateError("Cannot safely edit plan status.");
  const changed = original.slice(0, header.index) + header[1] + header[2].replace(/^status\s*:[^\r\n]*/m, "status: ready") + header[3] + original.slice(header.index + header[0].length);
  if (changed === original) throw new PlanStateError("Cannot safely edit plan status.");
  const generated = generatePlansMd(prospectivePlanSnapshot(root, snapshot, new Map([[planRelFile, Buffer.from(changed)]])));
  if (dryRun) {
    process.stdout.write(`would approve ${id}\n`);
    process.stdout.write(`would regenerate ${plansRel}\n`);
    process.stdout.write(`would commit docs(${id}): approve plan\n`);
    return true;
  }

  const oldOutput = fs.existsSync(output) ? fs.readFileSync(output) : null;
  let attemptedPlan = false, attemptedOutput = false, wrotePlan = false, wroteOutput = false, staged = false, committed = false, created: string | null = null;
  const git = (...args: string[]) => run("git", args, { cwd: root }).trim();
  const otherIndex = () => run("git", ["diff", "--cached", "--binary", "--", `:(exclude)${planRelFile}`, `:(exclude)${plansRel}`], { cwd: root });
  const beforeIndex = otherIndex();
  try {
    lease!.assertOwned();
    recheckPlanSnapshot(root, snapshot);
    if (git("symbolic-ref", "HEAD") !== branch || !fs.existsSync(planFile) || !fs.readFileSync(planFile).equals(captured.bytes) || hasUncommittedChanges(planRelFile, root) || hasUncommittedChanges(plansRel, root)) throw new Error("Checkout branch or owned inputs changed.");
    attemptedPlan = true; fs.writeFileSync(planFile, changed); wrotePlan = true;
    attemptedOutput = true; fs.writeFileSync(output, generated); wroteOutput = true;
    lease!.assertOwned();
    if (git("rev-parse", "HEAD") !== head || git("symbolic-ref", "HEAD") !== branch || otherIndex() !== beforeIndex || fs.readFileSync(planFile, "utf8") !== changed || fs.readFileSync(output, "utf8") !== generated) throw new Error("Approval inputs changed before staging.");
    staged = true; git("add", "--", planRelFile, plansRel);
    if (otherIndex() !== beforeIndex || run("git", ["show", `:${planRelFile}`], { cwd: root }) !== changed || run("git", ["show", `:${plansRel}`], { cwd: root }) !== generated) throw new Error("Approval index changed before commit.");
    lease!.assertOwned();
    if (git("rev-parse", "HEAD") !== head || git("symbolic-ref", "HEAD") !== branch) throw new Error("Approval ref changed before commit.");
    const format = git("rev-parse", "--show-object-format");
    const len = format === "sha1" ? 40 : format === "sha256" ? 64 : 0;
    if (!len) throw new Error(`Unsupported Git object format: ${format}.`);
    const msg = formatMessage({ type: "docs", scope: id, summary: "approve plan", trailers: cliTrailers("approve", "") });
    const stdout = run("git", ["-c", `core.abbrev=${len}`, "commit", "-F", "-", "--", planRelFile, plansRel], { cwd: root, input: msg });
    committed = true;
    created = [...stdout.matchAll(new RegExp(`^\\[[^\\n]* ([0-9a-f]{${len}})\\]`, "gm"))].at(-1)?.[1] ?? null;
    lease!.assertOwned();
    if (!created || git("rev-parse", "HEAD") !== created || git("symbolic-ref", "HEAD") !== branch || git("rev-list", "--parents", "-n", "1", created) !== `${created} ${head}` || run("git", ["show", `${created}:${planRelFile}`], { cwd: root }) !== changed || run("git", ["show", `${created}:${plansRel}`], { cwd: root }) !== generated || otherIndex() !== beforeIndex || git("diff-tree", "--no-commit-id", "--name-only", "-r", created).split("\n").sort().join("\n") !== [planRelFile, plansRel].sort().join("\n") || fs.readFileSync(planFile, "utf8") !== changed || fs.readFileSync(output, "utf8") !== generated) throw new Error("Committed approval or checkout changed during hooks.");
    process.stdout.write(`approved ${id} ${abbrev(created, root)}\n`);
  } catch (error) {
    if (committed || git("rev-parse", "HEAD") !== head) throw new PlanStateError(`Approval commit ${created ?? "identity unavailable"} retained; inspect recovery state: ${String(error)}`);
    const planSafe = fs.existsSync(planFile) && fs.readFileSync(planFile, "utf8") === changed;
    const outputSafe = fs.existsSync(output) && fs.readFileSync(output, "utf8") === generated;
    let indexSafe = false;
    try { indexSafe = otherIndex() === beforeIndex && (!staged || (run("git", ["show", `:${planRelFile}`], { cwd: root }) === changed && run("git", ["show", `:${plansRel}`], { cwd: root }) === generated)); } catch { /* Retain ambiguous partial staging for inspection. */ }
    if (staged && indexSafe) git("reset", "-q", "HEAD", "--", planRelFile, plansRel);
    if (wrotePlan && planSafe) fs.writeFileSync(planFile, original);
    if (wroteOutput && outputSafe) { if (oldOutput === null) fs.rmSync(output); else fs.writeFileSync(output, oldOutput); }
    const outputOriginal = oldOutput === null ? !fs.existsSync(output) : fs.existsSync(output) && fs.readFileSync(output).equals(oldOutput);
    if (!indexSafe || (wrotePlan ? !planSafe : attemptedPlan && (!fs.existsSync(planFile) || fs.readFileSync(planFile, "utf8") !== original)) || (wroteOutput ? !outputSafe : attemptedOutput && !outputOriginal)) throw new PlanStateError(`Approval recovery requires inspection: ${String(error)}`);
    throw error;
  }
  return true;
  } finally { lease?.release(); }
}

export function planApproveCommand(ids: string[], opts: { dryRun?: boolean }): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root, { checkSpecRoots: false });
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    for (const id of ids) {
      if (!approveOne(id, config, root, opts.dryRun === true)) return;
    }
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
