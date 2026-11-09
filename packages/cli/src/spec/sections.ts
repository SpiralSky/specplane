/** Headings and section ranges (`architecture/reference-cli` §4.2, `architecture/file-formats` §3.3). */

export interface Section {
  /** `R11.2` or `§2`; null for a heading that is not citable. */
  id: string | null;
  level: number;
  /** 1-based file line of the heading. */
  startLine: number;
  /** 1-based file line of the last line of the section (the line before the next heading of equal or lower level). */
  endLine: number;
  title: string;
}

const HEADING = /^(#{1,6}) +(.*)$/;
const CITABLE = /^(R\d+(?:\.\d+)*:|§\d+(?:\.\d+)*) +\S/;

/** Lines of `text` that are outside fenced code blocks, as 1-based numbers; fenced lines are flagged. */
export function fencedLines(lines: string[]): boolean[] {
  const flags: boolean[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      flags.push(true);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
    } else if (m) {
      fence = { ch: m[1][0], len: m[1].length };
      flags.push(true);
    } else flags.push(false);
  }
  return flags;
}

export interface SectionIndex {
  sections: Section[];
  /** Citable sections by id (first occurrence). */
  byId: Map<string, Section>;
  duplicates: { id: string; first: number; second: number }[];
  wrongParent: { id: string; line: number; parentId: string; foundUnder: string }[];
}

/** Index the headings of a file; only lines from `bodyStartLine` on are scanned. */
export function indexSections(lines: string[], bodyStartLine: number): SectionIndex {
  const fenced = fencedLines(lines);
  const heads: Section[] = [];
  for (let i = bodyStartLine; i < lines.length; i++) {
    if (fenced[i]) continue;
    const line = lines[i].replace(/\r$/, "");
    const m = HEADING.exec(line);
    if (!m) continue;
    const level = m[1].length;
    const rest = m[2].trimEnd();
    let id: string | null = null;
    if (level >= 2 && CITABLE.test(rest)) {
      const idm = /^(R\d+(?:\.\d+)*|§\d+(?:\.\d+)*)/.exec(rest)!;
      id = idm[1];
    }
    heads.push({ id, level, startLine: i + 1, endLine: lines.length, title: rest });
  }
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[i].level) { heads[i].endLine = heads[j].startLine - 1; break; }
    }
  }
  const byId = new Map<string, Section>();
  const duplicates: SectionIndex["duplicates"] = [];
  for (const h of heads) {
    if (!h.id) continue;
    const prior = byId.get(h.id);
    if (prior) duplicates.push({ id: h.id, first: prior.startLine, second: h.startLine });
    else byId.set(h.id, h);
  }
  const wrongParent: SectionIndex["wrongParent"] = [];
  const stack: Section[] = [];
  for (const h of heads) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (h.id && h.id.startsWith("R") && h.id.includes(".")) {
      const parent = stack[stack.length - 1];
      const parentId = h.id.slice(0, h.id.lastIndexOf("."));
      if (parent?.id && parent.id.startsWith("R") && parent.id !== parentId) {
        wrongParent.push({ id: h.id, line: h.startLine, parentId, foundUnder: parent.id });
      }
    }
    stack.push(h);
  }
  return { sections: heads, byId, duplicates, wrongParent };
}

/** The innermost section containing a 1-based line, or undefined. */
export function sectionAt(index: SectionIndex, line: number): Section | undefined {
  let best: Section | undefined;
  for (const s of index.sections) {
    if (s.startLine <= line && line <= s.endLine && (!best || s.level >= best.level)) best = s;
  }
  return best;
}
