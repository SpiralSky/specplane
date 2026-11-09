import { loadSettings } from "../config.js";

/** The configuration values the spec reader needs; they come from `config.ts` (`architecture/file-formats` §6). */
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

/** Read the paths from the configuration; a bad key is dropped with a finding and its default used (`reference-cli` §3.2). */
export function loadSpecPaths(root: string): { paths: SpecPaths; findings: ConfigFinding[] } {
  const { config, findings } = loadSettings(root);
  return {
    paths: { requirements: config.paths.requirements, requirementsIndex: config.paths.requirementsIndex, features: config.paths.features, architecture: config.paths.architecture, plansDir: config.plans.dir },
    findings: findings.map((f) => ({ severity: f.severity, message: f.message })),
  };
}
