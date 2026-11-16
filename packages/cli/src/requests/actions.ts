import { recordFromRequest } from "../verify/test-record.js";
import { writeDecision, type DecisionChange } from "../decisions/decisions.js";
import { writeSpecification, type SpecChange } from "../spec/write.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { configSet, configUnset } from "../config-ops.js";
import type { Actor, Preset } from "../perm/permissions.js";
import { approvePlan, createPlan } from "../plan/create.js";
import { editPlan } from "../plan/edit.js";
import { planMetaSet } from "../plan/meta.js";
import type { PlanCtx } from "../plan/ctx.js";
import { abandonPlan, deletePlan, finishPlan, mergePlan } from "../plan/finish.js";
import { resumePlan, retargetPlan, setBudget, startPlan, stopPlan } from "../plan/run.js";
import { applySpecEdit, patchApplies } from "../spec/edit.js";
import { approveSpecs, metaSet, overrideSpec, reopenSpec, type OverrideKind } from "../spec/human.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, findDoc } from "../spec/project.js";
import { committedSource } from "../spec/source.js";

/**
 * What accepting a request runs (`architecture/reference-cli` §8): the same operation as direct execution, once, under
 * the accepting person's permission, with the stored parameters. One entry per guarded command.
 */

export interface ActionCtx { root: string; actor: Actor; preset: Preset; now?: Date; env?: NodeJS.ProcessEnv; request: string }
/** `uncommitted` lists the files the action wrote without committing; `commitFor` names the commit `requests accept --commit` makes of them. */
export interface ActionOutcome { ok: boolean; lines: string[]; reasons: string[]; uncommitted?: string[]; commitFor?: { scope: string; summary: string } }

type P = Record<string, any>;
type Action = (ctx: ActionCtx, p: P) => Promise<ActionOutcome> | ActionOutcome;

const fromResult = (r: { ok: boolean; lines: string[]; reasons: string[]; data?: unknown }): ActionOutcome => {
  const d = r.data as { uncommitted?: string[]; commit?: { scope: string; summary: string } } | undefined;
  return { ok: r.ok, lines: r.lines, reasons: r.reasons, ...(d?.uncommitted?.length ? { uncommitted: d.uncommitted, ...(d.commit ? { commitFor: d.commit } : {}) } : {}) };
};
const planCtx = (c: ActionCtx): PlanCtx => c;

const ACTIONS: Record<string, Action> = {
  "harness read": async (c, p) => {
    const { acceptedRead } = await import("../harness/actions.js");
    const data = await acceptedRead(c, p.id, p.input);
    const result = data as { ok?: boolean; reasons?: string[] } | null;
    return { ok: result?.ok !== false, lines: [JSON.stringify(data)], reasons: result?.reasons ?? [] };
  },
  "spec create": (c, p) => writeSpecification(c, "create", p as SpecChange),
  "spec delete": (c, p) => writeSpecification(c, "delete", p as SpecChange),
  "decision add": (c, p) => writeDecision(c, "add", p as DecisionChange),
  "decision edit": (c, p) => writeDecision(c, "edit", p as DecisionChange),
  "decision delete": (c, p) => writeDecision(c, "delete", p as DecisionChange),
  "test record": (c, p) => recordFromRequest(c, p),
  "spec approve": async (c, p) => fromResult(await approveSpecs(c, p.ids, { yes: true })),
  "spec reopen": (c, p) => fromResult(reopenSpec(c, p.id)),
  "spec meta set": (c, p) => fromResult(metaSet(c, p.id, p.field, p.value)),
  "spec edit": (c, p) => {
    if ("before" in p || "after" in p) return writeSpecification(c, "edit", p as SpecChange);
    const head = loadProject(committedSource(c.root, "HEAD"), loadSpecPaths(c.root).paths);
    const doc = findDoc(head, p.spec);
    if (!doc) return { ok: false, lines: [], reasons: [`Specification \`${p.spec}\` no longer exists.`] };
    if (!patchApplies(c.root, p.patch)) return { ok: false, lines: [], reasons: [`The change to \`${p.spec}\` no longer applies to the current text.`] };
    if (!fs.existsSync(path.join(c.root, doc.file))) return { ok: false, lines: [], reasons: [`${doc.file} is gone.`] };
    return fromResult(applySpecEdit(c, p.spec, doc.file, p.patch));
  },
  "config set": (c, p) => fromResult(configSet(c, p.key, p.arg ?? String(p.new))),
  "config unset": (c, p) => fromResult(configUnset(c, p.key)),
  "plan create": (c, p) => { const r = createPlan(planCtx(c), { words: p.words, title: p.title, implements: p.implements, writes: p.writes, references: p.references }); return done(`Created plan ${r.id}.`); },
  "plan edit": (c, p) => { editPlan(planCtx(c), p.id, { changes: p.changes }); return done(`Edited plan ${p.id}.`); },
  "plan meta set": (c, p) => { planMetaSet(planCtx(c), p.id, p.field, p.value); return done(`Set ${p.field} of ${p.id}.`); },
  "plan approve": (c, p) => { approvePlan(planCtx(c), p.id); return done(`Approved plan ${p.id}.`); },
  "plan start": (c, p) => { const r = startPlan(planCtx(c), p.id, { target: p.target, forceDeps: p.forceDeps }); return done(`Started ${p.id} on ${r.branch} (target ${r.target}).`); },
  "plan stop": (c, p) => { stopPlan(planCtx(c), p.id, { kind: p.kind, reason: p.reason, needs: p.needs }); return done(`Stopped ${p.id}.`); },
  "plan resume": (c, p) => { const r = resumePlan(planCtx(c), p.id); return done(`Resumed ${p.id} in ${r.path}.`); },
  "plan budget": (c, p) => { setBudget(planCtx(c), p.id, { resource: p.resource, soft: p.soft, hard: p.hard, remove: p.remove }); return done(`Budget of ${p.id} changed.`); },
  "plan retarget": (c, p) => { retargetPlan(planCtx(c), p.id, p.target); return done(`Target of ${p.id} is now ${p.target}.`); },
  "plan finish": (c, p) => { const r = finishPlan(planCtx(c), p.id, { complete: p.complete, back: p.back }); return done(`Final review of ${p.id}: ${r.decision}.`); },
  "plan merge": (c, p) => { const r = mergePlan(planCtx(c), p.id, { mode: p.mode, force: p.force }); return done(r.message); },
  "plan abandon": (c, p) => { abandonPlan(planCtx(c), p.id, { force: p.force }); return done(`Abandoned ${p.id}.`); },
  "plan delete": (c, p) => { deletePlan(planCtx(c), p.id, { force: p.force }); return done(`Deleted ${p.id}.`); },
};

const done = (line: string): ActionOutcome => ({ ok: true, lines: [line], reasons: [] });

/** The runner for a stored command, or null when the command is not one that can be requested. */
export function actionFor(command: string): Action | null {
  if (ACTIONS[command]) return ACTIONS[command];
  if (command.startsWith("spec override ")) {
    const kind = command.slice("spec override ".length) as OverrideKind;
    return (c, p) => fromResult(overrideSpec(c, kind, p.id, p.args ?? []));
  }
  return null;
}

export const REQUESTABLE_COMMANDS: readonly string[] = [...Object.keys(ACTIONS), "spec override status", "spec override approver", "spec override approval-commit", "spec override test"];
