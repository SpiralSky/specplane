import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.js";
import { SpecplaneError, UnknownRootError, reportError } from "../errors.js";
import { checkoutRoot } from "../git/repo.js";
import { readFrontmatter } from "../frontmatter.js";
import { listStepFiles } from "../plan/parse.js";
import { listPlans } from "../plan/resolve.js";
import { loadSpecs } from "../spec/validate.js";
import type { Config } from "../types.js";

class SearchUsageError extends SpecplaneError {
  readonly exitCode = 1;
}

export interface SearchOptions {
  kind?: string;
  status?: string;
  root?: string;
  json?: boolean;
}

export interface SearchHit {
  path: string;
  id: string;
  type: "spec" | "plan";
  status: string | null;
  line: number;
  snippet: string;
}

const SNIPPET_MAX = 200;
const toPosix = (p: string) => p.split(path.sep).join("/");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function scanFile(abs: string, rel: string, needle: string, meta: Omit<SearchHit, "path" | "line" | "snippet">): SearchHit[] {
  const hits: SearchHit[] = [];
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    if (text.toLowerCase().includes(needle)) {
      const t = text.trim();
      hits.push({ path: rel, ...meta, line: i + 1, snippet: t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}...` : t });
    }
  });
  return hits;
}

/** Case-insensitive literal search over spec files and plan files (PLAN.md, steps, HANDOFF.md, archived plans too). */
export function search(text: string, opts: SearchOptions, root: string, config: Config): { hits: SearchHit[]; problems: string[] } {
  if (text === "") throw new SearchUsageError("Search text must not be empty.");
  if (opts.kind !== undefined && opts.kind !== "spec" && opts.kind !== "plan") {
    throw new SearchUsageError(`Unknown kind \`${opts.kind}\`: expected \`spec\` or \`plan\`.`);
  }
  if (opts.root !== undefined && !config.spec_roots.some((r) => r.name === opts.root)) throw new UnknownRootError(opts.root);
  const needle = text.toLowerCase();
  const hits: SearchHit[] = [];
  const problems: string[] = [];

  if (opts.kind !== "plan") {
    const { specs, findings } = loadSpecs(config, root);
    for (const f of findings) if (f.type === "schema" && f.spec !== undefined) problems.push(`Skipped ${f.file}: ${f.message}`);
    for (const s of specs) {
      if (opts.root !== undefined && s.root.name !== opts.root) continue;
      if (opts.status !== undefined && s.frontmatter.status !== opts.status) continue;
      hits.push(...scanFile(s.file, s.rel, needle, { id: s.id, type: "spec", status: s.frontmatter.status ?? null }));
    }
  }

  // Plans belong to no spec root, so `--root` excludes them.
  if (opts.kind !== "spec" && opts.root === undefined) {
    for (const p of listPlans(config, root)) {
      let status: string | null;
      try {
        const s = readFrontmatter(p.planFile).data.status;
        status = typeof s === "string" ? s : null;
      } catch (e) {
        problems.push(`Skipped ${toPosix(path.relative(root, p.planFile))}: ${(e as Error).message}`);
        continue;
      }
      if (opts.status !== undefined && status !== opts.status) continue;
      const files = [p.planFile, ...listStepFiles(p.dir), path.join(p.dir, "HANDOFF.md")].filter((f) => fs.existsSync(f));
      for (const f of files) hits.push(...scanFile(f, toPosix(path.relative(root, f)), needle, { id: p.id, type: "plan", status }));
    }
  }

  hits.sort((a, b) => cmp(a.path, b.path) || a.line - b.line);
  return { hits, problems };
}

export function formatHits(hits: SearchHit[]): string {
  return hits.map((h) => `${h.id}  ${h.path}:${h.line}  ${h.snippet}\n`).join("");
}

export function searchCommand(text: string, opts: SearchOptions): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const { hits, problems } = search(text, opts, root, config);
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stdout.write(opts.json ? JSON.stringify(hits, null, 2) + "\n" : formatHits(hits));
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
