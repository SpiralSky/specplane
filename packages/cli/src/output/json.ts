import type { ValidationReport } from "../types.js";

/** JSON validation output: `{ valid, errors, warnings }`. */
export function formatJson(report: ValidationReport): string {
  return JSON.stringify({ valid: report.valid, errors: report.errors, warnings: report.warnings, implementations: report.implementations ?? [] }, null, 2) + "\n";
}
