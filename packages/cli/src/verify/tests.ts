import * as yaml from "js-yaml";
import * as path from "node:path";
import type { SpecDoc } from "../spec/project.js";
import type { TestLine } from "../spec/sections.js";

/**
 * Test declarations (`architecture/reference-cli` §10.1, `architecture/file-formats` §11.2): the labelled Test lines of
 * a spec, their IDs, the runnable `specplane-test` blocks and the effective declaration of each section.
 */

export interface Expect {
  exit: number;
  stdoutContains: string[];
  stderrContains: string[];
  stdoutEquals?: string;
}

/** A parsed `specplane-test` block: argv without a shell, no shell features (`§10.1`). */
export interface RunDef {
  run: string[];
  /** Relative to the checkout; never leaves it. */
  cwd: string;
  setup: string[][];
  expect: Expect;
}

export interface TestDef {
  /** `<section id>#T<n>`, or `<spec id>#T<n>` for a preamble test. The label, never the position, makes the ID. */
  id: string;
  spec: string;
  /** Citable section the test is declared in; null in the preamble. */
  sectionId: string | null;
  label: string;
  kind: "deterministic" | "intelligent";
  text: string;
  line: number;
  /** The runnable definition; absent when there is no block or it is invalid. */
  def?: RunDef;
  /** Why the block is unusable (a validation error), when there is one. */
  blockError?: string;
  blockLine?: number;
  /** The label is declared twice in its section: the section's tests are not run. */
  duplicate: boolean;
}

export interface SectionDecl {
  id: string;
  own: TestDef[];
  /** Where the effective declaration comes from: the section's own lines, the spec's preamble, or nowhere. */
  effective: "own" | "spec" | "none";
  /** The effective declaration includes intelligent judgement (or declares nothing), so `<id>#0` is required. */
  needsVerdict: boolean;
  verdictId: string;
}

export interface SpecDecl {
  spec: string;
  preamble: TestDef[];
  sections: SectionDecl[];
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isArgv = (v: unknown): v is string[] => isStrings(v) && v.length > 0 && v.every((x) => x !== "") ;

/** Parse the YAML of a `specplane-test` block (`§10.1`). Returns the definition or the first problem. */
export function parseBlock(text: string): { def: RunDef } | { error: string } {
  let raw: unknown;
  try { raw = yaml.load(text, { schema: yaml.JSON_SCHEMA }); } catch (e) { return { error: `specplane-test block is not valid YAML: ${(e as Error).message.split("\n")[0]}` }; }
  if (!isMap(raw)) return { error: "specplane-test block must be a mapping with `run`" };
  for (const k of Object.keys(raw)) if (!["run", "cwd", "setup", "expect"].includes(k)) return { error: `specplane-test block has unknown key \`${k}\`` };
  if (!isArgv(raw.run)) return { error: "`run` must be a non-empty list of strings (an argv array, no shell)" };
  let cwd = ".";
  if (raw.cwd !== undefined) {
    if (typeof raw.cwd !== "string" || !raw.cwd) return { error: "`cwd` must be a non-empty string" };
    const norm = path.posix.normalize(raw.cwd);
    if (path.posix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) return { error: "`cwd` must stay inside the checkout" };
    cwd = norm;
  }
  let setup: string[][] = [];
  if (raw.setup !== undefined) {
    if (!Array.isArray(raw.setup) || !raw.setup.every(isArgv)) return { error: "`setup` must be a list of argv arrays" };
    setup = raw.setup as string[][];
  }
  const expect: Expect = { exit: 0, stdoutContains: [], stderrContains: [] };
  if (raw.expect !== undefined) {
    if (!isMap(raw.expect)) return { error: "`expect` must be a mapping" };
    for (const [k, v] of Object.entries(raw.expect)) {
      if (k === "exit") { if (!Number.isInteger(v)) return { error: "`expect.exit` must be an integer" }; expect.exit = v as number; }
      else if (k === "stdout-contains" || k === "stderr-contains") {
        if (!isStrings(v)) return { error: `\`expect.${k}\` must be a list of strings` };
        (k === "stdout-contains" ? expect.stdoutContains : expect.stderrContains).push(...v);
      } else if (k === "stdout-equals") {
        if (typeof v !== "string") return { error: "`expect.stdout-equals` must be a string" };
        expect.stdoutEquals = v;
      } else return { error: `unknown \`expect\` key \`${k}\` (exit, stdout-contains, stderr-contains, stdout-equals)` };
    }
  }
  return { def: { run: raw.run, cwd, setup, expect } };
}

function toDef(doc: SpecDoc, t: TestLine, dups: Set<string>): TestDef {
  const id = `${t.sectionId ?? doc.id}#${t.label}`;
  const out: TestDef = { id, spec: doc.id, sectionId: t.sectionId, label: t.label, kind: t.kind, text: t.text, line: t.line, duplicate: dups.has(`${t.sectionId ?? ""}\0${t.label}`) };
  if (t.block) {
    out.blockLine = t.block.line;
    const parsed = parseBlock(t.block.text);
    if ("def" in parsed) out.def = parsed.def; else out.blockError = parsed.error;
  }
  return out;
}

/**
 * The declarations of one spec. A section's effective declaration is its own Test lines, else the spec's preamble
 * lines; a spec that declares neither is judged by intelligence, so every section needs the `<id>#0` verdict
 * (`verification R36.1`). Requirement files declare nothing.
 */
export function declarations(doc: SpecDoc): SpecDecl {
  const dups = new Set(doc.index.duplicateTests.map((d) => `${d.sectionId ?? ""}\0${d.label}`));
  const all = doc.layer === "requirement" ? [] : doc.index.tests.map((t) => toDef(doc, t, dups));
  const preamble = all.filter((t) => t.sectionId === null);
  const sections: SectionDecl[] = [];
  for (const [id] of doc.index.byId) {
    const own = all.filter((t) => t.sectionId === id);
    const effective = own.length ? "own" : preamble.length ? "spec" : "none";
    const lines = effective === "own" ? own : preamble;
    sections.push({ id, own, effective, needsVerdict: effective === "none" || lines.some((t) => t.kind === "intelligent"), verdictId: `${id}#0` });
  }
  return { spec: doc.id, preamble, sections };
}

/** Every test the spec declares itself: the preamble's and each section's own, in file order. */
export function allTests(decl: SpecDecl): TestDef[] {
  return [...decl.preamble, ...decl.sections.flatMap((s) => s.own)].sort((a, b) => a.line - b.line);
}
