import { PLAN_PIECES } from "../perm/permissions.js";
import { presetDraft } from "../perm/preset-ops.js";
import { validateEditParams } from "../plan/edit.js";
import { specLayer as writeLayer, validateSpecChange } from "../spec/write.js";
import { approvalNeeds } from "../spec/human.js";
import { validateActionInput } from "../harness/actions.js";
import { loadSpecPaths } from "../spec/paths.js";
import { loadProject, findDoc } from "../spec/project.js";
import { committedSource } from "../spec/source.js";
import { findPlan } from "../plan/model.js";
import { plansDir } from "../plan/ctx.js";

/** Required permissions come from the action, never from request permission metadata (requests R52.2/R52.3). */
export type ActionNeeds = (string | string[])[];

export class InvalidRequestAction extends Error {
  constructor(message: string) { super(message); this.name = "InvalidRequestAction"; }
}

const invalid = (message: string): never => { throw new InvalidRequestAction(message); };
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

/**
 * Validate the parameter shape before deriving permissions. Execution must still check current-state preconditions
 * (patch applicability, plan status, config value, etc.). Permission alternatives retain the guard's granular/general
 * semantics rather than freezing whichever permission the sender happened to have.
 */
export function actionNeeds(root: string, command: string, params: unknown): ActionNeeds {
  if (!params || typeof params !== "object" || Array.isArray(params)) invalid("Request parameters must be an object.");
  const p = params as Record<string, unknown>;
  const requireText = (key: string): string => text(p[key]) ? p[key] as string : invalid(`\`${command}\` needs a non-empty string \`${key}\`.`);
  const optional = (key: string, check: (v: unknown) => boolean): void => {
    if (p[key] !== undefined && !check(p[key])) invalid(`Invalid \`${key}\` for \`${command}\`.`);
  };
  const bool = (key: string): void => optional(key, (v) => typeof v === "boolean");
  const oneOf = (key: string, values: string[], required = false): void => {
    if (required || p[key] !== undefined) {
      if (!values.includes(p[key] as string)) invalid(`\`${key}\` for \`${command}\` must be one of: ${values.join(", ")}.`);
    }
  };
  const specLayer = (key: string): string => {
    const id = requireText(key);
    const head = loadProject(committedSource(root, "HEAD"), loadSpecPaths(root).paths);
    const doc = findDoc(head, id);
    if (!doc) return invalid(`Specification \`${id}\` does not exist.`);
    return doc.layer;
  };

  switch (command) {
    case "harness read": {
      try {
        const action = validateActionInput(requireText("id"), p.input);
        if (!action.readOnly) invalid("Only read actions use harness read requests.");
        return action.permissions(p.input as Record<string, unknown>, root);
      } catch (e) { return invalid((e as Error).message); }
    }
    case "spec create":
    case "spec delete": {
      const op = command === "spec create" ? "create" : "delete";
      try { validateSpecChange(op, p); } catch (e) { return invalid((e as Error).message); }
      return [`spec.${op}.${writeLayer(p.spec as string)}`];
    }
    case "decision add":
    case "decision edit":
    case "decision delete": {
      const op = command.slice("decision ".length);
      requireText("id");
      if (!/^D[1-9][0-9]*$/.test(p.id as string)) invalid("A decision record ID looks like D1.");
      if (!(p.before === null || typeof p.before === "string") || !(p.after === null || typeof p.after === "string")) invalid("A decision change needs exact before and after text.");
      if (op === "add" ? p.before !== null || p.after === null : op === "delete" ? p.before === null || p.after !== null : p.before === null || p.after === null) invalid(`Invalid ${op} change.`);
      return [`decision.${op}`];
    }
    case "test record":
      for (const key of ["spec", "test", "summary", "commit", "fingerprint"]) requireText(key);
      oneOf("kind", ["deterministic", "intelligent"], true);
      oneOf("outcome", ["passed", "failed"], true);
      if (!p.against || typeof p.against !== "object" || Array.isArray(p.against) || !Object.values(p.against).every(text)) invalid("`test record` needs an against fingerprint map.");
      if (!p.by || typeof p.by !== "object" || Array.isArray(p.by) || !Object.values(p.by).every(text)) invalid("`test record` needs the originating actor.");
      return ["test.record"];
    case "spec approve":
      if (!strings(p.ids) || !p.ids.length) invalid("`spec approve` needs a non-empty list of specification IDs.");
      return approvalNeeds(root, p.ids as string[]).needs;
    case "spec reopen": return [`spec.edit.${specLayer("id")}`];
    case "spec edit":
      if ("before" in p || "after" in p) {
        try { validateSpecChange("edit", p); } catch (e) { return invalid((e as Error).message); }
        return [`spec.edit.${writeLayer(p.spec as string)}`];
      }
      requireText("patch");
      return [`spec.edit.${specLayer("spec")}`];
    case "spec meta set": {
      specLayer("id");
      const field = requireText("field");
      if (!["title", "authors", "references", "covers", "approval.date", "approval.commit"].includes(field)) invalid(`Metadata field \`${field}\` cannot be set.`);
      if (typeof p.value !== "string") invalid("`spec meta set` needs a string `value`.");
      const piece = field.startsWith("approval.") ? "approval" : field;
      return [[`meta.write.${piece}`, "meta.write"]];
    }
    case "spec override status":
    case "spec override approver":
    case "spec override approval-commit":
    case "spec override test":
      specLayer("id");
      if (!strings(p.args) || !p.args.length) invalid(`\`${command}\` needs a non-empty list of arguments.`);
      return [`override.${command.slice("spec override ".length)}`];
    case "config set":
      requireText("key");
      // Guard-generated requests carry both parsed `new` and original `arg`; manual requests may carry `new` only.
      if (p.arg !== undefined && p.arg !== null && typeof p.arg !== "string") invalid("`config set` needs a string `arg`.");
      if (typeof p.arg !== "string" && !("new" in p)) invalid("`config set` needs `arg` or `new`.");
      return ["config.change"];
    case "config unset": requireText("key"); return ["config.change"];
    case "preset create": requireText("id"); return ["preset.create"];
    case "plan create": {
      if (!strings(p.words)) invalid("`plan create` needs a list of words.");
      const words = (p.words as string[]).flatMap((w) => w.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      if (words.length < 2 || words.length > 4) invalid("A plan name is two to four words.");
      optional("title", text);
      for (const key of ["implements", "writes", "references"]) optional(key, strings);
      return ["plan.create"];
    }
    case "plan edit":
      try { validateEditParams(p.id, p.changes); } catch (e) { return invalid((e as Error).message); }
      return ["plan.edit"];
    case "plan meta set": {
      requireText("id");
      const field = requireText("field");
      if (!(PLAN_PIECES as readonly string[]).includes(field)) invalid(`Plan metadata field \`${field}\` cannot be set.`);
      if (typeof p.value !== "string") invalid("`plan meta set` needs a string `value`.");
      return [[`plan.meta.write.${field}`, "plan.meta.write"]];
    }
    case "plan approve": requireText("id"); return ["spec.approve.feature"];
    case "plan start":
      requireText("id"); optional("target", text); bool("forceDeps"); return ["plan.start"];
    case "plan stop":
      requireText("id"); oneOf("kind", ["soft", "user", "hard", "failure"]);
      optional("reason", text); optional("needs", text); return ["plan.softstop"];
    case "plan resume": requireText("id"); return ["plan.resume"];
    case "plan retarget": requireText("id"); requireText("target"); return ["plan.resume"];
    case "plan budget":
      requireText("id"); requireText("resource"); bool("remove");
      if (!p.remove && !(typeof p.soft === "number" && Number.isFinite(p.soft) && p.soft > 0 &&
        typeof p.hard === "number" && Number.isFinite(p.hard) && p.hard >= p.soft)) invalid("A budget needs finite values with 0 < soft <= hard.");
      return ["plan.budget"];
    case "plan finish":
      requireText("id"); bool("complete"); optional("back", text);
      if ((p.complete === true) === text(p.back)) invalid("Give exactly one of complete or back.");
      return ["plan.complete"];
    case "plan merge":
      requireText("id"); oneOf("mode", ["pr", "local"], true); bool("force"); return ["plan.complete"];
    case "plan abandon":
    case "plan delete":
      requireText("id"); bool("force"); return [command === "plan abandon" ? "plan.abandon" : "plan.delete"];
    default: return invalid(`\`${command}\` is not an action that can be requested.`);
  }
}

/**
 * What accepting needs, as opposed to what sending needs: accepting a `preset create` runs `presetCreate` as the accepting
 * person, who needs `config.change` and `role.manage` (`R56`, `requests R52.2`); the sender is checked on `preset.create`.
 */
export function acceptNeeds(root: string, command: string, params: unknown): ActionNeeds {
  const needs = actionNeeds(root, command, params);
  return command === "preset create" ? ["config.change", "role.manage"] : needs;
}

const PLAN_COMMANDS = ["plan approve", "plan start", "plan stop", "plan resume", "plan retarget", "plan budget", "plan finish", "plan merge", "plan abandon", "plan delete"];

/**
 * A reason why a request can never succeed, found before it is stored: it names a plan that is not committed here. Checked
 * after `actionNeeds`, so a malformed or denied request is still reported first. `plan start` with an explicit target is
 * left to the accepting run, because that plan lives on another branch.
 */
export function requestPrecondition(root: string, command: string, params: unknown): string | null {
  if (command === "preset create") {
    const { problems } = presetDraft(root, params);
    return problems.length ? `The preset cannot be created: ${problems.join("; ")}.` : null;
  }
  if (!PLAN_COMMANDS.includes(command) || !params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  if (typeof p.id !== "string" || (command === "plan start" && p.target !== undefined)) return null;
  const dir = plansDir(root);
  return findPlan(committedSource(root, "HEAD"), dir, p.id) ? null : `Plan \`${p.id}\` does not exist in ${dir} on the current branch; check the plan ID.`;
}
