import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

/** The configuration keys the spec reader needs (`architecture/file-formats` §6). Everything else is reported, not used. */
export interface SpecPaths {
  requirements: string;
  requirementsIndex: string | null;
  features: string;
  architecture: string;
  plansDir: string;
}

export interface ConfigFinding { severity: "error" | "warning"; message: string }

export const DEFAULT_PATHS: SpecPaths = {
  requirements: "docs/requirements",
  requirementsIndex: null,
  features: "docs/specifications/features",
  architecture: "docs/specifications/architecture",
  plansDir: "docs/plans",
};

const TOP_KEYS = new Set(["paths", "plans", "notifications", "steering", "permissions", "harness", "authorship", "audit", "auto_warn", "architecture", "tests", "pre_commit", "coverage", "decisions", "subprojects", "strict_mode", "bypass_guards", "roles"]);
const PATH_KEYS = new Set(["requirements", "requirements_index", "features", "architecture", "test_logs"]);
const PLAN_KEYS = new Set(["dir", "worktree_dir", "setup_command", "start_conditions", "parallelism"]);

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read `.specplane/config.yaml`; a bad key is dropped with a finding and its default used (`reference-cli` §3.2). */
export function loadSpecPaths(root: string): { paths: SpecPaths; findings: ConfigFinding[] } {
  const paths = { ...DEFAULT_PATHS };
  const findings: ConfigFinding[] = [];
  let raw: string;
  try { raw = fs.readFileSync(path.join(root, ".specplane/config.yaml"), "utf8"); } catch { return { paths, findings }; }
  let doc: unknown;
  try { doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA }); } catch (e) {
    findings.push({ severity: "error", message: `config.yaml is not valid YAML: ${(e as Error).message.split("\n")[0]}` });
    return { paths, findings };
  }
  if (doc === null || doc === undefined) return { paths, findings };
  if (!isMap(doc)) { findings.push({ severity: "error", message: "config.yaml must be a mapping" }); return { paths, findings }; }
  for (const k of Object.keys(doc)) if (!TOP_KEYS.has(k)) findings.push({ severity: "warning", message: `unknown setting \`${k}\` (not part of the current configuration; it has no effect)` });
  const dirValue = (where: string, v: unknown): string | null => {
    if (typeof v !== "string" || v.trim() === "") { findings.push({ severity: "warning", message: `\`${where}\` must be a non-empty path; using the default` }); return null; }
    const p = path.posix.normalize(v.replace(/\\/g, "/")).replace(/\/+$/, "");
    if (p.startsWith("/") || p === ".." || p.startsWith("../")) { findings.push({ severity: "warning", message: `\`${where}\` must be inside the repository; using the default` }); return null; }
    return p;
  };
  const p = doc.paths;
  if (p !== undefined) {
    if (!isMap(p)) findings.push({ severity: "warning", message: "`paths` must be a mapping" });
    else {
      for (const k of Object.keys(p)) if (!PATH_KEYS.has(k)) findings.push({ severity: "warning", message: `unknown setting \`paths.${k}\`` });
      for (const [key, field] of [["requirements", "requirements"], ["features", "features"], ["architecture", "architecture"]] as const) {
        if (p[key] !== undefined) { const v = dirValue(`paths.${key}`, p[key]); if (v) paths[field] = v; }
      }
      if (p.requirements_index !== undefined && p.requirements_index !== null) {
        if (typeof p.requirements_index === "string" && p.requirements_index) paths.requirementsIndex = p.requirements_index;
        else findings.push({ severity: "warning", message: "`paths.requirements_index` must be a file name" });
      }
    }
  }
  const pl = doc.plans;
  if (pl !== undefined) {
    if (!isMap(pl)) findings.push({ severity: "warning", message: "`plans` must be a mapping" });
    else {
      for (const k of Object.keys(pl)) if (!PLAN_KEYS.has(k)) findings.push({ severity: "warning", message: `unknown setting \`plans.${k}\` (not part of the current configuration; it has no effect)` });
      if (pl.dir !== undefined) { const v = dirValue("plans.dir", pl.dir); if (v) paths.plansDir = v; }
    }
  }
  return { paths, findings };
}
