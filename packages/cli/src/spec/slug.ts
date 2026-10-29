/** Heading slugs and anchor matching (`architecture/file-formats` §1.5, §3.2). */

export interface Heading {
  level: number;
  text: string;
  line: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;

/** Remove inline code markup. */
function plain(text: string): string {
  return text.replace(/`/g, "").trim();
}

/** GitHub-style heading slug. */
export function slugify(text: string): string {
  return plain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** ATX headings outside fenced code blocks, with 1-based line numbers. */
export function headings(body: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  body.split(/\r?\n/).forEach((line, i) => {
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return out;
}

/**
 * First H2/H3 heading matching `anchor`: compared case-insensitively with inline code markup and
 * any leading section number removed; equal to the anchor or beginning with it plus a space.
 */
export function findHeading(body: string, anchor: string): Heading | undefined {
  const norm = (s: string) => plain(s).replace(/^\d+(?:\.\d+)*\.?\s+/, "").toLowerCase().trim();
  const want = norm(anchor);
  return headings(body).find((h) => {
    if (h.level !== 2 && h.level !== 3) return false;
    const t = norm(h.text);
    return t === want || t.startsWith(want + " ");
  });
}

/** True when `anchor` (a heading slug or heading text) matches a heading of `body`. */
export function hasAnchor(body: string, anchor: string): boolean {
  const want = slugify(anchor);
  return headings(body).some((h) => slugify(h.text) === want) || findHeading(body, anchor) !== undefined;
}
