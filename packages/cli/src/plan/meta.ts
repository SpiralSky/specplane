import * as fs from "node:fs";
import * as path from "node:path";
import { PLAN_PIECES } from "../perm/permissions.js";
import { parseCite } from "../spec/cites.js";
import { editKeys } from "../spec/fm-edit.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, resolveCite, findDoc } from "../spec/project.js";
import { worktreeSource } from "../spec/source.js";
import { audit } from "../audit/log.js";
import { authorize, commitPaths, gitTry, guardedWith, PlanOpError, planSlug, requirePlan, type PlanCtx } from "./ctx.js";
import { describePlan, type PlanInfo } from "./status.js";

/**
 * Plan metadata for people: `plan meta get` and `plan meta set` (`feature/cli` R33, `architecture/reference-cli` §13.5).
 * Only the author-written PLAN.md fields are settable; execution status and progress change through the plan commands.
 */

export { PLAN_PIECES };
export type PlanPiece = (typeof PLAN_PIECES)[number];

export interface PlanMeta {
  id: string;
  title: string;
  authors: unknown[];
  implements: unknown[];
  references: string[];
  approval: PlanInfo["approval"];
  archived: boolean;
  status: string;
  stop: PlanInfo["stop"];
  current_step: number | null;
  done: number[];
  budget: unknown[];
  branch: string | null;
  target_branch: string | null;
  session: string | null;
}

/** Current metadata of a plan: author-written fields plus approval and execution status (`plans R29`). */
export function planMetaGet(ctx: PlanCtx, id: string): PlanMeta {
  return guardedWith({ id }, ctx, "plan meta get", [id], ["plan.meta.read"], "Reading plan metadata", () => {
    const { root, rec } = requirePlan(ctx, id);
    const info = describePlan(ctx, root, rec);
    const d = rec.fm?.data ?? {};
    const p = rec.progress!;
    return {
      id: rec.id, title: info.title,
      authors: Array.isArray(d.authors) ? d.authors : [],
      implements: Array.isArray(d.implements) ? d.implements : [],
      references: Array.isArray(d.references) ? (d.references as string[]) : [],
      approval: info.approval, archived: rec.archived, status: info.status, stop: info.stop,
      current_step: typeof p.current_step === "number" ? p.current_step : null, done: p.done,
      budget: p.budget ?? [], branch: p.branch ?? null, target_branch: p.target_branch ?? null, session: p.session ?? null,
    };
  });
}

function parseAuthor(item: string): Record<string, string> {
  const m = /^(human|llm):([^|]+)(?:\|(.+))?$/.exec(item.trim());
  if (!m) throw new PlanOpError(`author \`${item}\` must look like human:<name> or llm:<model id>, optionally |<contribution>`);
  const out: Record<string, string> = { [m[1]]: m[2].trim() };
  if (m[3]) out.contribution = m[3].trim();
  return out;
}

const list = (raw: string): string[] => (raw.trim() === "" ? [] : raw.split(",").map((s) => s.trim()));

/** Validate and shape the new value of one piece. `old` is the current value (kept `commit` of unchanged entries). */
function parseValue(ctx: PlanCtx, root: string, piece: PlanPiece, raw: string, old: unknown): unknown {
  const project = () => loadProject(worktreeSource(root), loadSpecPaths(root).paths);
  switch (piece) {
    case "title":
      if (!raw.trim() || /[\r\n]/.test(raw)) throw new PlanOpError("title must be a non-empty single line");
      return raw.trim();
    case "authors": return list(raw).map(parseAuthor);
    case "references": {
      const items = list(raw);
      const proj = project();
      for (const c of items) {
        const cite = parseCite(c);
        if (!cite) throw new PlanOpError(`\`${c}\` is not a valid cite`);
        const r = resolveCite(proj, cite);
        if (!r.ok && r.code === "error") throw new PlanOpError(`Reference \`${c}\` does not resolve: ${r.reason}`);
      }
      return items;
    }
    case "implements": {
      // Items are `<spec>` (implements) or `writes:<spec>`; the commit of a kept `implements` entry is preserved.
      const proj = project();
      const prior = Array.isArray(old) ? old.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : [];
      return list(raw).map((item) => {
        const writes = item.startsWith("writes:");
        const spec = writes ? item.slice(7).trim() : item;
        const doc = findDoc(proj, spec);
        if (!doc) throw new PlanOpError(`Specification \`${spec}\` does not exist; name it as feature/<slug> or architecture/<slug>.`);
        if (writes) return { spec, mode: "writes" };
        const kept = prior.find((e) => e.spec === spec && e.mode === "implements" && typeof e.commit === "string");
        const commit = (kept?.commit as string | undefined) ?? gitTry(root, ["log", "-1", "--format=%H", "--", doc.file])?.trim();
        return { spec, ...(commit ? { commit } : {}), mode: "implements" };
      });
    }
  }
}

/** Set one author-written field of PLAN.md and commit it (an override, audited with old and new values). */
export function planMetaSet(ctx: PlanCtx, id: string, field: string, raw: string): { commit: string; old: unknown; new: unknown } {
  const piece = (PLAN_PIECES as readonly string[]).includes(field) ? (field as PlanPiece) : null;
  const token = authorize(ctx, [piece ? [`plan.meta.write.${piece}`, "plan.meta.write"] : "plan.meta.write"], `Changing \`${field}\` of a plan`, "plan meta set", [id, field], { id, field, value: raw });
  const permission = piece && token.permissions.includes(`plan.meta.write.${piece}`) ? `plan.meta.write.${piece}` : token.permissions[0] ?? null;
  const who = { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name };
  try {
    if (!piece) throw new PlanOpError(`\`${field}\` cannot be set here. Settable fields: ${PLAN_PIECES.join(", ")}. Status and progress change through the plan commands (start, stop, resume, finish, abandon).`);
    const { root, rec } = requirePlan(ctx, id);
    if (rec.archived || ["completed", "abandoned"].includes(rec.progress!.status)) throw new PlanOpError("An archived or finished plan's metadata cannot be changed.");
    if ((gitTry(root, ["status", "--porcelain", "--", rec.planFile]) ?? "").trim()) throw new PlanOpError(`${rec.planFile} has uncommitted changes; commit or restore them first.`);
    const old = rec.fm?.data?.[piece] ?? null;
    const value = parseValue(ctx, root, piece, raw, old);
    const abs = path.join(root, rec.planFile);
    if (fs.lstatSync(abs).isSymbolicLink()) throw new PlanOpError(`Cannot edit symlink path ${rec.planFile}.`);
    // An empty list removes the key, except authors, which stays a list.
    const edits = { [piece]: Array.isArray(value) && !value.length && piece !== "authors" ? undefined : value };
    fs.writeFileSync(abs, editKeys(fs.readFileSync(abs, "utf8"), edits));
    const commit = commitPaths(ctx, root, [rec.planFile], { type: "docs", scope: planSlug(id), summary: `set ${piece}`, workflow: "plan-meta", planId: id });
    audit(ctx.root, { command: "plan meta set", args: [id, field], permission, outcome: "done", request: ctx.request, actor: who, old: { [piece]: old }, new: { [piece]: value } }, ctx.now);
    return { commit, old, new: value };
  } catch (e) {
    audit(ctx.root, { command: "plan meta set", args: [id, field], permission, outcome: "failed", reason: (e as Error).message.split("\n")[0], request: ctx.request, actor: who }, ctx.now);
    throw e;
  }
}
