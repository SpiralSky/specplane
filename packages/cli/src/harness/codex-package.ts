import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleExtensionPackage, type PackageBuildOptions, type PackageInput } from "./package-builder.js";
import { templatesDir } from "./index.js";

/** Workflows the packaged Codex skill can prepare; each cites its shared `agent-skills` section. */
export const CODEX_WORKFLOWS = ["plan-step", "plan-create", "spec-assist", "spec-draft-architecture", "decision-new", "validate"] as const;

const SKIP = [/\.test\.js$/, /\.d\.ts$/, /\.map$/, /(^|\/)fixtures\.js$/, /(^|\/)test-repo\.js$/, /-fixture\.js$/, /^templates\//];

export function packageFiles(dir: string): string[] { return files(dir); }
function files(dir: string, prefix = ""): string[] {
  return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap(entry => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(dir, rel) : [rel];
  });
}

function findPackage(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Production dependency closure as `{ from, to }` package directories, keeping nested `node_modules` layout. */
function dependencyDirs(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (dir: string): void => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const resolved = findPackage(name, dir);
      if (!resolved) throw new Error(`Package build refused: dependency ${name} is not installed`);
      const real = fs.realpathSync(resolved);
      if (found.has(real)) continue;
      const rel = path.relative(root, real).split(path.sep).join("/");
      found.set(real, rel.startsWith("..") ? `node_modules/${real.split(`${path.sep}node_modules${path.sep}`).slice(1).join("/node_modules/")}` : rel);
      visit(real);
    }
  };
  visit(root);
  return found;
}

/** Builds the Codex skill package (runtime, dependencies, docs, skill files) into an empty directory; synchronous so `init` can use it. */
export function assembleCodexSkillPackage(outDir: string) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "..");
  const root = path.resolve(dist, "..");
  const skill = path.join(templatesDir("codex"), "skills", "specplane");
  const runtime: PackageInput[] = [
    { from: path.join(root, "package.json"), to: "package.json" },
    { from: path.join(root, "core-release.json"), to: "core-release.json" },
    ...files(dist).filter(rel => !SKIP.some(pattern => pattern.test(rel))).map(rel => ({ from: path.join(dist, rel), to: `dist/${rel}` })),
    ...files(path.join(root, "assets", "docs")).map(rel => ({ from: path.join(root, "assets", "docs", rel), to: `assets/docs/${rel}` })),
  ];
  for (const [from, to] of dependencyDirs(root)) {
    for (const rel of files(from)) {
      if (rel.startsWith("node_modules/")) continue;
      runtime.push({ from: path.join(from, rel), to: `${to}/${rel}` });
    }
  }
  const options: PackageBuildOptions = {
    outDir,
    extension: { id: "specplane-codex", host: "codex" },
    // Native and background capability flags stay false: nothing here is host evidence.
    capabilities: { reasoning: true, nativeCommands: false, backgroundSessions: false },
    docsDir: path.join(root, "assets", "docs"),
    runtime,
    assets: [
      { from: path.join(skill, "SKILL.md"), to: "SKILL.md", kind: "reasoning" },
      { from: path.join(skill, "scripts", "workflow.mjs"), to: "scripts/workflow.mjs", kind: "hook" },
    ],
    instructions: { from: path.join(skill, "references", "shared-procedure.md"), to: "references/shared-procedure.md" },
    procedures: CODEX_WORKFLOWS.map(workflow => ({
      workflow,
      contracts: [{ sourceId: "base:architecture/agent-skills", anchor: workflow }],
    })),
  };
  return assembleExtensionPackage(options);
}
