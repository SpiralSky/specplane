import { parseYaml } from "../yaml.js";

/** Result of splitting a spec file at its frontmatter fences (`architecture/reference-cli` §4.1). */
export interface FrontmatterResult {
  /** Parsed mapping, or null when there is none or it is invalid. */
  data: Record<string, unknown> | null;
  /** Text after the closing fence line and its newline (empty when there is no frontmatter). */
  body: string;
  /** Number of lines before the body starts (the body's first line is file line `bodyStartLine + 1`). */
  bodyStartLine: number;
  /** Why the frontmatter is missing or unusable. */
  error?: string;
  /** True when the file does not start with a `---` line at all. */
  missing?: boolean;
}

/**
 * Split at the first line `---` and the next line that is exactly `---`. The block is parsed as
 * JSON-compatible YAML with string keys and no duplicate keys; dates stay strings.
 */
export function splitFrontmatter(text: string): FrontmatterResult {
  const lines = text.split("\n");
  const stripCr = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
  if (stripCr(lines[0] ?? "") !== "---") {
    return { data: null, body: text, bodyStartLine: 0, error: "file does not start with a `---` frontmatter line", missing: true };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (stripCr(lines[i]) === "---") { close = i; break; }
  }
  if (close < 0) return { data: null, body: "", bodyStartLine: lines.length, error: "frontmatter is not closed by a `---` line" };
  const body = lines.slice(close + 1).join("\n");
  const base = { body, bodyStartLine: close + 1 };
  let data: unknown;
  try {
    data = parseYaml(lines.slice(1, close).map(stripCr).join("\n"));
  } catch (e) {
    return { data: null, ...base, error: `invalid YAML frontmatter: ${(e as Error).message.split("\n")[0]}` };
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) return { data: null, ...base, error: "frontmatter is not a mapping" };
  return { data: data as Record<string, unknown>, ...base };
}
