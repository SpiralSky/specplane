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

/** A labelled `Test T<n> (deterministic|intelligent): ...` line (`architecture/reference-cli` §4.2, `architecture/file-formats` §11.2). */
export interface TestLine {
  /** Citable section the line is in; null for the spec's preamble (a line outside every citable section). */
  sectionId: string | null;
  /** `T1`, `T2`, ... */
  label: string;
  kind: "deterministic" | "intelligent";
  /** What and how, from the line. */
  text: string;
  /** 1-based file line. */
  line: number;
  /** The `specplane-test` fenced block that follows the line (`architecture/reference-cli` §10.1), unparsed. */
  block?: { text: string; line: number };
}

export interface SectionIndex {
  sections: Section[];
  tests: TestLine[];
  /** Two Test lines with one label in one section (or both in the preamble). */
  duplicateTests: { sectionId: string | null; label: string; first: number; second: number }[];
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
  const { tests, duplicateTests } = collectTests(lines, fenced, heads, bodyStartLine);
  return { sections: heads, tests, duplicateTests, byId, duplicates, wrongParent };
}

const TEST_LINE = /^\s*(?:[-*]\s+)?Test (T\d+) \((deterministic|intelligent)\):\s*(.*)$/;
const BLOCK_OPEN = /^ {0,3}(`{3,}|~{3,})\s*specplane-test\s*$/;

/**
 * The Test lines outside fenced code, each with its owning citable section. A runnable block belongs to a Test line
 * when it comes after the line's paragraph with only blank lines between (assumption for `§10.1`: "before the next
 * blank-line-separated paragraph" is read as "no other paragraph in between").
 */
function collectTests(lines: string[], fenced: boolean[], heads: Section[], bodyStartLine: number): Pick<SectionIndex, "tests" | "duplicateTests"> {
  const tests: TestLine[] = [];
  const duplicateTests: SectionIndex["duplicateTests"] = [];
  const stack: Section[] = [];
  const headAt = new Map(heads.map((h) => [h.startLine, h]));
  const seen = new Map<string, number>();
  for (let i = bodyStartLine; i < lines.length; i++) {
    if (fenced[i]) continue;
    const head = headAt.get(i + 1);
    if (head) {
      while (stack.length && stack[stack.length - 1].level >= head.level) stack.pop();
      stack.push(head);
      continue;
    }
    const m = TEST_LINE.exec(lines[i].replace(/\r$/, ""));
    if (!m) continue;
    const owner = [...stack].reverse().find((h) => h.id)?.id ?? null;
    const t: TestLine = { sectionId: owner, label: m[1], kind: m[2] as TestLine["kind"], text: m[3].trim(), line: i + 1 };
    const key = `${owner ?? ""}\0${t.label}`;
    const prior = seen.get(key);
    if (prior !== undefined) duplicateTests.push({ sectionId: owner, label: t.label, first: prior, second: t.line });
    else seen.set(key, t.line);
    t.block = findBlock(lines, i);
    if (!t.block) delete t.block;
    tests.push(t);
  }
  return { tests, duplicateTests };
}

function findBlock(lines: string[], testIndex: number): TestLine["block"] | undefined {
  let j = testIndex + 1;
  while (j < lines.length && lines[j].trim() !== "" && !BLOCK_OPEN.test(lines[j]) && !HEADING.test(lines[j]) && !TEST_LINE.test(lines[j])) j++;
  while (j < lines.length && lines[j].trim() === "") j++;
  const open = j < lines.length ? BLOCK_OPEN.exec(lines[j].replace(/\r$/, "")) : null;
  if (!open) return undefined;
  const body: string[] = [];
  for (let k = j + 1; k < lines.length; k++) {
    const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[k].replace(/\r$/, ""));
    if (m && m[1][0] === open[1][0] && m[1].length >= open[1].length) return { text: body.join("\n"), line: j + 1 };
    body.push(lines[k].replace(/\r$/, ""));
  }
  return { text: body.join("\n"), line: j + 1 };
}

/** The innermost section containing a 1-based line, or undefined. */
export function sectionAt(index: SectionIndex, line: number): Section | undefined {
  let best: Section | undefined;
  for (const s of index.sections) {
    if (s.startLine <= line && line <= s.endLine && (!best || s.level >= best.level)) best = s;
  }
  return best;
}
