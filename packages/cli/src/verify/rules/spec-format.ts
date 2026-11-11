import { parseCite } from "../../spec/cites.js";
import { LEGACY_RECORD_KEYS } from "../../spec/fingerprint.js";
import type { SpecDoc } from "../../spec/project.js";
import { collector, type Emit, type Rule } from "./types.js";

const KNOWN_KEYS = new Set(["id", "title", "authors", "covers", "implements", "references"]);
const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkAuthorItem(v: unknown, where: string, allowDelegated: boolean): string | null {
  if (!isMap(v)) return `${where} must be a mapping with \`human\` or \`llm\``;
  const keys = Object.keys(v);
  const who = ["human", "llm"].filter((k) => k in v);
  if (who.length !== 1) return `${where} needs exactly one of \`human\` or \`llm\``;
  if (typeof v[who[0]] !== "string" || !(v[who[0]] as string).trim()) return `${where}.${who[0]} must be a non-empty string`;
  const extra = keys.filter((k) => k !== who[0] && k !== "contribution" && !(allowDelegated && k === "delegated-by"));
  if (extra.length) return `${where} has unknown field \`${extra[0]}\``;
  if ("contribution" in v && typeof v.contribution !== "string") return `${where}.contribution must be a string`;
  if ("delegated-by" in v && (typeof v["delegated-by"] !== "string" || !v["delegated-by"])) return `${where}.delegated-by must be a non-empty string`;
  if ("delegated-by" in v && !("llm" in v)) return `${where}.delegated-by is only valid on an LLM approver`;
  return null;
}

/** Frontmatter and heading rules for one spec (`architecture/file-formats` §2.1). */
export function checkSpecFormat(doc: SpecDoc, emit: Emit): void {
  const f = doc.file;
  const err = (m: string) => emit("error", "spec-format", m, f, 1);
  // A requirement file always has status Approved; its frontmatter is optional and every key in it is optional (`file-formats` §1.2).
  const isReq = doc.layer === "requirement";
  if (isReq && doc.fm.missing) return;
  if (doc.fm.error || !doc.fm.data) { err(doc.fm.error ?? "frontmatter is missing"); return; }
  const d = doc.fm.data;
  if (isReq ? d.id !== undefined && d.id !== doc.id : d.id !== doc.id) err(`id is ${JSON.stringify(d.id)} but the path gives ${doc.id}`);
  if (isReq ? d.title !== undefined && (typeof d.title !== "string" || !d.title.trim() || d.title.includes("\n")) : typeof d.title !== "string" || !d.title.trim() || d.title.includes("\n")) err("title must be a non-empty single line");
  if (d.authors === undefined && isReq) { /* optional on requirement files */ }
  else if (!Array.isArray(d.authors)) err("authors is required and must be a list (it may be empty)");
  else d.authors.forEach((a, i) => { const m = checkAuthorItem(a, `authors[${i}]`, false); if (m) err(m); });
  for (const k of ["covers", "implements", "references"] as const) {
    const v = d[k];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) { err(`${k} must be a list of cite strings`); continue; }
    for (const item of v as string[]) if (!parseCite(item)) err(`${k} item ${JSON.stringify(item)} is not a valid cite`);
  }
  if (doc.layer === "architecture" && d.covers !== undefined) err("`covers` is only for feature specs; an architecture spec uses `implements`");
  if (doc.layer === "feature" && d.implements !== undefined) err("`implements` is only for architecture specs; a feature spec uses `covers`");
  for (const k of Object.keys(d)) {
    if ((LEGACY_RECORD_KEYS as readonly string[]).includes(k)) emit("warning", "spec-format", `legacy record key \`${k}\` is ignored; run \`specplane migrate status\` (architecture/file-formats §2)`, f, 1);
    else if (!KNOWN_KEYS.has(k)) emit("warning", "spec-format", `unknown frontmatter field \`${k}\` (it counts as content)`, f, 1);
  }
  for (const s of doc.index.duplicates) emit("error", "spec-format", `duplicate section ${s.id} (first at line ${s.first})`, f, s.second, s.id);
  for (const s of doc.index.wrongParent) emit("error", "spec-format", `section ${s.id} is nested under ${s.foundUnder}, not its parent ${s.parentId}`, f, s.line, s.id);
}


export const rules: Rule[] = [{
  id: "spec-format",
  severity: "error",
  source: "worktree",
  run(ctx) {
    const { emit, items } = collector();
    for (const s of ctx.wt.strayFiles) emit("error", "spec-format", s.reason, s.file);
    for (const doc of ctx.wt.specs.values()) {
      if (ctx.wanted && !ctx.wanted.has(doc.id)) continue;
      checkSpecFormat(doc, emit);
    }
    return items;
  },
}];
