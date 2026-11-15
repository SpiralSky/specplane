import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../git/exec.js";
import { holdRequest, sentMessage } from "../requests/hold.js";
import { guard } from "../perm/permissions.js";
import { audit } from "../audit/log.js";
import { lastApprovalCommit } from "./notes.js";
import { loadSpecPaths } from "./paths.js";
import { loadProject, findDoc } from "./project.js";
import { committedSource, headCommit } from "./source.js";
import type { Ctx, Result } from "./human.js";

/**
 * A specification body edit as an LLM action (`feature/roles-and-permissions` R50, R57; `feature/requests` R52.3,
 * R52.4; `architecture/reference-cli` §5.4, §8, §13.4). Allow writes the new text and the review state; `request user`
 * stores the change as a unified diff in the request and writes nothing until it is accepted.
 */

const result = (r: Partial<Result> & { ok: boolean }): Result => ({ lines: [], reasons: [], commit: null, warnings: [], written: [], ...r });

/** Unified diff of `oldText` to `newText` for `rel`, applicable from the repository root with `git apply -p2` (`patchStrip` also accepts an ordinary `-p1` diff). */
export function makePatch(rel: string, oldText: string, newText: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-patch-"));
  try {
    for (const [side, text] of [["a", oldText], ["b", newText]] as const) {
      fs.mkdirSync(path.dirname(path.join(tmp, side, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, side, rel), text);
    }
    // `git diff --no-index` exits 1 when the files differ, so read its output directly instead of through `run`.
    return spawnSync("git", ["diff", "--no-index", "--no-color", "--", `a/${rel}`, `b/${rel}`], { cwd: tmp, encoding: "utf8" }).stdout;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * How many leading path parts `git apply` strips: 2 for a patch made by `makePatch` (`--- a/a/<path>`, `+++ b/b/<path>`),
 * 1 for an ordinary `git diff` patch (`--- a/<path>`, `+++ b/<path>`) such as a model writes into a request.
 */
export function patchStrip(patch: string): "-p1" | "-p2" {
  return /^--- a\/a\//m.test(patch) && /^\+\+\+ b\/b\//m.test(patch) ? "-p2" : "-p1";
}

/** Apply a patch made by `makePatch`, or an ordinary unified diff, to the working tree; throws when it no longer applies. */
export function applyPatch(root: string, patch: string): void {
  run("git", ["apply", patchStrip(patch), "--whitespace=nowarn"], { cwd: root, input: patch });
}

export function patchApplies(root: string, patch: string): boolean {
  try { run("git", ["apply", "--check", patchStrip(patch), "--whitespace=nowarn"], { cwd: root, input: patch }); return true; } catch { return false; }
}

export interface SpecEditParams { spec: string; patch: string }

/** Edit a specification to `newText`. The file is left in the working tree, not committed (`reference-cli` §13.4). */
export function editSpec(ctx: Ctx, specId: string, newText: string): Result {
  if (!headCommit(ctx.root)) return result({ ok: false, reasons: ["The repository has no commits."] });
  const head = loadProject(committedSource(ctx.root, "HEAD"), loadSpecPaths(ctx.root).paths);
  const doc = findDoc(head, specId);
  if (!doc) return result({ ok: false, reasons: [`Specification \`${specId}\` not found.`] });
  const abs = path.join(ctx.root, doc.file);
  const current = fs.readFileSync(abs, "utf8");
  if (current === newText) return result({ ok: true, lines: ["No change."] });
  const actor = { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name };
  const g = guard(ctx.preset, ctx.actor, [`spec.edit.${doc.layer}`], "Editing a specification");
  if (g.kind === "deny") {
    audit(ctx.root, { command: "spec edit", args: [specId], permission: g.permission, outcome: "refused", reason: g.message, actor, request: ctx.request }, ctx.now);
    return result({ ok: false, reasons: [g.message] });
  }
  const patch = makePatch(doc.file, current, newText);
  if (g.kind === "request") {
    const rec = holdRequest({
      root: ctx.root, actor: ctx.actor, permissions: g.permissions, decidedBy: g.permission, command: "spec edit",
      params: { spec: specId, patch } satisfies SpecEditParams, reason: `Edit \`${specId}\`.`, diff: specDiffText(ctx.root, specId, patch), now: ctx.now,
    });
    return result({ ok: true, request: rec.id, lines: [sentMessage(rec)] });
  }
  return applySpecEdit(ctx, specId, doc.file, patch);
}

/** Write the edit (used directly under allow, and when a request is accepted); needs the edit permission with `allow`. */
export function applySpecEdit(ctx: Ctx, specId: string, file: string, patch: string): Result {
  const actor = { role: ctx.actor.role, kind: ctx.actor.kind, name: ctx.actor.name };
  const layer = findDoc(loadProject(committedSource(ctx.root, "HEAD"), loadSpecPaths(ctx.root).paths), specId)?.layer;
  if (!layer) return result({ ok: false, reasons: [`Specification \`${specId}\` not found.`] });
  const g = guard(ctx.preset, ctx.actor, [`spec.edit.${layer}`], "Editing a specification");
  if (g.kind !== "allow") {
    const reason = g.kind === "deny" ? g.message : `Editing a specification needs the \`${g.permission}\` permission with mode allow, which the ${ctx.actor.role} role does not have.`;
    audit(ctx.root, { command: "spec edit", args: [specId], permission: g.permission, outcome: "refused", reason, actor, request: ctx.request }, ctx.now);
    return result({ ok: false, reasons: [reason] });
  }
  try { applyPatch(ctx.root, patch); }
  catch (e) {
    audit(ctx.root, { command: "spec edit", args: [specId], permission: null, outcome: "failed", reason: "the change no longer applies", actor, request: ctx.request }, ctx.now);
    return result({ ok: false, reasons: [`The change to \`${specId}\` no longer applies to the current text: ${(e as Error).message.split("\n")[0]}`] });
  }
  audit(ctx.root, { command: "spec edit", args: [specId], permission: `spec.edit.${layer}`, outcome: "done", actor, request: ctx.request }, ctx.now);
  return result({ ok: true, written: [specId], lines: [`Edited \`${specId}\`. Written, not committed; the new content is awaiting review once committed.`] });
}

/**
 * The change as a git diff against the last approved version of the specification (`requests R52.4`); a specification
 * never approved shows the whole proposed text as additions.
 */
export function specDiffText(root: string, specId: string, patch: string): string | null {
  try {
    const head = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
    const doc = findDoc(head, specId);
    if (!doc) return null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specplane-diff-"));
    try {
      const rel = doc.file;
      fs.mkdirSync(path.dirname(path.join(tmp, "new", rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, "new", rel), fs.readFileSync(path.join(root, rel), "utf8"));
      run("git", ["apply", patchStrip(patch), "--whitespace=nowarn"], { cwd: path.join(tmp, "new"), input: patch });
      const proposed = fs.readFileSync(path.join(tmp, "new", rel), "utf8");
      // A requirement file has no approval record and is always approved, so its baseline is HEAD, as in `spec-view`.
      const commit = doc.layer === "requirement" ? "HEAD" : lastApprovalCommit(root, doc.id);
      let approved = "";
      if (commit) { try { approved = run("git", ["show", `${commit}:${rel}`], { cwd: root }); } catch { approved = ""; } }
      return makePatch(rel, approved, proposed);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } catch { return null; }
}
