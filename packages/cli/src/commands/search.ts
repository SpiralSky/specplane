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

export interface SearchMatch {
  line: number;
  text: string;
}

/** One matched file: the unit `feature/tooling` and `architecture/reference-cli` call a block. */
export interface SearchFile {
  id: string;
  kind: "spec" | "plan";
  path: string;
  root: string | null;
  status: string | null;
  matches: SearchMatch[];
}

const MAX_SNIPPETS = 3;
const toPosix = (p: string) => p.split(path.sep).join("/");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Matching lines of one file, trimmed, at most three per file. */
function scanFile(abs: string, needle: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length && matches.length < MAX_SNIPPETS; i++) {
    if (lines[i].toLowerCase().includes(needle)) matches.push({ line: i + 1, text: lines[i].trim() });
  }
  return matches;
}

/** Case-insensitive literal search over spec files, plan files, and step files (archived plans too). */
export function search(text: string, opts: SearchOptions, root: string, config: Config): { files: SearchFile[]; problems: string[] } {
  if (text === "") throw new SearchUsageError("Search text must not be empty.");
  if (opts.kind !== undefined && opts.kind !== "spec" && opts.kind !== "plan") {
    throw new SearchUsageError(`Unknown kind \`${opts.kind}\`: expected \`spec\` or \`plan\`.`);
  }
  if (opts.root !== undefined && !config.spec_roots.some((r) => r.name === opts.root)) throw new UnknownRootError(opts.root);
  const needle = text.toLowerCase();
  const files: SearchFile[] = [];
  const problems: string[] = [];

  if (opts.kind !== "plan") {
    const { specs, findings } = loadSpecs(config, root);
    for (const f of findings) if (f.type === "schema" && f.spec !== undefined) problems.push(`Skipped ${f.file}: ${f.message}`);
    for (const s of specs) {
      if (opts.root !== undefined && s.root.name !== opts.root) continue;
      if (opts.status !== undefined && s.frontmatter.status !== opts.status) continue;
      const matches = scanFile(s.file, needle);
      if (matches.length > 0) {
        files.push({ id: s.id, kind: "spec", path: s.rel, root: s.root.name, status: s.frontmatter.status ?? null, matches });
      }
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
      const candidates = [p.planFile, ...listStepFiles(p.dir)].filter((f) => fs.existsSync(f));
      for (const f of candidates) {
        const rel = toPosix(path.relative(root, f));
        const matches = scanFile(f, needle);
        if (matches.length > 0) files.push({ id: p.id, kind: "plan", path: rel, root: null, status, matches });
      }
    }
  }

  files.sort((a, b) => cmp(a.path, b.path));
  return { files, problems };
}

/** A step file is labelled with its plan ID and step; other blocks use the ID alone. */
function heading(f: SearchFile): string {
  if (f.kind !== "plan") return f.id;
  const m = /\/steps\/(.+)\.md$/.exec(f.path);
  return m ? `${f.id} (step ${m[1]})` : f.id;
}

export function formatFiles(files: SearchFile[]): string {
  return files.map((f) => `${heading(f)}  ${f.path}\n${f.matches.map((m) => `  ${m.line}: ${m.text}`).join("\n")}\n`).join("\n");
}

export function searchCommand(text: string, opts: SearchOptions): void {
  try {
    const root = checkoutRoot();
    const { config, warnings } = loadConfig(root);
    for (const w of warnings) process.stderr.write(`${w.message}\n`);
    const { files, problems } = search(text, opts, root, config);
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stdout.write(opts.json ? JSON.stringify(files, null, 2) + "\n" : formatFiles(files));
  } catch (e) {
    if (!reportError(e)) throw e;
  }
}
