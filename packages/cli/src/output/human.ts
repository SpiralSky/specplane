import { subjectOf } from "../report.js";
import type { Finding, ValidationReport } from "../types.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Human-readable validation output (`architecture/reference-cli` § Validation output format). */
export function formatHuman(report: ValidationReport): string {
  const all: Finding[] = [...report.errors, ...report.warnings];
  const bySubject = new Map<string, Finding[]>();
  for (const s of report.checked ?? []) bySubject.set(s, []);
  for (const f of all) bySubject.set(subjectOf(f), [...(bySubject.get(subjectOf(f)) ?? []), f]);

  const lines: string[] = [];
  for (const [subject, findings] of bySubject) {
    const e = findings.filter((f) => f.severity === "error").length;
    const w = findings.length - e;
    const summary = findings.length === 0 ? "OK" : [e ? plural(e, "error") : "", w ? plural(w, "warning") : ""].filter(Boolean).join(", ");
    lines.push(`Checking ${subject}... ${summary}`);
    for (const f of findings) {
      const where = f.line !== undefined ? `${subject}:${f.line}` : subject;
      lines.push(`  [${f.severity}] ${where}: ${f.message}`);
    }
  }
  if (lines.length > 0) lines.push("");
  lines.push(`Summary: ${plural(bySubject.size, "file")} checked, ${plural(report.errors.length, "error")}, ${plural(report.warnings.length, "warning")}`);
  return lines.join("\n") + "\n";
}
