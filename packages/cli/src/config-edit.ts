import * as yaml from "js-yaml";

/**
 * Textual edit of nested keys in `.specplane/config.yaml`: comments, other keys and key order stay byte for byte
 * (`architecture/reference-cli` §3.2). Only the edited entry is re-rendered.
 */

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const KEY = /^( *)([A-Za-z0-9_-]+):(.*)$/;

function render(key: string, value: unknown, indent: number): string[] {
  const flat = Array.isArray(value) && value.every((x) => x === null || typeof x !== "object");
  const text = yaml.dump({ [key]: value }, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true, flowLevel: flat ? 1 : -1, sortKeys: false });
  const pad = " ".repeat(indent);
  // js-yaml quotes the words on and off; the configuration writes them bare (`file-formats` §6).
  return text.replace(/\n$/, "").split("\n").map((l) => pad + l.replace(/^(\s*[A-Za-z0-9_-]+: )'(on|off)'$/, "$1$2"));
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const isBlank = (l: string) => l.trim() === "" || l.trim().startsWith("#");

interface Entry { key: string; start: number; end: number }

/** Entries at exactly `indent` inside lines [lo, hi). An entry ends before trailing blank and comment lines of its own level or less. */
function entries(lines: string[], lo: number, hi: number, indent: number): Entry[] {
  const out: Entry[] = [];
  for (let i = lo; i < hi; i++) {
    const m = KEY.exec(lines[i]);
    if (m && m[1].length === indent) out.push({ key: m[2], start: i, end: hi });
  }
  for (let n = 0; n < out.length; n++) if (n + 1 < out.length) out[n].end = out[n + 1].start;
  for (const e of out) {
    while (e.end - 1 > e.start && isBlank(lines[e.end - 1]) && (lines[e.end - 1].trim() === "" || indentOf(lines[e.end - 1]) <= indent)) e.end--;
  }
  return out;
}

function edit(lines: string[], lo: number, hi: number, indent: number, segs: string[], value: unknown): string[] {
  const es = entries(lines, lo, hi, indent);
  const hit = es.find((e) => e.key === segs[0]);
  const rest = segs.slice(1);
  const tail = es.length ? es[es.length - 1].end : lo;
  const wrap = (v: unknown): unknown => rest.reduceRight<unknown>((acc, k) => ({ [k]: acc }), v);
  if (!hit) {
    if (value === undefined) return lines;
    const ins = render(segs[0], wrap(value), indent);
    return [...lines.slice(0, tail), ...ins, ...lines.slice(tail)];
  }
  if (rest.length === 0) {
    const ins = value === undefined ? [] : render(segs[0], value, indent);
    return [...lines.slice(0, hit.start), ...ins, ...lines.slice(hit.end)];
  }
  const head = KEY.exec(lines[hit.start])!;
  const inline = head[3].replace(/#.*$/, "").trim() !== "";
  if (!inline && hit.end > hit.start + 1) {
    const first = lines.slice(hit.start + 1, hit.end).find((l) => !isBlank(l));
    const child = first ? indentOf(first) : indent + 2;
    const next = edit(lines, hit.start + 1, hit.end, child, rest, value);
    // Drop a parent that lost its last child.
    const after = entries(next, hit.start + 1, hit.end + (next.length - lines.length), child);
    if (value === undefined && after.length === 0) return [...next.slice(0, hit.start), ...next.slice(hit.end + (next.length - lines.length))];
    return next;
  }
  // Inline or empty value: re-render the entry from its parsed content.
  let current: unknown = {};
  try { current = (yaml.load(lines.slice(hit.start, hit.end).join("\n").replace(/^ +/, ""), { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>)[segs[0]] ?? {}; } catch { current = {}; }
  if (!isMap(current)) current = {};
  const obj = current as Record<string, unknown>;
  let cur = obj;
  for (const k of rest.slice(0, -1)) { if (!isMap(cur[k])) cur[k] = {}; cur = cur[k] as Record<string, unknown>; }
  const last = rest[rest.length - 1];
  if (value === undefined) delete cur[last]; else cur[last] = value;
  const ins = Object.keys(obj).length === 0 && value === undefined ? [] : render(segs[0], obj, indent);
  return [...lines.slice(0, hit.start), ...ins, ...lines.slice(hit.end)];
}

/** Set (`value` defined) or remove (`undefined`) the setting at the dotted `key`; returns the new file text. */
export function editConfig(text: string, key: string, value: unknown): string {
  const hadFinalNewline = text === "" || text.endsWith("\n");
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const out = edit(lines, 0, lines.length, 0, key.split("."), value);
  const body = out.join("\n");
  return body === "" ? "" : body + (hadFinalNewline ? "\n" : "");
}
