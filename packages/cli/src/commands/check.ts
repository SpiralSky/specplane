import { loadSettings } from "../config.js";
import { PreconditionError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, mode } from "../perm/permissions.js";
import { strictMeasureOn } from "../perm/strict.js";
import { run } from "../git/exec.js";
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

const layerDirs = (paths: { requirements: string; features: string; architecture: string; subprojects: { dir: string }[] }): Array<[string, "requirement" | "feature" | "architecture"]> => [
  [paths.requirements, "requirement"], [paths.features, "feature"], [paths.architecture, "architecture"],
  ...paths.subprojects.flatMap((s): Array<[string, "requirement" | "feature" | "architecture"]> => [[`${s.dir}/requirements`, "requirement"], [`${s.dir}/features`, "feature"], [`${s.dir}/architecture`, "architecture"]]),
];

/**
 * The permission that making a staged change directly would have needed, or `null` for a file Specplane does not guard
 * (`strict_mode.git_commit_guard`, `architecture/reference-cli` §15.2).
 */
export function permissionForStaged(status: string, file: string, dirs: Array<[string, "requirement" | "feature" | "architecture"]>): string | null {
  const verb = status.startsWith("A") ? "create" : status.startsWith("D") ? "delete" : "edit";
  for (const [dir, layer] of dirs) if (file.startsWith(`${dir}/`)) return `spec.${verb}.${layer}`;
  if (file === ".specplane/config.yaml") return "config.change";
  if (file.startsWith(".specplane/decisions/")) return `decision.${verb === "create" ? "add" : verb}`;
  if (file.startsWith(".specplane/roles/")) return "role.manage";
  return null;
}

/**
 * `check strict --staged` (`roles-and-permissions R55.1`): a commit made by a process marked as an LLM's is refused when it
 * stages a specification, decision record, role or configuration change that the LLM's role may not make directly (the mode is
 * not allow). A commit by a person is never refused here. Runs from the pre-commit hook that `strict_mode.git_commit_guard` installs.
 */
export function checkStrictCommand(opts: { staged?: boolean }): CommandResult {
  if (!opts.staged) throw new PreconditionError(["Pass --staged: the check reads the index."]);
  const root = checkoutRoot();
  if (!strictMeasureOn(root, "git_commit_guard")) return { ok: true, data: { refused: [] }, lines: ["Strict mode's git_commit_guard is off; nothing was checked."] };
  const actor = cliActor(root);
  if (actor.kind !== "llm") return { ok: true, data: { refused: [] }, lines: ["The commit is not made by an LLM process; nothing was checked."] };
  const { paths } = loadSpecPaths(root);
  const dirs = layerDirs(paths);
  const preset = activePreset(root);
  const fields = run("git", ["diff", "--cached", "--name-status", "--no-renames", "-z"], { cwd: root }).split("\0").filter(Boolean);
  const refused: Array<{ file: string; permission: string; mode: string }> = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const permission = permissionForStaged(fields[i], fields[i + 1], dirs);
    if (!permission) continue;
    const m = mode(preset, actor.role, permission);
    if (m !== "allow") refused.push({ file: fields[i + 1], permission, mode: m });
  }
  const lines = refused.map((r) => `${r.file}: needs \`${r.permission}\`, which is ${r.mode === "deny" ? "denied" : "set to request user"} for the ${actor.role} role`);
  if (refused.length) lines.push("Strict mode refuses this commit: change these files through Specplane actions, or ask the user to commit them.");
  else lines.push("No staged change needs more than the LLM role may do directly.");
  return { ok: refused.length === 0, data: { refused }, lines, findings: refused.length ? lines : [] };
}
