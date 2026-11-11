import { loadSettings } from "../config.js";
import { PreconditionError, SpecNotFoundError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { activePreset, cliActor, guard } from "../perm/permissions.js";
import { headContext } from "../verify/implementation.js";
import { headCommit } from "../spec/source.js";
import { recordResults } from "../verify/test-record.js";
import { DEFAULT_TIMEOUT_SEC, runTests, selectTests, type Selection } from "../verify/test-run.js";
import type { CommandResult } from "./runner.js";

/** Parse `<spec>[#<section>]` or `<spec>#T<n>` against the project's specs; a bare slug is accepted when unique. */
function parseTarget(ids: string[], arg: string): Selection {
  const [spec, rest] = [arg.split("#")[0], arg.includes("#") ? arg.slice(arg.indexOf("#") + 1) : undefined];
  const hits = ids.includes(spec) ? [spec] : ids.filter((i) => i.slice(i.indexOf("/") + 1) === spec);
  if (hits.length !== 1) throw new SpecNotFoundError(spec);
  if (rest === undefined) return { spec: hits[0] };
  return /^T\d+$/.test(rest) ? { spec: hits[0], label: rest } : { spec: hits[0], section: rest };
}

/**
 * `specplane test run [<spec>[#<section>]] [--all] [--timeout <seconds>]` (`architecture/reference-cli` §10.2). Needs
 * `info.retrieve`. Tests run on HEAD; recording separately follows `test.record` (`§10.3`).
 */
export async function testRunCommand(target: string | undefined, opts: { all?: boolean; timeout?: string }): Promise<CommandResult> {
  const root = checkoutRoot();
  const g = guard(activePreset(root), cliActor(root), ["info.retrieve"], "Running tests");
  if (g.kind !== "allow") return { ok: false, findings: [g.kind === "deny" ? g.message : "Running tests needs approval from the user."], permission: "info.retrieve" };
  if (!target && !opts.all) throw new PreconditionError(["Name a spec (`<spec>[#<section>]`) or pass --all."]);
  let timeoutSec = DEFAULT_TIMEOUT_SEC;
  if (opts.timeout !== undefined) {
    timeoutSec = Number(opts.timeout);
    if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) throw new PreconditionError(["--timeout must be a positive number of seconds."]);
  }
  const commit = headCommit(root);
  if (!commit) throw new PreconditionError(["The repository has no commits; tests run on the committed content at HEAD."]);
  const { project } = headContext(root);
  const selection: Selection = target ? parseTarget([...project.specs.keys()], target) : {};
  const settings = loadSettings(root).config;
  const actor = cliActor(root);
  const report = await runTests({
    root, project, selection, timeoutSec, commit,
    logMode: settings.values["tests.logs"] as "local" | "git" | "off", gitLogDir: settings.abs.testLogs,
    actor: `${actor.kind === "llm" ? "llm" : "human"}:${actor.name}`,
  });
  const recording = recordResults({ root, actor, preset: activePreset(root) }, commit,
    report.results.filter((r): r is typeof r & { outcome: "passed" | "failed" } => r.outcome === "passed" || r.outcome === "failed"));
  const failed = report.results.filter((r) => r.outcome === "failed");
  const count = (o: string) => report.results.filter((r) => r.outcome === o).length;
  const lines = report.results.map((r) => `${r.test}  ${r.outcome}${r.outcome === "passed" ? "" : `: ${r.summary.split("\n").join("\n    ")}`}${r.log ? `  (log ${r.log})` : ""}`);
  if (recording.notRecorded) lines.push(`not recorded: ${recording.notRecorded}`);
  for (const held of recording.held) lines.push(`${held.test}: not recorded; request ${held.request} sent`);
  if (!report.results.length) lines.push(`No tests declared${selectTests(project, selection).length ? "" : " in the selection"}.`);
  else lines.push(`${count("passed")} passed, ${count("failed")} failed, ${count("not-run")} not run`);
  if (report.dirty) lines.push(`note: the working tree has uncommitted changes; the committed state (${commit.slice(0, 8)}) was tested`);
  return { ok: failed.length === 0, data: { commit, dirty: report.dirty, results: report.results, recording }, lines, warnings: [...report.warnings, ...recording.warnings], findings: failed.map((r) => `${r.test} failed`), permission: "info.retrieve" };
}
