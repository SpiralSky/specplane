import { loadSettings } from "../config.js";
import { PreconditionError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { cliActor } from "../perm/permissions.js";
import { checkRequirementIds } from "../spec/requirements.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, allSpecs } from "../spec/project.js";
import { headCommit, indexSource, stagedFiles } from "../spec/source.js";
import { DEFAULT_TIMEOUT_SEC, runTests } from "../verify/test-run.js";
import type { CommandResult } from "./runner.js";

/**
 * The pre-commit checks (`architecture/reference-cli` §14.2). They run from the hook as the person committing, read
 * the index, change nothing and need no permission: the person turned the setting on, and an LLM commit is refused
 * by the same check as any other.
 */

/** `check requirement-ids --staged` (`verification R32`): duplicate IDs in the staged requirement files, nothing else. */
export function checkRequirementIdsCommand(opts: { staged?: boolean }): CommandResult {
  if (!opts.staged) throw new PreconditionError(["Pass --staged: the check reads the index."]);
  const root = checkoutRoot();
  const { paths } = loadSpecPaths(root);
  const project = loadProject(indexSource(root), paths);
  const duplicates = checkRequirementIds(project.requirements.files, project.requirements.central)
    .filter((p) => p.message.startsWith("duplicate requirement ID"));
  const lines = duplicates.map((p) => `${p.file}${p.line !== undefined ? `:${p.line}` : ""}: ${p.message}`);
  if (!duplicates.length) lines.push("No duplicate requirement IDs in the staged changes.");
  return { ok: duplicates.length === 0, data: { duplicates }, lines, findings: duplicates.length ? lines : [] };
}

/** `check tests --staged` (`verification R36.3`): deterministic tests of architecture specs with staged files, run on the index. */
export async function checkTestsCommand(opts: { staged?: boolean; timeout?: string }): Promise<CommandResult> {
  if (!opts.staged) throw new PreconditionError(["Pass --staged: the check reads the index."]);
  let timeoutSec = DEFAULT_TIMEOUT_SEC;
  if (opts.timeout !== undefined) {
    timeoutSec = Number(opts.timeout);
    if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) throw new PreconditionError(["--timeout must be a positive number of seconds."]);
  }
  const root = checkoutRoot();
  const { paths } = loadSpecPaths(root);
  const project = loadProject(indexSource(root), paths);
  const staged = new Set(stagedFiles(root));
  const specs = [...allSpecs(project)].filter((d) => d.layer === "architecture" && staged.has(d.file)).map((d) => d.id);
  if (!specs.length) return { ok: true, data: { specs: [], results: [] }, lines: ["No architecture specs are staged; no tests to run."] };
  const settings = loadSettings(root).config;
  const actor = cliActor(root);
  const report = await runTests({
    root, project, selection: { specs }, timeoutSec, commit: headCommit(root) ?? "index", staged: true,
    logMode: settings.values["tests.logs"] as "local" | "git" | "off", gitLogDir: settings.abs.testLogs,
    actor: `${actor.kind === "llm" ? "llm" : "human"}:${actor.name}`,
  });
  const failed = report.results.filter((r) => r.outcome === "failed");
  const lines = report.results.map((r) => `${r.spec} ${r.test}  ${r.outcome}${r.outcome === "passed" ? "" : `: ${r.summary.split("\n").join("\n    ")}`}${r.log ? `  (log ${r.log})` : ""}`);
  const ran = report.results.filter((r) => r.outcome !== "not-run").length;
  lines.push(failed.length ? `${failed.length} deterministic test(s) failed in ${[...new Set(failed.map((r) => r.spec))].join(", ")}; the commit is refused.` : `${ran} deterministic test(s) passed in ${specs.join(", ")}.`);
  return { ok: failed.length === 0, data: { specs, results: report.results }, lines, warnings: report.warnings, findings: failed.map((r) => `${r.spec} ${r.test} failed`) };
}
