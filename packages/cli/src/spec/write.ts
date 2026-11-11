import * as fs from "node:fs";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadSettings } from "../config.js";
import { audit } from "../audit/log.js";
import { guard } from "../perm/permissions.js";
import { holdRequest, sentMessage } from "../requests/hold.js";
import { splitFrontmatter } from "./frontmatter.js";
import { makePatch, specDiffText } from "./edit.js";
import type { Ctx, Result } from "./human.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, resolveRaw } from "./project.js";
import { worktreeSource } from "./source.js";

export type SpecOperation = "create" | "edit" | "delete";
export interface SpecChange { spec: string; before: string | null; after: string | null }
const LEGACY = ["status", "approval", "review-reason", "results", "implementation"];
const result = (r: Partial<Result> & { ok: boolean }): Result => ({ lines: [], reasons: [], commit: null, warnings: [], written: [], ...r });

export function specLayer(id: string): string {
  const m = /^(requirement|feature|architecture)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(id);
  if (!m) throw new Error("A specification ID must be <layer>/<slug>.");
  return m[1];
}

/** Resolve only a configured spec path, refusing symlinks including in parent directories. */
function location(root: string, id: string): { abs: string; rel: string } {
  const layer = specLayer(id);
  const paths = loadSpecPaths(root).paths;
  const dir = layer === "requirement" ? paths.requirements : layer === "feature" ? paths.features : paths.architecture;
  const rel = `${dir}/${id.split("/")[1]}.md`;
  let abs = path.resolve(root);
  for (const part of rel.split("/")) {
    if (!part || part === "." || part === "..") throw new Error("Unsafe specification path.");
    abs = path.join(abs, part);
    try { if (fs.lstatSync(abs).isSymbolicLink()) throw new Error("Specification paths must not contain symlinks."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return { abs, rel };
}

export function checkSpecText(id: string, text: string): void {
  const fm = splitFrontmatter(text);
  if (fm.error && !(fm.missing && specLayer(id) === "requirement")) throw new Error(fm.error);
  for (const key of LEGACY) if (Object.hasOwn(fm.data ?? {}, key)) throw new Error(`Legacy record key \`${key}\` is not accepted in specification writes.`);
  if (fm.data?.id !== undefined && fm.data.id !== id) throw new Error("Specification ID must match its path.");
  if (specLayer(id) !== "requirement" && (fm.data?.id !== id || typeof fm.data?.title !== "string" || !Array.isArray(fm.data?.authors))) {
    throw new Error("A specification needs id, title and authors frontmatter.");
  }
}

export function validateSpecChange(operation: SpecOperation, value: unknown): asserts value is SpecChange {
  const p = value as SpecChange | null;
  if (!p || typeof p.spec !== "string") throw new Error("Missing specification ID.");
  specLayer(p.spec);
  if (!(p.before === null || typeof p.before === "string") || !(p.after === null || typeof p.after === "string")) throw new Error("A spec change needs exact before and after text.");
  if (operation === "create" ? p.before !== null || p.after === null : operation === "delete" ? p.before === null || p.after !== null : p.before === null || p.after === null) throw new Error(`Invalid ${operation} change.`);
  if (p.after !== null) checkSpecText(p.spec, p.after);
}

/** Prepare author metadata once, before a request is stored; acceptance retains the originating model. */
export function prepareSpecChange(ctx: Ctx, operation: SpecOperation, input: { spec: string; text?: string; section?: string; contribution?: string }): SpecChange {
  const { abs } = location(ctx.root, input.spec);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (operation === "create" ? before !== null : before === null) throw new Error(operation === "create" ? "Specification already exists." : "Specification not found.");
  if (operation === "delete") return { spec: input.spec, before, after: null };
  if (typeof input.text !== "string") throw new Error("Missing replacement text.");
  let after = input.text;
  if (input.section) {
    if (operation !== "edit") throw new Error("Only edits can replace a section.");
    const project = loadProject(worktreeSource(ctx.root), loadSpecPaths(ctx.root).paths);
    const cite = specLayer(input.spec) === "requirement" ? `${input.spec.split("/")[1]}.md#${input.section}` : `${input.spec} ${input.section}`;
    const resolved = resolveRaw(project, cite)?.resolution;
    if (!resolved?.ok || !resolved.target.startLine || !resolved.target.endLine) throw new Error("Section not found.");
    const lines = before!.split("\n");
    lines.splice(resolved.target.startLine - 1, resolved.target.endLine - resolved.target.startLine + 1, input.text.replace(/\n$/, ""));
    after = lines.join("\n");
  }
  checkSpecText(input.spec, after);
  if (after === before) return { spec: input.spec, before, after };
  const fm = splitFrontmatter(after);
  const authors = before === null ? [] : splitFrontmatter(before).data?.authors ?? [];
  if (!Array.isArray(authors)) throw new Error("Existing authors must be a list.");
  if (!isDeepStrictEqual(fm.data?.authors ?? [], authors)) throw new Error("Spec writes must preserve existing authors; new authors are recorded by the harness.");
  if (ctx.actor.kind === "llm" && loadSettings(ctx.root).config.values["authorship.record_llm"]) {
    const data = { ...(fm.data ?? {}), authors: [...authors, { llm: ctx.actor.model || "unknown", contribution: input.contribution || `${operation} ${input.section ?? input.spec}` }] };
    // JSON values are valid YAML; no new serializer or implicit YAML types are introduced.
    after = `---\n${Object.entries(data).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join("\n")}\n---\n${fm.body}`;
  }
  return { spec: input.spec, before, after };
}

/** Exact-text preconditions prevent accepted requests from overwriting later user work. Never commits. */
export function writeSpecification(ctx: Ctx, operation: SpecOperation, change: SpecChange): Result {
  validateSpecChange(operation, change);
  const permission = `spec.${operation}.${specLayer(change.spec)}`;
  const g = guard(ctx.preset, ctx.actor, [permission], `${operation} specification`);
  if (g.kind === "deny") return result({ ok: false, reasons: [g.message] });
  const { abs, rel } = location(ctx.root, change.spec);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (current !== change.before) return result({ ok: false, reasons: ["Specification changed since this action was prepared; prepare a new change."] });
  if (change.before === change.after) return result({ ok: true, lines: ["No change."] });
  if (g.kind === "request") {
    const patch = makePatch(rel, change.before ?? "", change.after ?? "");
    const rec = holdRequest({ root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission,
      command: `spec ${operation}`, params: { ...change }, reason: `${operation} ${change.spec}`,
      diff: operation === "create" ? patch : specDiffText(ctx.root, change.spec, patch) ?? patch, now: ctx.now });
    return result({ ok: true, request: rec.id, lines: [sentMessage(rec)] });
  }
  if (change.after === null) fs.unlinkSync(abs);
  else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, change.after); }
  audit(ctx.root, { command: `spec ${operation}`, args: [change.spec], permission, outcome: "done", actor: ctx.actor, request: ctx.request }, ctx.now);
  return result({ ok: true, written: [change.spec], lines: [`${operation}: ${change.spec}. Written, not committed.`] });
}
