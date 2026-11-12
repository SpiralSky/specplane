import * as path from "node:path";
import { loadSettings } from "../config.js";

/** The configuration values the spec reader needs; they come from `config.ts` (`architecture/file-formats` §6). */
export interface SpecPaths {
  requirements: string;
  requirementsIndex: string | null;
  features: string;
  architecture: string;
  plansDir: string;
  /** Subprojects from the `subprojects` setting: a name and a repository-relative folder (`later-releases R39`). */
  subprojects: { name: string; dir: string }[];
}

export interface ConfigFinding { severity: "error" | "warning"; message: string }

export const DEFAULT_PATHS: SpecPaths = {
  requirements: "docs/requirements",
  requirementsIndex: null,
  features: "docs/specifications/features",
  architecture: "docs/specifications/architecture",
  plansDir: "docs/plans",
  subprojects: [],
};

/** A checked absolute folder as the repository-relative POSIX path the snapshot sources read (`Config.abs`). */
export function relativeTo(root: string, abs: string): string {
  return path.relative(path.resolve(root), abs).split(path.sep).join("/");
}

/** Read the paths from the configuration's checked absolute folders; a bad key was already replaced by its default with a finding (`reference-cli` §3.2). */
export function loadSpecPaths(root: string): { paths: SpecPaths; findings: ConfigFinding[] } {
  const { config, findings } = loadSettings(root);
  const rel = (abs: string): string => relativeTo(root, abs);
  return {
    paths: { requirements: rel(config.abs.requirements), requirementsIndex: config.paths.requirementsIndex, features: rel(config.abs.features), architecture: rel(config.abs.architecture), plansDir: rel(config.abs.plans), subprojects: subprojectsOf(config.values["subprojects"]) },
    findings: findings.map((f) => ({ severity: f.severity, message: f.message })),
  };
}

function subprojectsOf(v: unknown): SpecPaths["subprojects"] {
  return Array.isArray(v) ? v.map((x: { name: string; path: string }) => ({ name: x.name, dir: x.path })) : [];
}
