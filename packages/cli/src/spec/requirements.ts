import { fencedLines } from "./sections.js";

/** Requirement markers, ID tree and retired list (`architecture/file-formats` §1.2, §1.3). */

export interface Requirement {
  id: string;
  title: string;
  file: string;
  /** 1-based marker line. */
  startLine: number;
  /** 1-based last line of the requirement's text, including its sub-requirements. */
  endLine: number;
  text: string;
}

export interface RequirementFile {
  file: string;
  text: string;
  requirements: Requirement[];
  /** Retired IDs from a `Retired IDs:` line, with that line's number. */
  retired: { ids: string[]; line: number } | null;
}

const MARKER = /^(\*\*|\*)(R\d+(?:\.\d+)*): (.+?)\1\s*$/;
const HEADING = /^#{1,6} /;

export const reqDepth = (id: string): number => id.split(".").length;

export function parseRequirementFile(file: string, text: string): RequirementFile {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  const marks: { id: string; title: string; line: number }[] = [];
  const stops: number[] = [];
  let retired: RequirementFile["retired"] = null;
  lines.forEach((raw, i) => {
    if (fenced[i]) return;
    const m = MARKER.exec(raw);
    if (m) marks.push({ id: m[2], title: m[3], line: i + 1 });
    else if (HEADING.test(raw)) stops.push(i + 1);
    const r = /^Retired IDs:\s*(.*)$/.exec(raw);
    if (r && !retired) retired = { ids: [...r[1].matchAll(/`(R\d+(?:\.\d+)*)`/g)].map((x) => x[1]), line: i + 1 };
  });
  const requirements: Requirement[] = marks.map((mk, idx) => {
    const depth = reqDepth(mk.id);
    let end = lines.length;
    for (let j = idx + 1; j < marks.length; j++) {
      if (reqDepth(marks[j].id) <= depth) { end = marks[j].line - 1; break; }
    }
    for (const s of stops) if (s > mk.line && s - 1 < end) { end = s - 1; break; }
    return { id: mk.id, title: mk.title, file, startLine: mk.line, endLine: end, text: lines.slice(mk.line - 1, end).join("\n") };
  });
  return { file, text, requirements, retired };
}

/** File names listed as `- <file-name>: <description>` in a central requirements file. */
export function listedFiles(text: string): string[] {
  return [...text.matchAll(/^[-*] +([^\s:]+\.md):/gm)].map((m) => m[1]);
}

/** Next free top-level ID: the highest ever used (live or retired) plus one. */
export function nextRequirementId(files: RequirementFile[]): string {
  let max = 0;
  const seen = (id: string) => { const n = Number(/^R(\d+)/.exec(id)![1]); if (n > max) max = n; };
  for (const f of files) {
    f.requirements.forEach((r) => seen(r.id));
    f.retired?.ids.forEach(seen);
  }
  return `R${max + 1}`;
}

export interface RequirementProblem { message: string; file: string; line?: number }

/** ID rules (`file-formats` §1.3): duplicates, live IDs that are retired, orphan sub-IDs. */
export function checkRequirementIds(files: RequirementFile[], centralFile: string | null): RequirementProblem[] {
  const out: RequirementProblem[] = [];
  const firstSeen = new Map<string, Requirement>();
  const retired = new Set<string>();
  const central = files.find((f) => f.file === centralFile) ?? files.find((f) => f.retired);
  central?.retired?.ids.forEach((id) => retired.add(id));
  for (const f of files) {
    if (f.retired && f !== central) out.push({ file: f.file, line: f.retired.line, message: "only the central requirements file may carry a `Retired IDs:` line" });
    for (const r of f.requirements) {
      const prior = firstSeen.get(r.id);
      if (prior) out.push({ file: r.file, line: r.startLine, message: `duplicate requirement ID ${r.id} (also at ${prior.file}:${prior.startLine})` });
      else firstSeen.set(r.id, r);
      if (retired.has(r.id)) out.push({ file: r.file, line: r.startLine, message: `requirement ID ${r.id} is on the retired list and may not be reused` });
    }
  }
  for (const r of firstSeen.values()) {
    if (reqDepth(r.id) > 1) {
      const parent = r.id.slice(0, r.id.lastIndexOf("."));
      if (!firstSeen.has(parent)) out.push({ file: r.file, line: r.startLine, message: `sub-requirement ${r.id} has no parent ${parent}` });
    }
  }
  return out;
}
