import * as fs from "node:fs";
import * as path from "node:path";
import { upsertBlock } from "../agents/standing.js";
import { CONFIG_PATH, loadConfig } from "../config.js";
import { SpecplaneError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { type Harness, NO_HARNESS_HINT, Report, selectHarnesses } from "../harness/index.js";
import { assertInstallDestination, writeInstallFile } from "../harness/containment.js";

/** Full default configuration (`feature/configuration` § Full schema with defaults). */
export const DEFAULT_CONFIG_YAML = `# Specplane configuration. See feature/configuration for every key.

spec_roots:
  - name: base
    path: docs/specifications
    # extends: <root-name>    # omit for the base root; set for overlays

specs:
  llm_review: false           # agents add LLM review to leak-guard and overlay checks
  pin_bases: warn             # off | warn | require
  feature:
    authorship: user          # user | llm | either
    llm_role: assist          # review | assist | draft | none
    forbid_architecture: true # enable the architecture-leak guard
    leak_guard_allow: []      # terms that are part of this project's user-visible interface
  architecture:
    authorship: either        # user | llm | either
    llm_role: draft           # review | assist | draft | none
    require_approved_features: true  # block approval until feature specs are approved

plans:
  dir: plans                  # directory for all plan folders, relative to repo root
  require_approved_specs: feature   # none | feature | feature_and_architecture
  status_source: git          # git | frontmatter
  merge: pull_request         # pull_request | local_merge
  dependency_mode: wait_for_merge   # wait_for_merge | stack
  archive_done: true          # move completed plan folders to <plans.dir>/archive/
  setup_hook: ""              # shell command run after worktree creation; empty = skip
  test_command: ""            # shell command run by the finish flow; empty = skip
  forge: auto                 # auto | github | none

execution:
  backend: worktree           # worktree | branch | external
  worktree_dir: ../.specplane-worktrees   # where worktrees are created; relative to the main checkout
  session_mode: auto
  notify:
    on: [blocked, consideration, finish_ready, failed]
    transport: none
    command: ""
    dedupe: true
  max_parallel: 1
  max_budget_usd: null

decisions:
  dir: docs/decisions         # directory holding ADRs
`;

const FEATURES_INFO = `# Feature specifications

Feature specs describe what the system does, from the user's point of view. Each file needs frontmatter; this \`INFO.md\` is documentation only and is never parsed as a spec.
`;
const ARCHITECTURE_INFO = `# Architecture specifications

Architecture specs describe how the system is built and which feature specs they implement. Each file needs frontmatter; this \`INFO.md\` is documentation only and is never parsed as a spec.
`;

/** Scaffold a repository; returns one report line per file. */
export function runInit(
  root: string,
  opts: { harness?: string; registry?: Harness[] } = {},
): string[] {
  assertInstallDestination(root, path.join(root, CONFIG_PATH));
  const { config } = loadConfig(root, { checkSpecRoots: false });
  const base = config.spec_roots.find((r) => r.name === "base") ?? config.spec_roots[0];
  for (const destination of [CONFIG_PATH, path.join(base.path, "features", "INFO.md"),
    path.join(base.path, "architecture", "INFO.md"), "AGENTS.md", path.join(config.plans.dir, ".gitkeep")]) {
    assertInstallDestination(root, path.join(root, destination));
  }
  const selected = selectHarnesses(root, opts.harness, opts.registry);
  const out: string[] = [];
  const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
  const createIfAbsent = (abs: string, content: string) => {
    assertInstallDestination(root, abs);
    if (fs.existsSync(abs)) {
      out.push(`Skipped ${rel(abs)} (already exists)`);
      return;
    }
    writeInstallFile(root, abs, content);
    out.push(`Created ${rel(abs)}`);
  };

  createIfAbsent(path.join(root, CONFIG_PATH), DEFAULT_CONFIG_YAML);
  createIfAbsent(path.join(root, base.path, "features", "INFO.md"), FEATURES_INFO);
  createIfAbsent(path.join(root, base.path, "architecture", "INFO.md"), ARCHITECTURE_INFO);

  const agents = path.join(root, "AGENTS.md");
  const existing = fs.existsSync(agents) ? fs.readFileSync(agents, "utf8") : null;
  const res = upsertBlock(existing, selected.find((h) => h.workflowsLine)?.workflowsLine);
  if (res.action === "malformed") {
    out.push("Skipped AGENTS.md (malformed specplane block; fix the begin/end markers by hand)");
  } else if (res.action === "unchanged") {
    out.push("Skipped AGENTS.md (Specplane block is up to date)");
  } else {
    writeInstallFile(root, agents, res.content);
    out.push(
      res.action === "created"
        ? "Created AGENTS.md"
        : `Updated AGENTS.md (${res.action === "appended" ? "appended" : "updated"} Specplane block)`,
    );
  }

  const plansDir = path.join(root, config.plans.dir);
  if (!fs.existsSync(plansDir) || fs.readdirSync(plansDir).length === 0) {
    createIfAbsent(path.join(plansDir, ".gitkeep"), "");
  } else {
    out.push(`Skipped ${rel(path.join(plansDir, ".gitkeep"))} (plans directory is not empty)`);
  }
  const report = new Report(root);
  for (const h of selected) h.install(root, report);
  out.push(...report.lines);
  if (selected.length === 0) out.push(opts.harness === "none" ? "Harness integration explicitly disabled; only neutral scaffolding written." : NO_HARNESS_HINT);
  return out;
}

export function initCommand(opts: { harness?: string } = {}): void {
  try {
    const lines = runInit(checkoutRoot(), opts);
    process.stdout.write(lines.join("\n") + "\n");
  } catch (e) {
    if (e instanceof SpecplaneError) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = e.exitCode;
      return;
    }
    throw e;
  }
}
