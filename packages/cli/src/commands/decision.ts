import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.js";
import { loadAdrs, validateAdrs } from "../decisions/validate.js";
import {
  AlreadyExistsError,
  DecisionNotFoundError,
  DecisionStateError,
  UncommittedChangesError,
  reportError,
} from "../errors.js";
import { writeStatus } from "../frontmatter.js";
import { abbrev, hasUncommittedChanges } from "../git/blobs.js";
import { cliTrailers, formatMessage } from "../git/commit.js";
import { run } from "../git/exec.js";
import { checkoutRoot } from "../git/repo.js";
import { formatHuman } from "../output/human.js";
import { makeReport } from "../report.js";
import { slugify } from "../spec/slug.js";
import { applyCreationScaffold, type CreationScaffold } from './spec.js';
import { withContainedDirectory } from '../core/contained-files.js';
import type { Config } from "../types.js";

const toPosix = (p: string) => p.split(path.sep).join("/");

const adrBody = (title: string): string =>
  [`# ${title}`, "", "## Context", "", "## Options considered", "", "## Decision", "", "## Consequences", ""].join("\n");

/** The next free four-digit number in `<decisions.dir>`, starting at 0001 (`feature/tooling`). */
function nextNumber(config: Config, root: string): string {
  let entries: string[] = [];
  try {
    entries = withContainedDirectory(root, config.decisions.dir, false, directory => directory.list());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const numbers = entries.map((f) => /^(\d{4})-/.exec(f)?.[1]).filter((n): n is string => n !== undefined).map(Number);
  const next = Math.max(0, ...numbers) + 1;
  if (next > 9999) throw new DecisionStateError('Decision numbering has exhausted the four-digit range.');
  return String(next).padStart(4, "0");
}

/** Create `<decisions.dir>/<NNNN>-<slug>.md` with `status: proposed`; returns its path. */
export function renderDecisionNew(title: string, config: Config, root: string, date: string): CreationScaffold {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DecisionStateError('Decision creation needs an exact UTC date.');
  const dir = config.decisions.dir;
  const number = nextNumber(config, root);
  const file = path.join(dir, `${number}-${slugify(title)}.md`);
  const rel = toPosix(file);
  if (fs.existsSync(path.join(root, file))) throw new AlreadyExistsError("Decision", rel);

  const text = [
    "---",
    `id: decision/${number}`,
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    "status: proposed",
    'superseded_by: ""',
    "related_specs: []",
    "---",
    "",
    adrBody(title),
  ].join("\n");
  return { operation: 'decision.new', identity: `decision/${number}`, path: rel, directories: [toPosix(dir)], files: [{ path: rel, content: text }] };
}

export function applyDecisionNew(plan: CreationScaffold, root: string): void {
  if (plan.operation !== 'decision.new') throw new DecisionStateError('Expected a decision creation scaffold.');
  applyCreationScaffold(plan, root);
}

export function decisionNew(title: string, config: Config, root: string): string {
  const plan = renderDecisionNew(title, config, root, new Date().toISOString().slice(0, 10));
  applyDecisionNew(plan, root);
  return plan.path;
}

export function decisionNewCommand(title: string): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    process.stdout.write(`${decisionNew(title, config, root)}\n`);
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}

function commitAdr(root: string, file: string, id: string): string {
  const trailers = cliTrailers("approve", "");
  const msg = formatMessage({ type: "docs", scope: "decisions", summary: `accept ${id}`, trailers });
  run("git", ["add", "--", file], { cwd: root });
  run("git", ["commit", "-F", "-", "--", file], { cwd: root, input: msg });
  return abbrev(run("git", ["rev-parse", "HEAD"], { cwd: root }).trim(), root);
}

export function acceptDecision(rawId: string, config: Config, root: string, dryRun: boolean, quiet = false): boolean {
  const id = /^\d{4}$/.test(rawId) ? `decision/${rawId}` : rawId;
  const { adrs, findings } = loadAdrs(config, root);
  const adr = adrs.find((a) => a.frontmatter.id === id);
  if (!adr) throw new DecisionNotFoundError(rawId);

  const status = adr.frontmatter.status;
  if (status !== "proposed") {
    throw new DecisionStateError(`Decision \`${id}\` is \`${status}\`; only \`proposed\` decisions can be accepted.`);
  }
  const rel = toPosix(path.relative(root, adr.file));
  if (hasUncommittedChanges(rel, root)) throw new UncommittedChangesError(rel);

  const report = validateAdrs(adrs, config, root, findings);
  const errors = report.errors.filter((f) => f.adr === id);
  if (errors.length > 0) {
    if (quiet) throw new DecisionStateError(formatHuman(makeReport(errors, [id])));
    process.stderr.write(formatHuman(makeReport(errors, [id])));
    process.exitCode = 1;
    return false;
  }

  if (dryRun) {
    if (!quiet) process.stdout.write(`would accept ${id}\n`);
    if (!quiet) process.stdout.write(`would commit docs(decisions): accept ${id}\n`);
    return true;
  }

  writeStatus(adr.file, "accepted");
  const sha = commitAdr(root, rel, id);
  if (!quiet) process.stdout.write(`accepted ${id} ${sha}\n`);
  return true;
}

export function decisionAcceptCommand(ids: string[], opts: { dryRun?: boolean }): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    for (const id of ids) {
      if (!acceptDecision(id, config, root, opts.dryRun === true)) return;
    }
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
