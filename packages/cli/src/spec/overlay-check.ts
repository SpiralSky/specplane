/** Overlay contradiction heuristics (`architecture/reference-cli` § Spec validation). No LLM involved. */

export interface Sentence {
  text: string;
  /** 1-based line within the body. */
  line: number;
}

export interface OverlayMatch {
  /** Sentence in the overlay spec (or the base, when `inOverlay` is false) with the negation. */
  negative: Sentence;
  other: Sentence;
  /** True when the negative sentence is in the overlay spec. */
  inOverlay: boolean;
  shared: string[];
}

const NEGATION = /\b(?:must not|never|may not)\b/i;
const STOP = new Set(
  ("this that these those with from have been being will would shall should could their there which when where while " +
    "than then them they into onto also only each every both such same other more most some any does done doing " +
    "must about after before under over between within without upon via using used uses use make made " +
    "spec specs file files").split(/\s+/),
);

/** Sentences outside fenced code blocks, split at sentence ends and list items. */
export function sentences(body: string): Sentence[] {
  const out: Sentence[] = [];
  let fence: string | null = null;
  body.split(/\r?\n/).forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null || /^\s*#/.test(line)) return;
    for (const part of line.split(/(?<=[.!?;])\s+/)) {
      const text = part.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
      if (text !== "") out.push({ text, line: i + 1 });
    }
  });
  return out;
}

/** Significant words: lowercase words of 4+ letters that are not stop words (crude noun proxy). */
export function significant(text: string): Set<string> {
  const words = text.toLowerCase().replace(/`/g, "").match(/[a-z][a-z-]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)).map((w) => w.replace(/s$/, "")));
}

/**
 * Negated sentences in either spec paired with a non-negated sentence in the other that shares at
 * least two significant words. At most one match per negated sentence.
 */
export function checkOverlayContradictions(overlayBody: string, baseBody: string): OverlayMatch[] {
  const a = sentences(overlayBody);
  const b = sentences(baseBody);
  const out: OverlayMatch[] = [];
  const scan = (negs: Sentence[], others: Sentence[], inOverlay: boolean) => {
    for (const neg of negs) {
      if (!NEGATION.test(neg.text)) continue;
      const words = significant(neg.text);
      for (const other of others) {
        if (NEGATION.test(other.text)) continue;
        const shared = [...significant(other.text)].filter((w) => words.has(w));
        if (shared.length >= 2) {
          out.push({ negative: neg, other, inOverlay, shared });
          break;
        }
      }
    }
  };
  scan(a, b, true);
  scan(b, a, false);
  return out;
}
