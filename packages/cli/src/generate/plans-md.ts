import * as path from "node:path";
import { buildGraph } from "../plan/graph.js";
import { parsePlan } from "../plan/parse.js";
import { listPlans } from "../plan/resolve.js";
import { branchExists, remoteBranchExists } from "../git/branch.js";
import { getEffectiveStatus, getIndexStatus } from "../plan/status.js";
import type { Config, PlanFrontmatter } from "../types.js";
import { toMermaid } from "./mermaid.js";

const HEADER = "<!-- GENERATED FILE — do not edit by hand. Regenerate with: specplane generate -->";

/** Build PLANS.md (`architecture/file-formats` §5.1-5.2) from committed plan files; throws on an unparsable PLAN.md. */
export function generatePlansMd(config: Config, root: string, opts: { live?: boolean } = {}): string {
  const records = listPlans(config, root).map((r) => ({ ...r, fm: parsePlan(r.dir).frontmatter }));
  const byId = new Map<string, PlanFrontmatter>(records.map((r) => [r.id, r.fm]));
  const link = (id: string): string => {
    const rec = records.find((r) => r.id === id);
    const target = rec?.archived ? `archive/${id}/PLAN.md` : `${id}/PLAN.md`;
    return `[${id}](${target})`;
  };
  const git = { branchExists: (id: string) => branchExists(`plan/${id}`, root) || remoteBranchExists(`plan/${id}`, root) };
  const statuses = new Map(
    records.map((r) => [r.id, opts.live ? getEffectiveStatus(r.fm, byId, config, git) : getIndexStatus(r.fm, byId, config)]),
  );
  const active = records.filter((r) => !r.archived);
  const archived = records.filter((r) => r.archived);

  const activeSection = active.length
    ? [
        "| ID | Title | Status | Dependencies | Specs |",
        "|----|-------|--------|--------------|-------|",
        ...active.map((r) => {
          const deps = r.fm.depends_on?.length ? [...r.fm.depends_on].sort().map(link).join(", ") : "—";
          return `| ${link(r.id)} | ${r.fm.title} | ${statuses.get(r.id)} | ${deps} | ${r.fm.specs.join(", ")} |`;
        }),
      ].join("\n")
    : "_None._";
  const archivedSection = archived.length
    ? [
        "| ID | Title | Status | Specs |",
        "|----|-------|--------|-------|",
        ...archived.map((r) => `| ${link(r.id)} | ${r.fm.title} | ${statuses.get(r.id)} | ${r.fm.specs.join(", ")} |`),
      ].join("\n")
    : "_None._";

  const graph = buildGraph(records.map((r) => ({ id: r.id, depends_on: r.fm.depends_on })));
  return [
    HEADER,
    "",
    "# Plans",
    "",
    "## Active plans",
    "",
    activeSection,
    "",
    "## Archived plans",
    "",
    archivedSection,
    "",
    "## Dependency graph",
    "",
    "```mermaid",
    toMermaid(graph, statuses),
    "```",
    "",
  ].join("\n");
}

export function plansMdPath(config: Config, root: string): string {
  return path.join(root, config.plans.dir, "PLANS.md");
}
