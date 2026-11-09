import { PlanStateError } from "../errors.js";

/** Preserve the original BOM, line endings, delimiters, and body byte for byte. */
function parts(text: string): { opening: string; header: string; rest: string; newline: string } {
  const match = /^(\uFEFF?---(\r?\n))([\s\S]*?)(\r?\n---(?=\r?\n|$)[\s\S]*)$/.exec(text);
  if (!match) throw new PlanStateError("Cannot safely edit plan frontmatter.");
  return { opening: match[1], newline: match[2], header: match[3], rest: match[4] };
}
export function claimFrontmatter(text: string): string {
  const p = parts(text);
  if (!/^status:[^\r\n]*$/m.test(p.header)) throw new PlanStateError("Cannot safely edit claim status.");
  return p.opening + p.header.replace(/^status:[^\r\n]*/m, "status: in_progress") + p.rest;
}
export function bindFrontmatter(text: string, target: string, startBase: string): string {
  const p = parts(text);
  if (/^execution:/m.test(p.header)) throw new PlanStateError("Cannot add execution binding to plan frontmatter.");
  const n = p.newline, encoded = JSON.stringify(target);
  return `${p.opening}${p.header}${n}execution:${n}  target_branch: ${encoded}${n}  start_target_branch: ${encoded}${n}  start_base: ${startBase}${p.rest}`;
}
