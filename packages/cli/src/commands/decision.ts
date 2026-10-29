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
import type { Config } from "../types.js";

const toPosix = (p: string) => p.split(path.sep).join("/");

const adrBody = (title: string): string =>
  [`# ${title}`, "", "## Context", "", "## Options considered", "", "## Decision", "", "## Consequences", ""].join("\n");

/** The next free four-digit number in `<decisions.dir>`, starting at 0001 (`feature/tooling`). */
function nextNumber(config: Config, root: string): string {
  const dir = path.join(root, config.decisions.dir);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return "0001";
  }
  const numbers = entries.map((f) => /^(\d{4})-/.exec(f)?.[1]).filter((n): n is string => n !== undefined).map(Number);
  return String(Math.max(0, ...numbers) + 1).padStart(4, "0");
}

/** Create `<decisions.dir>/<NNNN>-<slug>.md` with `status: proposed`; returns its path. */
export function decisionNew(title: string, config: Config, root: string): string {
  const dir = path.join(root, config.decisions.dir);
  const number = nextNumber(config, root);
  const file = path.join(dir, `${number}-${slugify(title)}.md`);
  const rel = toPosix(path.relative(root, file));
  if (fs.existsSync(file)) throw new AlreadyExistsError("Decision", rel);

  const date = new Date().toISOString().slice(0, 10);
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
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
  return rel;
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

function acceptOne(rawId: string, config: Config, root: string, dryRun: boolean): boolean {
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
    process.stderr.write(formatHuman(makeReport(errors, [id])));
    process.exitCode = 1;
    return false;
  }

  if (dryRun) {
    process.stdout.write(`would accept ${id}\n`);
    process.stdout.write(`would commit docs(decisions): accept ${id}\n`);
    return true;
  }

  writeStatus(adr.file, "accepted");
  const sha = commitAdr(root, rel, id);
  process.stdout.write(`accepted ${id} ${sha}\n`);
  return true;
}

export function decisionAcceptCommand(ids: string[], opts: { dryRun?: boolean }): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    for (const id of ids) {
      if (!acceptOne(id, config, root, opts.dryRun === true)) return;
    }
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
