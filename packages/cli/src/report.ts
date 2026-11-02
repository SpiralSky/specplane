import type { Finding, FindingType, Severity, ValidationReport } from "./types.js";

/** Build a finding; `extra` carries `spec`/`plan`/`adr`/`line`. */
export function finding(
  severity: Severity,
  type: FindingType,
  file: string,
  message: string,
  extra: Partial<Pick<Finding, "spec" | "plan" | "adr" | "line">> = {},
): Finding {
  return { file, message, severity, type, ...extra };
}

/** Assemble a report from findings; `valid` is true when there are no errors. */
export function makeReport(findings: Finding[], checked: Iterable<string> = []): ValidationReport {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  return { valid: errors.length === 0, errors, warnings, checked: [...new Set(checked)] };
}

/** Merge reports, keeping finding order and the union of checked subjects. */
export function mergeReports(...reports: ValidationReport[]): ValidationReport {
  const report = makeReport(
    reports.flatMap((r) => [...r.errors, ...r.warnings]),
    reports.flatMap((r) => r.checked ?? []),
  );
  report.implementations = reports.flatMap(r => r.implementations ?? []);
  return report;
}

/** Subject a finding is reported under in the human-readable output. */
export function subjectOf(f: Finding): string {
  return f.spec ?? f.plan ?? f.adr ?? f.file;
}
