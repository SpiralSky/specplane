/**
 * The credential heuristic for test result summaries (`architecture/reference-cli` §6.2, `verification R61.3`): a
 * token name such as key, secret, password or token followed by `=` or `:` and a value, or a string of 32 or more hex
 * or base64 characters (base64 must mix letters and digits, so a long lower-case path does not match). A match is a
 * warning only; the result is still recorded.
 */

const NAMED = /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|private[_-]?key|key|secret|passw(?:or)?d|token|credentials?)s?\b["']?\s*[:=]\s*["']?[^\s"']{4,}/i;
const HEX = /\b[0-9a-f]{32,}\b/i;
const BASE64 = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

export function looksLikeCredential(text: string): boolean {
  if (NAMED.test(text) || HEX.test(text)) return true;
  for (const m of text.match(BASE64) ?? []) if (/[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m)) return true;
  return false;
}
