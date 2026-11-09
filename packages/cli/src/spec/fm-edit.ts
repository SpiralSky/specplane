import * as yaml from "js-yaml";
import { splitFrontmatter } from "./frontmatter.js";

/**
 * Textual edits of top-level frontmatter keys. Other keys, comments and key order are kept byte for byte
 * (`architecture/reference-cli` §13.2: metadata writes touch only the keys they write).
 */

/** Order new keys are inserted in (`architecture/file-formats` §2). */
const ORDER = ["id", "title", "status", "approval", "review-reason", "authors", "covers", "implements", "references", "results", "implementation"];
const FLOW_KEYS = new Set(["covers", "implements", "references"]);

/** Render `key: value` as YAML lines (lists of cites in flow style, everything else in block style). */
export function renderKey(key: string, value: unknown): string[] {
  const text = yaml.dump({ [key]: value }, {
    schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true, flowLevel: FLOW_KEYS.has(key) ? 1 : -1, sortKeys: false,
  });
  return text.replace(/\n$/, "").split("\n");
}

interface Block { key: string; start: number; end: number }

function blocks(lines: string[], close: number): Block[] {
  const out: Block[] = [];
  for (let i = 1; i < close; i++) {
    const m = /^([A-Za-z0-9_-]+):/.exec(lines[i]);
    if (m) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ key: m[1], start: i, end: close });
    }
  }
  return out;
}

function closeLine(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) if (lines[i].replace(/\r$/, "") === "---") return i;
  throw new Error("frontmatter is not closed");
}

/** Set (`value` defined) or remove (`undefined`) top-level keys; returns the new file text. */
export function editKeys(text: string, edits: Record<string, unknown | undefined>): string {
  let lines = text.split("\n");
  for (const [key, value] of Object.entries(edits)) {
    const close = closeLine(lines);
    const bs = blocks(lines, close);
    const hit = bs.find((b) => b.key === key);
    const rendered = value === undefined ? [] : renderKey(key, value);
    if (hit) lines.splice(hit.start, hit.end - hit.start, ...rendered);
    else if (value !== undefined) {
      const rank = ORDER.indexOf(key);
      const later = bs.find((b) => { const r = ORDER.indexOf(b.key); return rank >= 0 && r > rank; });
      lines.splice(later ? later.start : close, 0, ...rendered);
    }
  }
  const out = lines.join("\n");
  const check = splitFrontmatter(out);
  if (!check.data) throw new Error(`edited frontmatter is not valid: ${check.error}`);
  return out;
}
